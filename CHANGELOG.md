# Changelog

## 0.1.0 (2026-02-17)

Initial release — extracted from `smart-memory-viewer`.

### Added
- 11 React components: GraphExplorer, DetailPanel, FilterPanel, SearchBar, Toolbar, OperationsBar, CytoscapeCanvas, NodeTooltip, WikipediaOverlay, ReplayButton, TimeTravelSlider
- 8 React hooks: useGraphData, useGraphFilters, useGraphStream, useGraphInteraction, useDripFeed, useUrlState, useConnectionStatus, useEntityCorrections
- 2 adapter factories: createFetchAdapter (raw fetch), createSDKAdapter (JS SDK stub)
- Core utilities: graph colors, constants, event classification, normalization, coalescing, wikipedia search, PNG/SVG export, event recording
- Canonical GraphNode/GraphEdge types with single conversion boundary to Cytoscape
- 24 unit tests for classifyEvent and eventTransform
