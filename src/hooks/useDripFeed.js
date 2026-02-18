import { useState, useEffect, useCallback, useRef } from 'react';
import { graphNodeToCyElement, graphEdgeToCyElement } from '../internal/cytoscapeConvert';
import { coalesceGraphData } from '../core/coalesce';
import { getFitElements, getFitPadding } from '../internal/useCytoscape';

const GLOW_DURATION = 2500;

/**
 * Drip-feed animation queue and replay logic.
 * Extracted from GraphExplorer.jsx:97-287 (R1).
 *
 * @param {Object} options
 * @param {Object} options.cytoscape - useCytoscape return value
 * @param {Object} options.filters - useGraphFilters return value (for registerStreamedElements)
 * @param {function} options.incrementStats - from useGraphData
 * @param {string} options.layout - current layout name
 * @param {Object} options.stream - useGraphStream return value
 */
export function useDripFeed({ cytoscape, filters, incrementStats, layout, stream }) {
  const [dripInterval, setDripInterval] = useState(() => {
    const stored = localStorage.getItem('graph:dripInterval');
    return stored ? Number(stored) : 200;
  });
  const dripIntervalRef = useRef(dripInterval);
  useEffect(() => {
    dripIntervalRef.current = dripInterval;
    localStorage.setItem('graph:dripInterval', String(dripInterval));
  }, [dripInterval]);

  const [isReplaying, setIsReplaying] = useState(false);
  const userInteractedRef = useRef(false);
  const entityIndexRef = useRef(0);
  const relayoutTimerRef = useRef(null);
  const dripTimersRef = useRef([]);
  const dripQueueRef = useRef([]);

  // Schedule a layout after streaming goes quiet
  const scheduleQuietLayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      relayoutTimerRef.current = null;
      cytoscape.runLayout(layout);
      if (!userInteractedRef.current) {
        const cy = cytoscape.cy.current;
        if (cy) cy.fit(getFitElements(cy), getFitPadding(cy));
      }
    }, 3000);
  }, [cytoscape, layout]);

  // Position a node during streaming (golden angle radial placement)
  const positionStreamedNode = useCallback((cy, cyEl) => {
    if (cyEl.group !== 'nodes') return;
    const node = cy.getElementById(cyEl.data.id);
    if (!node.length) return;

    const parentId = cyEl.data.parentId;
    if (parentId) {
      const parent = cy.getElementById(parentId);
      if (parent.length) {
        const pos = parent.position();
        const idx = entityIndexRef.current++;
        const angle = (idx * 2.4);
        const radius = 120 + (idx > 6 ? 60 : 0);
        node.position({
          x: pos.x + radius * Math.cos(angle),
          y: pos.y + radius * Math.sin(angle),
        });
      }
    } else {
      const memoryNodes = cy.nodes().filter(n => n.data('category') === 'memory');
      const count = memoryNodes.length;
      const cx = cy.width() / 2;
      const cyy = cy.height() / 2;
      node.position({ x: cx + (count - 1) * 200, y: cyy });
      entityIndexRef.current = 0;
    }
  }, []);

  // Process next element from the drip queue
  const processNextDrip = useCallback(() => {
    const queue = dripQueueRef.current;
    if (queue.length === 0) {
      scheduleQuietLayout();
      return;
    }
    const el = queue.shift();
    const cy = cytoscape.cy.current;
    if (!cy) return;

    // Convert GraphNode/GraphEdge to Cytoscape element
    const cyEl = ('source' in el) ? graphEdgeToCyElement(el) : graphNodeToCyElement(el);

    if (cy.getElementById(cyEl.data.id).length > 0) {
      const timer = setTimeout(processNextDrip, 50);
      dripTimersRef.current.push(timer);
      return;
    }

    // Register with filter panel
    filters.registerStreamedElements([el]);
    try {
      const added = cy.add(cyEl);
      added.addClass('streaming-new');
      positionStreamedNode(cy, cyEl);
      if (!('source' in el)) incrementStats([el], 0);
      else incrementStats(0, 1);
      setTimeout(() => { if (added.inside()) added.removeClass('streaming-new'); }, GLOW_DURATION);
    } catch {
      // Edge endpoint missing
    }

    if (!userInteractedRef.current && !('source' in el)) {
      cy.fit(getFitElements(cy), getFitPadding(cy));
    }

    if (queue.length > 0) {
      const timer = setTimeout(processNextDrip, dripIntervalRef.current);
      dripTimersRef.current.push(timer);
    } else {
      scheduleQuietLayout();
    }
  }, [cytoscape, filters, incrementStats, positionStreamedNode, scheduleQuietLayout]);

  // Enqueue a GraphNode or GraphEdge for drip-feed animation
  const enqueue = useCallback((el) => {
    const wasEmpty = dripQueueRef.current.length === 0;
    dripQueueRef.current.push(el);
    if (wasEmpty) {
      if (relayoutTimerRef.current) {
        clearTimeout(relayoutTimerRef.current);
        relayoutTimerRef.current = null;
      }
      const timer = setTimeout(processNextDrip, dripIntervalRef.current);
      dripTimersRef.current.push(timer);
    }
  }, [processNextDrip]);

  // Replay a recording through the same drip-feed pipeline
  const replayRecording = useCallback(async (recording) => {
    if (!recording?.events?.length) return;
    dripTimersRef.current.forEach(clearTimeout);
    dripTimersRef.current = [];
    dripQueueRef.current = [];
    entityIndexRef.current = 0;
    cytoscape.setElements([]);
    userInteractedRef.current = false;
    stream?.clearOperations?.();
    setIsReplaying(true);

    // Coalesce recording elements (they're already GraphNode/GraphEdge from the refactored stream)
    const rawNodes = recording.events.filter(e => e.category === 'node_added').map(e => e.element);
    const rawEdges = recording.events.filter(e => e.category === 'edge_added').map(e => e.element);
    const { nodes: coalescedNodes, edges: coalescedEdges, idRemap } = coalesceGraphData(rawNodes, rawEdges, {});

    // Rebuild interleaved order
    const coalescedNodeMap = Object.fromEntries(coalescedNodes.map(n => [n.id, n]));
    const emittedIds = new Set();
    const allItems = [];

    for (const evt of recording.events) {
      const el = evt.element;
      if (!el) continue;
      if (!('source' in el)) {
        // Node
        if (idRemap[el.id]) continue;
        if (coalescedNodeMap[el.id] && !emittedIds.has(el.id)) {
          allItems.push(coalescedNodeMap[el.id]);
          emittedIds.add(el.id);
        }
      } else {
        // Edge
        const src = idRemap[el.source] || el.source;
        const tgt = idRemap[el.target] || el.target;
        for (const ce of coalescedEdges) {
          if (emittedIds.has(ce.id)) continue;
          if ((ce.source === src && ce.target === tgt) || (ce.source === tgt && ce.target === src)) {
            allItems.push(ce);
            emittedIds.add(ce.id);
            break;
          }
        }
      }
    }
    for (const ce of coalescedEdges) {
      if (!emittedIds.has(ce.id)) { allItems.push(ce); emittedIds.add(ce.id); }
    }

    if (allItems.length === 0) {
      setIsReplaying(false);
      return;
    }

    allItems.forEach((el, i) => {
      const timer = setTimeout(() => {
        const cy = cytoscape.cy.current;
        if (!cy) return;
        const cyEl = ('source' in el) ? graphEdgeToCyElement(el) : graphNodeToCyElement(el);
        if (cy.getElementById(cyEl.data.id).length > 0) return;
        filters.registerStreamedElements([el]);
        try {
          const added = cy.add(cyEl);
          added.addClass('streaming-new');
          positionStreamedNode(cy, cyEl);
          if (!('source' in el)) incrementStats([el], 0);
          else incrementStats(0, 1);
          setTimeout(() => { if (added.inside()) added.removeClass('streaming-new'); }, GLOW_DURATION);
          // Push breadcrumb
          const category = !('source' in el) ? 'node_added' : 'edge_added';
          const label = !('source' in el)
            ? `Node "${el.label || el.id}"`
            : `Edge "${el.label || el.type || 'link'}"`;
          stream?.pushOperation?.({
            id: `replay-${i}-${el.id}`,
            timestamp: new Date().toISOString(),
            category,
            label,
            nodeId: !('source' in el) ? el.id : el.source,
            meta: { data: el },
          });
        } catch {
          // Edge endpoint missing
        }
        if (!userInteractedRef.current && !('source' in el)) {
          cy.fit(getFitElements(cy), getFitPadding(cy));
        }
        if (i === allItems.length - 1) {
          scheduleQuietLayout();
          setTimeout(() => setIsReplaying(false), GLOW_DURATION);
        }
      }, i * dripIntervalRef.current);
      dripTimersRef.current.push(timer);
    });
  }, [cytoscape, incrementStats, positionStreamedNode, scheduleQuietLayout, filters, stream]);

  // Detect manual zoom/pan
  useEffect(() => {
    const cy = cytoscape.cy.current;
    if (!cy) return;
    const markInteracted = () => { userInteractedRef.current = true; };
    cy.on('scrollzoom', markInteracted);
    cy.on('dragpan', markInteracted);
    return () => {
      cy.off('scrollzoom', markInteracted);
      cy.off('dragpan', markInteracted);
    };
  }, [cytoscape.cy, cytoscape.ready]);

  // Cleanup on unmount
  useEffect(() => () => {
    dripTimersRef.current.forEach(clearTimeout);
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
  }, []);

  // Reset helpers
  const resetDrip = useCallback(() => {
    dripTimersRef.current.forEach(clearTimeout);
    dripTimersRef.current = [];
    dripQueueRef.current = [];
    entityIndexRef.current = 0;
    userInteractedRef.current = false;
    if (relayoutTimerRef.current) { clearTimeout(relayoutTimerRef.current); relayoutTimerRef.current = null; }
  }, []);

  return {
    enqueue,
    replayRecording,
    isReplaying,
    setIsReplaying,
    dripInterval,
    setDripInterval,
    resetDrip,
    userInteractedRef,
    dripTimersRef,
  };
}
