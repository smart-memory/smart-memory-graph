import { useState, useEffect, useCallback, useRef } from 'react';
import { graphNodeToCyElement, graphEdgeToCyElement } from '../internal/cytoscapeConvert';
import { coalesceGraphData } from '../core/coalesce';
import { getFitElements, getFitPadding, STREAMING_LAYOUT } from '../internal/useCytoscape';

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
  const panTimerRef = useRef(null);

  // Fit viewport after streaming goes quiet — no layout reshuffle, cola physics
  // has already settled positions. Fires at 800ms so it catches the gap between
  // passages without reshuffling the graph when the next passage starts.
  const scheduleQuietLayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      relayoutTimerRef.current = null;
      if (!userInteractedRef.current) {
        const cy = cytoscape.cy.current;
        if (cy) cy.animate({ fit: { eles: getFitElements(cy), padding: getFitPadding(cy) } }, { duration: 400, easing: 'ease-in-out-sine' });
      }
    }, 800);
  }, [cytoscape]);

  // Position a node during streaming: entity nodes born at parent position,
  // cola physics drifts them to their settled location (unfurling effect).
  const positionStreamedNode = useCallback((cy, cyEl) => {
    if (cyEl.group !== 'nodes') return;
    const node = cy.getElementById(cyEl.data.id);
    if (!node.length) return;

    const parentId = cyEl.data.parentId;
    if (parentId) {
      // Born at parent position — cola physics drifts it outward
      const parent = cy.getElementById(parentId);
      if (parent.length) {
        node.position({ x: parent.position().x, y: parent.position().y });
      }
    } else {
      // Memory node: place along horizontal row
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
      const isNode = !('source' in el);
      const added = cy.add(cyEl);
      positionStreamedNode(cy, cyEl);
      if (isNode) incrementStats([el], 0);
      else incrementStats(0, 1);

      // ── Entry animation → glow → physics (sequenced via complete callback) ──
      // streaming-new class and cola physics are deferred until the entry
      // animation finishes so that:
      //   (a) the edge.streaming-new stylesheet (opacity:1) doesn't fight the fade-in
      //   (b) cola doesn't drift the node while it's still invisible at spawn position
      if (isNode) {
        const targetW = added.style('width');
        const targetH = added.style('height');
        added.style({ width: 0, height: 0, opacity: 0 });
        added.animate(
          { style: { width: targetW, height: targetH, opacity: 1 } },
          {
            duration: 250,
            easing: 'ease-out-cubic',
            complete: () => {
              added.addClass('streaming-new');
              setTimeout(() => { if (added.inside()) added.removeClass('streaming-new'); }, GLOW_DURATION);
              cy.layout(STREAMING_LAYOUT).run();
            },
          }
        );
      } else {
        added.style({ opacity: 0 });
        added.animate(
          { style: { opacity: 1 } },
          {
            duration: 150,
            easing: 'ease-out-sine',
            complete: () => {
              added.addClass('streaming-new');
              setTimeout(() => { if (added.inside()) added.removeClass('streaming-new'); }, GLOW_DURATION);
              cy.layout(STREAMING_LAYOUT).run();
            },
          }
        );
      }
      // ────────────────────────────────────────────────────────────────────
    } catch {
      // Edge endpoint missing
    }

    // ── Throttled fit during streaming ───────────────────────────────────
    // Smoothly fits all elements into view as nodes and edges appear.
    // Fires for both nodes and edges, throttled to at most once per 400ms
    // so it doesn't fight the cola layout physics running in parallel.
    if (!userInteractedRef.current && !panTimerRef.current) {
      panTimerRef.current = setTimeout(() => {
        panTimerRef.current = null;
        if (!userInteractedRef.current) {
          cy.animate(
            { fit: { eles: getFitElements(cy), padding: getFitPadding(cy) } },
            { duration: 350, easing: 'ease-in-out-sine' }
          );
        }
      }, 400);
    }
    // ────────────────────────────────────────────────────────────────────

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
          const isNode = !('source' in el);
          const added = cy.add(cyEl);
          positionStreamedNode(cy, cyEl);
          if (isNode) incrementStats([el], 0);
          else incrementStats(0, 1);

          // ── Entry animation → glow → physics (sequenced via complete) ──
          if (isNode) {
            const targetW = added.style('width');
            const targetH = added.style('height');
            added.style({ width: 0, height: 0, opacity: 0 });
            added.animate(
              { style: { width: targetW, height: targetH, opacity: 1 } },
              {
                duration: 250,
                easing: 'ease-out-cubic',
                complete: () => {
                  added.addClass('streaming-new');
                  setTimeout(() => { if (added.inside()) added.removeClass('streaming-new'); }, GLOW_DURATION);
                  cy.layout(STREAMING_LAYOUT).run();
                },
              }
            );
          } else {
            added.style({ opacity: 0 });
            added.animate(
              { style: { opacity: 1 } },
              {
                duration: 150,
                easing: 'ease-out-sine',
                complete: () => {
                  added.addClass('streaming-new');
                  setTimeout(() => { if (added.inside()) added.removeClass('streaming-new'); }, GLOW_DURATION);
                  cy.layout(STREAMING_LAYOUT).run();
                },
              }
            );
          }
          // ──────────────────────────────────────────────────────────────

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
    if (panTimerRef.current) clearTimeout(panTimerRef.current);
  }, []);

  // Reset helpers
  const resetDrip = useCallback(() => {
    dripTimersRef.current.forEach(clearTimeout);
    dripTimersRef.current = [];
    dripQueueRef.current = [];
    entityIndexRef.current = 0;
    userInteractedRef.current = false;
    if (relayoutTimerRef.current) { clearTimeout(relayoutTimerRef.current); relayoutTimerRef.current = null; }
    if (panTimerRef.current) { clearTimeout(panTimerRef.current); panTimerRef.current = null; }
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
