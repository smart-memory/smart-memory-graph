/**
 * Shared constants extracted from scattered viewer files (R5).
 * Only constants used by multiple files or external consumers live here.
 */

// Reciprocal edge pairs merged into a single bidirectional RELATED_ENTITY edge
// Originally in useGraphStream.js:129
export const RECIPROCAL_PAIRS = new Set(['CONTAINS_ENTITY', 'MENTIONED_IN']);

// Known entity types for type correction dropdowns
// Originally in DetailPanel.jsx:8-12
export const ENTITY_TYPES = [
  'person', 'organization', 'location', 'event', 'product',
  'work_of_art', 'temporal', 'concept', 'technology', 'award',
  'nationality', 'language',
];

// Layout presets for the graph toolbar
// Originally in Toolbar.jsx:4-10
export const LAYOUT_OPTIONS = [
  { id: 'cose-bilkent', label: 'Force Directed' },
  { id: 'dagre', label: 'Hierarchical' },
  { id: 'circle', label: 'Circle' },
  { id: 'concentric', label: 'Concentric' },
  { id: 'grid', label: 'Grid' },
];
