import { useRef, useEffect, useCallback, useState } from 'react';
import cytoscape from 'cytoscape';
import cola from 'cytoscape-cola';
import coseBilkent from 'cytoscape-cose-bilkent';
import dagre from 'cytoscape-dagre';
import { getCytoscapeStyles } from './cytoscapeStyles';
import { ANNOTATION_PRECEDENCE, CHANNEL_LOCKED_KINDS } from '../core/graphColors';

// Register layout extensions once
let registered = false;
if (!registered) {
  cytoscape.use(cola);
  cytoscape.use(coseBilkent);
  cytoscape.use(dagre);
  registered = true;
}

/**
 * Layout config for the streaming/unfurling phase.
 * Runs cola force simulation continuously so newly arrived nodes drift
 * to their settled position while the stream is active.
 * Called directly via cy.layout(STREAMING_LAYOUT).run() — NOT via runLayout(),
 * which uses a layoutDefaults map and firstLayoutRef that would clobber this config.
 */
export const STREAMING_LAYOUT = {
  name: 'cola',
  animate: true,
  animationDuration: 150,
  refresh: 2,
  maxSimulationTime: 1500,
  ungrabifyWhileSimulating: false,
  fit: false,
  padding: 40,
  nodeSpacing: () => 20,
  edgeLength: 120,
  randomize: false,
  avoidOverlap: true,
};

/**
 * Get the elements that should define the fit bounds: visible AND not dimmed.
 * Falls back to all visible if everything is dimmed (avoids fitting to empty set).
 */
export function getFitElements(cy) {
  const active = cy.elements(':visible').not('.dimmed');
  return active.length > 0 ? active : cy.elements(':visible');
}

/** Padding proportional to the viewport's smaller dimension (5%, clamped 20–80px). */
export function getFitPadding(cy) {
  return Math.round(Math.max(20, Math.min(80, Math.min(cy.width(), cy.height()) * 0.05)));
}

export function useCytoscape(containerRef) {
  const cyRef = useRef(null);
  const [containerReady, setContainerReady] = useState(false);
  const [cyReady, setCyReady] = useState(false);

  // Autofit: when enabled, cy.fit() runs on every container resize
  const [autoFit, setAutoFit] = useState(true);
  const autoFitRef = useRef(true);
  useEffect(() => { autoFitRef.current = autoFit; }, [autoFit]);

  const [selectedNodeIds, setSelectedNodeIds] = useState(new Set());
  const [selectionMode, setSelectionModeState] = useState(false);
  const selectionModeRef = useRef(false);

  // Stable ref for event callbacks
  const onNodeClickRef = useRef(null);
  const onNodeDblClickRef = useRef(null);
  const onNodeHoverRef = useRef(null);
  const onNodeHoverOutRef = useRef(null);
  const onBgClickRef = useRef(null);

  const setContainerRef = useCallback((node) => {
    containerRef.current = node;
    setContainerReady(!!node);
  }, [containerRef]);

  // Initialize Cytoscape when container is available
  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) return;

    const container = containerRef.current;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const cy = cytoscape({
      container,
      style: getCytoscapeStyles(),
      elements: [],
      layout: { name: 'preset' },
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      autounselectify: false,
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      if (!node.isNode() || node === cy) return;
      // In selection mode, tap toggles selection only — don't open detail panel.
      if (selectionModeRef.current) return;
      if (onNodeClickRef.current) onNodeClickRef.current(node.data());
    });
    cy.on('dbltap', 'node', (evt) => {
      const node = evt.target;
      if (node !== cy && node.isNode() && onNodeDblClickRef.current) {
        onNodeDblClickRef.current(node.data());
      }
    });
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      if (node === cy || !node.isNode()) return;

      cy.batch(() => {
        const neighborhood = node.closedNeighborhood();
        // Dim visible non-neighbors (skip already-hidden .dimmed elements)
        cy.elements(':visible').not(neighborhood).not('.dimmed').addClass('hover-dimmed');
        // Reveal labels on this node's connected edges
        node.connectedEdges(':visible').addClass('hover-edge-visible');
        node.addClass('hovered');
      });

      if (onNodeHoverRef.current) {
        const pos = evt.renderedPosition || evt.position;
        onNodeHoverRef.current(node.data(), pos);
      }
    });
    cy.on('mouseout', 'node', () => {
      cy.batch(() => {
        cy.elements().removeClass('hover-dimmed hover-edge-visible hovered');
      });
      onNodeHoverOutRef.current?.();
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().unselect();
        cy.elements().removeClass('neighbor');
        onBgClickRef.current?.();
      }
    });

    // Track selected nodes for multi-select delete
    const syncSelection = () => {
      setSelectedNodeIds(new Set(cy.nodes(':selected').map((n) => n.id())));
    };
    cy.on('select unselect', 'node', syncSelection);

    const resizeObserver = new ResizeObserver(() => {
      cy.resize();
      if (autoFitRef.current && cy.nodes().length > 0) {
        cy.fit(getFitElements(cy), getFitPadding(cy));
      }
    });
    resizeObserver.observe(container);

    cyRef.current = cy;
    setCyReady(true);

    return () => {
      resizeObserver.disconnect();
      cy.destroy();
      cyRef.current = null;
      setCyReady(false);
    };
  }, [containerReady, containerRef]);

  const setElements = useCallback((elements) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });
  }, []);

  /**
   * Diff-merge elements into the graph, preserving positions of existing nodes.
   * Returns { isInitial: true } when the graph was empty before (full layout needed).
   * On refresh (graph already populated), positions are restored and no layout is run.
   */
  const mergeElements = useCallback((elements) => {
    const cy = cyRef.current;
    if (!cy) return { isInitial: true };

    const existingIds = new Set(cy.nodes().map((n) => n.id()));
    const isInitial = existingIds.size === 0;

    // Snapshot positions of every existing node before replace.
    const savedPositions = {};
    if (!isInitial) {
      cy.nodes().forEach((n) => {
        savedPositions[n.id()] = { ...n.position() };
      });
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
      // Restore saved positions for nodes that survived the refresh.
      if (!isInitial) {
        cy.nodes().forEach((n) => {
          const pos = savedPositions[n.id()];
          if (pos) n.position(pos);
        });
      }
    });

    return { isInitial };
  }, []);

  const firstLayoutRef = useRef(true);

  const runLayout = useCallback((layoutName = 'cose-bilkent', options = {}) => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    const isFirst = firstLayoutRef.current;
    const shouldAnimate = !firstLayoutRef.current;
    firstLayoutRef.current = false;

    const layoutDefaults = {
      'cose-bilkent': {
        name: 'cose-bilkent',
        quality: 'default',
        // Use true (morph) instead of 'end' (jump-to-end) for smooth position transitions
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 100,
        edgeElasticity: 0.45,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 500,
        tile: true,
        randomize: shouldAnimate,
      },
      dagre: {
        name: 'dagre',
        rankDir: 'TB',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        nodeSep: 50,
        rankSep: 80,
      },
      circle: {
        name: 'circle',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
      },
      concentric: {
        name: 'concentric',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        concentric: (node) => node.degree(),
        levelWidth: () => 2,
      },
      grid: {
        name: 'grid',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        condense: true,
      },
    };

    const config = { ...(layoutDefaults[layoutName] || { name: layoutName }), ...options };

    if (isFirst) {
      // Entrance animation: compute layout positions first, then stagger nodes in.
      // Layout runs with animate:false so positions are computed instantly without
      // visual motion, then we collapse nodes to center and animate to final positions.
      // randomize:true is required so cose-bilkent can spread nodes from non-degenerate
      // start positions — without it, all nodes at {0,0} produce a collapsed result.
      const entranceConfig = { ...config, animate: false, randomize: true };
      const layout = cy.layout(entranceConfig);

      cy.one('layoutstop', () => {
        // Save final positions and target sizes computed by the layout
        const finalPositions = {};
        const targetSizes = {};
        cy.nodes().forEach((n) => {
          finalPositions[n.id()] = { ...n.position() };
          targetSizes[n.id()] = {
            w: parseFloat(n.style('width')),
            h: parseFloat(n.style('height')),
          };
        });

        // Collapse all nodes to viewport center (in graph coordinates)
        const pan = cy.pan();
        const zoom = cy.zoom();
        const vcx = (cy.width() / 2 - pan.x) / zoom;
        const vcy = (cy.height() / 2 - pan.y) / zoom;

        cy.batch(() => {
          cy.nodes().forEach((n) => {
            n.position({ x: vcx, y: vcy });
            n.style({ opacity: 0, width: 0, height: 0 });
          });
          cy.edges().style({ opacity: 0 });
        });

        // Stagger-animate nodes to their final positions (20ms between each, capped at 800ms).
        // Look up nodes by ID at animation time (not via captured references) so that a
        // concurrent mergeElements() call — which removes + re-adds elements — doesn't
        // silently skip all animations because n.inside() === false on stale objects.
        const nodeIds = cy.nodes().map((n) => n.id());
        nodeIds.forEach((nodeId, i) => {
          const pos = finalPositions[nodeId];
          const { w, h } = targetSizes[nodeId] || { w: 16, h: 16 };
          setTimeout(() => {
            const fresh = cyRef.current?.getElementById(nodeId);
            if (!fresh?.length) return;
            fresh.animate(
              { position: pos, style: { opacity: 1, width: w, height: h } },
              { duration: 300, easing: 'ease-out-cubic' }
            );
          }, Math.min(i * 20, 800));
        });

        // Fade edges in after nodes have mostly appeared
        const edgeDelay = Math.min(nodeIds.length * 20, 800) + 150;
        setTimeout(() => {
          if (!cyRef.current) return;
          cyRef.current.edges().forEach((e) => {
            if (!e.inside()) return;
            e.animate(
              { style: { opacity: 0.6 } },
              { duration: 200, easing: 'ease-out-sine' }
            );
          });
        }, edgeDelay);
      });

      layout.run();
    } else {
      cy.layout(config).run();
    }
  }, []);

  const zoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, []);

  const zoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, []);

  const fitToScreen = useCallback(() => {
    const cy = cyRef.current;
    if (cy) cy.fit(getFitElements(cy), getFitPadding(cy));
  }, []);

  const applyFilter = useCallback((visibleNodeIds, visibleEdgeTypes, cascade = true) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      const nodesWithVisibleEdge = new Set();
      const targetsOfFilteredEdges = new Set();
      cy.edges().forEach((edge) => {
        const srcTypeOk = visibleNodeIds.has(edge.source().id());
        const tgtTypeOk = visibleNodeIds.has(edge.target().id());
        const edgeTypeOk = !visibleEdgeTypes || visibleEdgeTypes.has(edge.data('type'));
        if (srcTypeOk && tgtTypeOk && edgeTypeOk) {
          edge.removeClass('dimmed');
          nodesWithVisibleEdge.add(edge.source().id());
          nodesWithVisibleEdge.add(edge.target().id());
        } else {
          edge.addClass('dimmed');
          if (srcTypeOk && tgtTypeOk && !edgeTypeOk) {
            targetsOfFilteredEdges.add(edge.target().id());
          }
        }
      });

      cy.nodes().forEach((node) => {
        if (!visibleNodeIds.has(node.id())) {
          node.addClass('dimmed');
          return;
        }
        if (!cascade) {
          node.removeClass('dimmed');
          return;
        }
        const hasVisibleEdge = nodesWithVisibleEdge.has(node.id());
        if (!hasVisibleEdge) {
          node.addClass('dimmed');
        } else {
          node.removeClass('dimmed');
        }
      });
    });
  }, []);

  const applyAnnotations = useCallback((annotations) => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // 1. Clear all previous annotation classes
      cy.elements().forEach((ele) => {
        const classes = ele.classes();
        classes.forEach((cls) => {
          if (cls.startsWith('anno-')) ele.removeClass(cls);
        });
      });

      if (!annotations || !annotations.activeKinds?.length) return;

      // 2. Resolve precedence per element.
      // Channel assignment is computed per-element based on which kinds are actually
      // present on that element, not globally. A node with only 'confidence' gets
      // fill for confidence, even if diff/ontology_status are globally active.
      const precedence = annotations.precedence || ANNOTATION_PRECEDENCE;
      const availableChannels = ['fill', 'border', 'opacity'];
      const lockedKinds = CHANNEL_LOCKED_KINDS || {};

      const resolveChannels = (annoList) => {
        const assignment = {};
        // Channel-locked kinds first
        for (const anno of annoList) {
          if (lockedKinds[anno.kind]) {
            assignment[anno.kind] = lockedKinds[anno.kind];
          }
        }
        // Competing kinds by precedence (only kinds present on this element)
        const presentKinds = new Set(annoList.map((a) => a.kind));
        let chIdx = 0;
        for (const kind of precedence) {
          if (!presentKinds.has(kind)) continue;
          if (assignment[kind]) continue;
          if (chIdx < availableChannels.length) {
            assignment[kind] = availableChannels[chIdx++];
          }
        }
        return assignment;
      };

      // 3. Apply channel-scoped classes
      const applyToElement = (eleId, annoList) => {
        const ele = cy.getElementById(eleId);
        if (!ele.length) return;
        const assignment = resolveChannels(annoList);
        for (const anno of annoList) {
          const channel = assignment[anno.kind];
          if (!channel) continue;
          ele.addClass(`anno-${channel}-${anno.kind}-${anno.value}`);
        }
      };

      if (annotations.nodes) {
        for (const [nodeId, annoList] of Object.entries(annotations.nodes)) {
          applyToElement(nodeId, annoList);
        }
      }
      if (annotations.edges) {
        for (const [edgeId, annoList] of Object.entries(annotations.edges)) {
          applyToElement(edgeId, annoList);
        }
      }
    });
  }, []);

  const clearAnnotations = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().forEach((ele) => {
        const classes = ele.classes();
        classes.forEach((cls) => {
          if (cls.startsWith('anno-')) ele.removeClass(cls);
        });
      });
    });
  }, []);

  const clearHighlights = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('highlighted dimmed neighbor');
    });
  }, []);

  const highlightElements = useCallback((nodeIds, edgeIds = []) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('highlighted');
      nodeIds.forEach((id) => {
        const node = cy.getElementById(id);
        if (node.length) node.addClass('highlighted');
      });
      edgeIds.forEach((id) => {
        const edge = cy.getElementById(id);
        if (edge.length) edge.addClass('highlighted');
      });
    });
  }, []);

  const addElements = useCallback((newElements) => {
    const cy = cyRef.current;
    if (!cy) return 0;
    let addedCount = 0;
    cy.batch(() => {
      for (const el of newElements) {
        const id = el.data?.id;
        if (id && !cy.getElementById(id).length) {
          cy.add(el);
          addedCount++;
        }
      }
    });
    return addedCount;
  }, []);

  const selectNode = useCallback((nodeId) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('neighbor');
      const node = cy.getElementById(nodeId);
      if (node.length) {
        node.select();
        node.neighborhood().nodes().addClass('neighbor');
      }
    });
  }, []);

  const getConnectedEdges = useCallback((nodeId) => {
    const cy = cyRef.current;
    if (!cy) return [];
    const node = cy.getElementById(nodeId);
    if (!node.length) return [];
    return node.connectedEdges().map((e) => e.data());
  }, []);

  const LOD_THRESHOLD = 200;

  const removeClustering = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => n.move({ parent: null }));
      cy.nodes('.lod-cluster').remove();
    });
  }, []);

  const applyClustering = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const visibleNodes = cy.nodes(':visible').not(':parent');
    if (visibleNodes.length <= LOD_THRESHOLD) {
      removeClustering();
      return;
    }

    const groups = {};
    visibleNodes.forEach((node) => {
      const type = node.data('type') || 'unknown';
      if (!groups[type]) groups[type] = [];
      groups[type].push(node);
    });

    cy.batch(() => {
      cy.nodes().forEach((n) => {
        if (n.parent().hasClass('lod-cluster')) {
          n.move({ parent: null });
        }
      });
      cy.nodes('.lod-cluster').remove();

      for (const [type, nodes] of Object.entries(groups)) {
        if (nodes.length < 5) continue;

        const clusterId = `__cluster_${type}`;
        cy.add({
          group: 'nodes',
          data: {
            id: clusterId,
            label: `${type} (${nodes.length})`,
            type,
            category: 'cluster',
          },
          classes: 'lod-cluster',
        });

        for (const node of nodes) {
          node.move({ parent: clusterId });
        }
      }
    });
  }, [removeClustering]);

  const setOnNodeClick = useCallback((fn) => { onNodeClickRef.current = fn; }, []);
  const setOnNodeDblClick = useCallback((fn) => { onNodeDblClickRef.current = fn; }, []);
  const setOnNodeHover = useCallback((fn) => { onNodeHoverRef.current = fn; }, []);
  const setOnNodeHoverOut = useCallback((fn) => { onNodeHoverOutRef.current = fn; }, []);
  const setOnBgClick = useCallback((fn) => { onBgClickRef.current = fn; }, []);

  // Toggle pan/select mode. In select mode: box selection enabled, nodes non-grabbable,
  // tap opens box-select instead of detail panel.
  const setSelectionMode = useCallback((enabled) => {
    selectionModeRef.current = enabled;
    setSelectionModeState(enabled);
    const cy = cyRef.current;
    if (!cy) return;
    cy.boxSelectionEnabled(enabled);
    cy.userPanningEnabled(!enabled);
    if (enabled) {
      cy.nodes().ungrabify();
    } else {
      cy.nodes().grabify();
      // Exit selection mode: clear selection highlights
      cy.elements().unselect();
      setSelectedNodeIds(new Set());
    }
  }, []);

  // Select all visible (non-dimmed) nodes
  const selectAll = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().not('.dimmed').select();
  }, []);

  // Remove a set of nodes (and their edges) from the graph. Called after backend delete.
  const removeNodes = useCallback((ids) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      ids.forEach((id) => {
        const el = cy.getElementById(id);
        if (el.length) cy.remove(el.closedNeighborhood().filter((e) => e.isEdge()).union(el));
      });
    });
    setSelectedNodeIds(new Set());
  }, []);

  return {
    cy: cyRef,
    ready: cyReady,
    setContainerRef,
    setElements,
    mergeElements,
    addElements,
    runLayout,
    zoomIn,
    zoomOut,
    fitToScreen,
    applyFilter,
    applyAnnotations,
    clearAnnotations,
    clearHighlights,
    highlightElements,
    selectNode,
    getConnectedEdges,
    applyClustering,
    removeClustering,
    setOnNodeClick,
    setOnNodeDblClick,
    setOnNodeHover,
    setOnNodeHoverOut,
    setOnBgClick,
    autoFit,
    setAutoFit,
    selectedNodeIds,
    removeNodes,
    selectAll,
    selectionMode,
    setSelectionMode,
  };
}
