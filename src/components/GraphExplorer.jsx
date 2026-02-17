import { useState, useEffect, useCallback, useRef } from 'react';
import CytoscapeCanvas from './CytoscapeCanvas';
import Toolbar from './Toolbar';
import FilterPanel from './FilterPanel';
import DetailPanel from './DetailPanel';
import SearchBar from './SearchBar';
import TimeTravelSlider from './TimeTravelSlider';
import OperationsBar from './OperationsBar';
import ReplayButton from './ReplayButton';
import { useCytoscape } from '../internal/useCytoscape';
import { useGraphData } from '../hooks/useGraphData';
import { useGraphFilters } from '../hooks/useGraphFilters';
import { useGraphStream } from '../hooks/useGraphStream';
import { useDripFeed } from '../hooks/useDripFeed';
import { useGraphInteraction } from '../hooks/useGraphInteraction';
import { useUrlState } from '../hooks/useUrlState';
import { graphNodeToCyElement, graphEdgeToCyElement } from '../internal/cytoscapeConvert';

/**
 * Main graph explorer component.
 * Orchestrates data fetching, streaming, filtering, and interaction hooks.
 *
 * @param {Object} props
 * @param {GraphAPIAdapter} props.adapter - API adapter for data fetching
 * @param {{ nodes: GraphNode[], edges: GraphEdge[] }} [props.data] - External data (controlled mode)
 * @param {Object} [props.annotations] - Annotations overlay (future)
 * @param {string} [props.wsUrl] - WebSocket URL for streaming
 * @param {string} [props.wsToken] - JWT token for WebSocket auth
 * @param {string} [props.className] - Additional CSS classes
 */
export default function GraphExplorer({
  adapter,
  data: externalData,
  annotations,
  wsUrl,
  wsToken,
  className = '',
}) {
  // Data: use external data (controlled) or fetch via adapter (uncontrolled)
  const internalData = useGraphData(externalData ? null : adapter);
  const { nodes, edges, loading, error, stats, refresh, incrementStats } = externalData
    ? { nodes: externalData.nodes, edges: externalData.edges, loading: false, error: null, stats: { nodes: externalData.nodes.length, edges: externalData.edges.length, types: {} }, refresh: () => {}, incrementStats: () => {} }
    : internalData;

  const filters = useGraphFilters(nodes, edges);
  const containerRef = useRef(null);
  const cytoscape = useCytoscape(containerRef);
  const { urlState, saveToUrl, getShareableUrl } = useUrlState();

  const [filterPanelOpen, setFilterPanelOpen] = useState(true);

  // Refs to break forward-reference between stream ↔ dripFeed
  const dripFeedRef = useRef(null);
  const streamRef = useRef(null);

  // Streaming
  const stream = useGraphStream({
    wsUrl,
    token: wsToken,
    enabled: !!wsUrl,
    onElementAdded: (el) => dripFeedRef.current?.enqueue(el),
    onSearchHighlight: (ids) => cytoscape.highlightElements(ids),
    onGroundingFlash: (nodeId) => {
      const cy = cytoscape.cy?.current;
      if (!cy) return;
      const node = cy.getElementById(nodeId);
      if (node && node.length) {
        node.addClass('grounding-flash');
        setTimeout(() => node.removeClass('grounding-flash'), 2500);
      }
    },
    onGraphCleared: () => {
      dripFeedRef.current?.resetDrip();
      streamRef.current?.clearOperations();
      refresh();
    },
    onReconnect: () => refresh(),
  });
  streamRef.current = stream;

  // Drip-feed animation
  const interaction = useGraphInteraction({
    cytoscape,
    adapter,
    stream,
    filters,
    urlState,
    data: { nodes, edges },
    refresh,
    getShareableUrl,
    saveToUrl,
  });

  const dripFeed = useDripFeed({
    cytoscape,
    filters,
    incrementStats,
    layout: interaction.layout,
    stream,
  });
  dripFeedRef.current = dripFeed;

  // Convert GraphNode/GraphEdge → Cytoscape elements and load into cy
  useEffect(() => {
    if (!cytoscape.ready) return;
    if (nodes.length > 0 || edges.length > 0) {
      const cyElements = [
        ...nodes.map(graphNodeToCyElement),
        ...edges.map(graphEdgeToCyElement),
      ];
      cytoscape.setElements(cyElements);
      cytoscape.runLayout(interaction.layout);

      // Replay any WS events that arrived during the API fetch
      const pending = stream.drainPending();
      if (pending.length > 0) {
        const pendingCyEls = pending.map((el) =>
          'source' in el ? graphEdgeToCyElement(el) : graphNodeToCyElement(el)
        );
        cytoscape.addElements(pendingCyEls);
      }

      // Safety net: if cy is empty after setElements, retry once
      const retryTimer = setTimeout(() => {
        const cy = cytoscape.cy.current;
        if (cy && cy.nodes().length === 0 && nodes.length > 0) {
          cytoscape.setElements(cyElements);
          cytoscape.runLayout(interaction.layout);
        }
      }, 300);
      return () => clearTimeout(retryTimer);
    } else if (!loading) {
      cytoscape.setElements([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, cytoscape.ready, loading]);

  // Apply filters whenever they change
  useEffect(() => {
    cytoscape.applyFilter(filters.visibleNodeIds, filters.activeEdgeTypes, filters.cascadeEdgeFilter);
  }, [filters.visibleNodeIds, filters.activeEdgeTypes, filters.cascadeEdgeFilter, cytoscape]);

  // Operations bar click handler — scrub to event state
  const handleOperationClick = useCallback((op) => {
    const cy = cytoscape.cy.current;
    if (!cy) return;

    if (op.category === 'node_added' || op.category === 'edge_added' || op.category === 'graph_cleared') {
      dripFeed.dripTimersRef.current.forEach(clearTimeout);
      dripFeed.dripTimersRef.current = [];

      if (op.category === 'graph_cleared') {
        const cyElements = [
          ...nodes.map(graphNodeToCyElement),
          ...edges.map(graphEdgeToCyElement),
        ];
        cytoscape.setElements(cyElements);
      } else {
        const streamState = stream.getStateUpTo(op.id);
        if (streamState) {
          const baseCyEls = [
            ...nodes.map(graphNodeToCyElement),
            ...edges.map(graphEdgeToCyElement),
          ];
          const baseIds = new Set(baseCyEls.map(e => e.data.id));
          const newCyEls = [
            ...streamState.nodes.map(graphNodeToCyElement),
            ...streamState.edges.map(graphEdgeToCyElement),
          ].filter(e => !baseIds.has(e.data.id));
          cytoscape.setElements([...baseCyEls, ...newCyEls]);
        }
      }
      cytoscape.runLayout(interaction.layout);
      stream.pause();
    }

    // Highlight affected nodes
    const ids = [];
    if (op.nodeId) ids.push(op.nodeId);
    if (op.matchIds?.length) ids.push(...op.matchIds);
    if (ids.length === 0) return;

    setTimeout(() => {
      cytoscape.highlightElements(ids);
      const primary = cy.getElementById(ids[0]);
      if (primary.length) {
        interaction.handleNodeClick(primary.data());
        cy.animate({ center: { eles: primary }, duration: 300 });
      }
    }, 50);
  }, [cytoscape, nodes, edges, stream, interaction, dripFeed]);

  // Error state
  if (error && nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center max-w-md">
          <div className="text-red-400 text-4xl mb-4">!</div>
          <p className="text-red-300 font-medium mb-2">Failed to load graph</p>
          <p className="text-slate-400 text-sm mb-4">{error}</p>
          <button
            onClick={interaction.handleRefresh}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-screen w-screen flex flex-col bg-slate-900 overflow-hidden ${className}`}>
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/80 pointer-events-none">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
            <p className="text-slate-400">Loading knowledge graph...</p>
          </div>
        </div>
      )}

      <Toolbar
        layout={interaction.layout}
        onLayoutChange={interaction.handleLayoutChange}
        onZoomIn={cytoscape.zoomIn}
        onZoomOut={cytoscape.zoomOut}
        onFitToScreen={cytoscape.fitToScreen}
        onRefresh={interaction.handleRefresh}
        onToggleFilters={() => setFilterPanelOpen((p) => !p)}
        onPathMode={interaction.handlePathMode}
        pathMode={interaction.pathMode}
        stats={stats}
        cy={cytoscape.cy}
        onCopyLink={interaction.handleCopyLink}
        onToggleTimeTravelSlider={() => interaction.setTimeTravelOpen((p) => !p)}
        timeTravelActive={interaction.timeTravelOpen || !!interaction.asOfTime}
        autoFit={cytoscape.autoFit}
        onAutoFitChange={cytoscape.setAutoFit}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {filterPanelOpen && (
          <FilterPanel
            filters={filters}
            onClose={() => setFilterPanelOpen(false)}
          />
        )}

        <CytoscapeCanvas
          setContainerRef={cytoscape.setContainerRef}
        />

        {/* Detail panel — absolute overlay */}
        {interaction.detailPanelOpen && interaction.selectedNode && (
          <div className="absolute right-0 top-0 bottom-0 z-30">
            <DetailPanel
              node={interaction.selectedNode}
              edges={interaction.connectedEdges}
              onClose={interaction.closeDetailPanel}
              onExpand={interaction.handleExpand}
              expanding={interaction.expanding}
              onNodeUpdate={interaction.handleNodeUpdate}
              adapter={adapter}
            />
          </div>
        )}
      </div>

      {interaction.timeTravelOpen && (
        <TimeTravelSlider
          onTimeChange={interaction.handleTimeTravel}
          onClose={() => {
            interaction.setTimeTravelOpen(false);
            if (interaction.asOfTime) {
              interaction.handleRefresh();
            }
          }}
        />
      )}

      {interaction.timeTravelLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-purple-900/90 border border-purple-600 text-purple-200 px-4 py-2 rounded-lg text-sm z-50 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          Loading temporal snapshot...
        </div>
      )}

      {interaction.asOfTime && !interaction.timeTravelLoading && (
        <div className="absolute top-16 right-4 bg-purple-900/80 border border-purple-600 text-purple-200 px-3 py-1.5 rounded-lg text-xs z-50">
          Viewing: {new Date(interaction.asOfTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Replay controls */}
      {dripFeed.isReplaying && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 bg-cyan-900/90 border border-cyan-700 text-cyan-200 px-4 py-1.5 rounded-full text-xs font-medium flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          Replaying recording...
          <button
            onClick={() => {
              dripFeed.dripTimersRef.current.forEach(clearTimeout);
              dripFeed.dripTimersRef.current = [];
              dripFeed.setIsReplaying(false);
            }}
            className="ml-2 text-cyan-400 hover:text-cyan-200"
          >
            Stop
          </button>
        </div>
      )}
      <ReplayButton onReplay={dripFeed.replayRecording} disabled={dripFeed.isReplaying} />

      <OperationsBar
        status={stream.status}
        operations={stream.operations}
        opsPerSecond={stream.opsPerSecond}
        isPaused={stream.isPaused}
        onPause={stream.pause}
        onResume={stream.resume}
        dripInterval={dripFeed.dripInterval}
        onDripIntervalChange={dripFeed.setDripInterval}
        onOperationClick={handleOperationClick}
      />

      <SearchBar
        nodes={nodes}
        onSearch={interaction.handleSearch}
        onNodeSelect={(id) => {
          const cy = cytoscape.cy.current;
          if (cy) {
            const node = cy.getElementById(id);
            if (node.length) {
              interaction.handleNodeClick(node.data());
              cy.animate({ center: { eles: node }, duration: 300 });
            }
          }
        }}
      />

      {interaction.pathMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-amber-900/90 border border-amber-600 text-amber-200 px-4 py-2 rounded-lg text-sm z-50">
          Click the START node
          <button onClick={interaction.handlePathMode} className="ml-3 text-amber-400 hover:text-amber-300 underline">Cancel</button>
        </div>
      )}

      {interaction.pathResult?.error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-600 text-red-200 px-4 py-2 rounded-lg text-sm z-50">
          {interaction.pathResult.error}
          <button onClick={() => interaction.setPathResult(null)} className="ml-3 text-red-400 hover:text-red-300 underline">Dismiss</button>
        </div>
      )}
    </div>
  );
}
