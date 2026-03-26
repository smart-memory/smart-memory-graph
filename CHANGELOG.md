# Changelog

## 0.2.1 (2026-03-26)

### Fixed
- Refresh/operation scrub no longer drops active filter or isolation dimming (setElements/mergeElements now restore dimming state)
- WebSocket-streamed nodes now respect active filters (addElements re-applies dimming after adding)
- Hoisted filter/isolation refs to stable declaration order for consistent state restoration

## 0.2.0 (2026-03-26)

### Added
- Origin provenance visualization (CORE-ORIGIN-1 Phase 4)
  - Color-coded node borders by origin prefix (evolver=amber, code=green, conversation=indigo, enricher=teal, hook=gray, import=blue, unknown=red dashed, user=none)
  - Origin display in node detail panel with tier label
  - OriginLegend component (visible by default in GraphExplorer)
  - Origin extraction in normalize.js with triple fallback for backend compat
  - `getOriginPrefix()`, `getOriginBorderColor()`, `getOriginTier()`, `getTierLabel()` utilities
  - `originPrefixes` section in graph-colors.json contract
  - `origin-contract.json` with full origin taxonomy and tier assignments

## 0.1.0 (2026-02-17)

Initial release — extracted from `smart-memory-viewer`.

### Added
- 11 React components: GraphExplorer, DetailPanel, FilterPanel, SearchBar, Toolbar, OperationsBar, CytoscapeCanvas, NodeTooltip, WikipediaOverlay, ReplayButton, TimeTravelSlider
- 8 React hooks: useGraphData, useGraphFilters, useGraphStream, useGraphInteraction, useDripFeed, useUrlState, useConnectionStatus, useEntityCorrections
- 2 adapter factories: createFetchAdapter (raw fetch), createSDKAdapter (JS SDK stub)
- Core utilities: graph colors, constants, event classification, normalization, coalescing, wikipedia search, PNG/SVG export, event recording
- Canonical GraphNode/GraphEdge types with single conversion boundary to Cytoscape
- 24 unit tests for classifyEvent and eventTransform
