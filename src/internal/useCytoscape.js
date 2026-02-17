import { useRef, useEffect, useCallback, useState } from 'react';
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import dagre from 'cytoscape-dagre';
import { getCytoscapeStyles } from './cytoscapeStyles';

// Register layout extensions once
let registered = false;
if (!registered) {
  cytoscape.use(coseBilkent);
  cytoscape.use(dagre);
  registered = true;
}

export function useCytoscape(containerRef) {
  const cyRef = useRef(null);
  const [containerReady, setContainerReady] = useState(false);
  const [cyReady, setCyReady] = useState(false);

  // Autofit: when enabled, cy.fit() runs on every container resize
  const [autoFit, setAutoFit] = useState(true);
  const autoFitRef = useRef(true);
  useEffect(() => { autoFitRef.current = autoFit; }, [autoFit]);

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
      if (node !== cy && node.isNode() && onNodeClickRef.current) {
        onNodeClickRef.current(node.data());
      }
    });
    cy.on('dbltap', 'node', (evt) => {
      const node = evt.target;
      if (node !== cy && node.isNode() && onNodeDblClickRef.current) {
        onNodeDblClickRef.current(node.data());
      }
    });
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      if (node !== cy && node.isNode() && onNodeHoverRef.current) {
        const pos = evt.renderedPosition || evt.position;
        onNodeHoverRef.current(node.data(), pos);
      }
    });
    cy.on('mouseout', 'node', () => {
      onNodeHoverOutRef.current?.();
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().unselect();
        cy.elements().removeClass('neighbor');
        onBgClickRef.current?.();
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      cy.resize();
      if (autoFitRef.current && cy.nodes().length > 0) {
        cy.fit(cy.elements(':visible'), 50);
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

  const firstLayoutRef = useRef(true);

  const runLayout = useCallback((layoutName = 'cose-bilkent', options = {}) => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    const shouldAnimate = !firstLayoutRef.current;
    firstLayoutRef.current = false;

    const layoutDefaults = {
      'cose-bilkent': {
        name: 'cose-bilkent',
        quality: 'default',
        animate: shouldAnimate ? 'end' : false,
        animationDuration: 400,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 100,
        edgeElasticity: 0.45,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 2500,
        tile: true,
        randomize: shouldAnimate,
      },
      dagre: {
        name: 'dagre',
        rankDir: 'TB',
        animate: shouldAnimate,
        animationDuration: 400,
        nodeSep: 50,
        rankSep: 80,
      },
      circle: {
        name: 'circle',
        animate: shouldAnimate,
        animationDuration: 400,
      },
      concentric: {
        name: 'concentric',
        animate: shouldAnimate,
        animationDuration: 400,
        concentric: (node) => node.degree(),
        levelWidth: () => 2,
      },
      grid: {
        name: 'grid',
        animate: shouldAnimate,
        animationDuration: 400,
        condense: true,
      },
    };

    const config = { ...(layoutDefaults[layoutName] || { name: layoutName }), ...options };
    cy.layout(config).run();
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
    if (cy) cy.fit(cy.elements(':visible'), 50);
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
        const isTargetOfFiltered = targetsOfFilteredEdges.has(node.id());
        const hasVisibleEdge = nodesWithVisibleEdge.has(node.id());
        if (isTargetOfFiltered && !hasVisibleEdge) {
          node.addClass('dimmed');
        } else {
          node.removeClass('dimmed');
        }
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

  return {
    cy: cyRef,
    ready: cyReady,
    setContainerRef,
    setElements,
    addElements,
    runLayout,
    zoomIn,
    zoomOut,
    fitToScreen,
    applyFilter,
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
  };
}
