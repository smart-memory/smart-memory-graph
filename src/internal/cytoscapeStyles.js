import { MEMORY_COLORS, ENTITY_COLORS, SPECIAL_COLORS } from '../core/graphColors';

export function getCytoscapeStyles() {
  const styles = [
    // Base node style
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'font-size': '10px',
        color: '#cbd5e1', // slate-300
        'text-outline-width': 2,
        'text-outline-color': '#0f172a', // slate-900
        'background-color': '#94a3b8', // default
        width: 16,
        height: 16,
        'border-width': 0,
        'text-max-width': '100px',
        'text-wrap': 'ellipsis',
      },
    },
    // Selected node
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': '#f8fafc', // slate-50
        'border-opacity': 1,
        width: 24,
        height: 24,
        'font-size': '12px',
        'font-weight': 'bold',
        'z-index': 999,
      },
    },
    // Highlighted node (search match, path node)
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 3,
        'border-color': '#fbbf24', // amber-400
        width: 22,
        height: 22,
      },
    },
    // Filtered-out node — completely hidden (not ghosted)
    {
      selector: 'node.dimmed',
      style: {
        display: 'none',
      },
    },
    // Neighbor of selected
    {
      selector: 'node.neighbor',
      style: {
        'border-width': 2,
        'border-color': '#60a5fa', // blue-400
        opacity: 1,
      },
    },
    // Base edge style
    {
      selector: 'edge',
      style: {
        width: 1,
        'line-color': '#475569', // slate-600
        'target-arrow-shape': 'none',
        'curve-style': 'bezier',
        opacity: 0.6,
        label: (ele) => {
          const t = ele.data('type') || ele.data('label') || '';
          return t === 'RELATED_ENTITY' ? '' : t;
        },
        'font-size': '8px',
        color: '#64748b', // slate-500
        'text-outline-width': 1,
        'text-outline-color': '#0f172a',
        'text-rotation': 'autorotate',
      },
    },
    // Selected edge
    {
      selector: 'edge:selected',
      style: {
        width: 2,
        'line-color': '#f8fafc',
        opacity: 1,
      },
    },
    // Highlighted edge (path)
    {
      selector: 'edge.highlighted',
      style: {
        width: 3,
        'line-color': '#fbbf24',
        opacity: 1,
        'z-index': 999,
      },
    },
    // Filtered-out edge — completely hidden
    {
      selector: 'edge.dimmed',
      style: {
        display: 'none',
      },
    },
  ];

  // Add per-type node color styles for memory types
  for (const [type, color] of Object.entries(MEMORY_COLORS)) {
    styles.push({
      selector: `node[type="${type}"]`,
      style: { 'background-color': color, width: 28, height: 28 },
    });
  }

  // Add per-type node color styles for entity types
  for (const [type, color] of Object.entries(ENTITY_COLORS)) {
    styles.push({
      selector: `node[type="${type}"]`,
      style: { 'background-color': color, width: 16, height: 16 },
    });
  }

  // Grounding nodes
  styles.push({
    selector: 'node[category="grounding"]',
    style: { 'background-color': SPECIAL_COLORS.grounding, width: 16, height: 16 },
  });

  // Streaming glow — newly arrived node from live event stream
  styles.push({
    selector: 'node.streaming-new',
    style: {
      'border-width': 4,
      'border-color': '#22d3ee', // cyan-400
      'border-opacity': 1,
      'overlay-color': '#22d3ee',
      'overlay-padding': 6,
      'overlay-opacity': 0.25,
      'z-index': 1000,
    },
  });

  // Streaming glow — newly arrived edge
  styles.push({
    selector: 'edge.streaming-new',
    style: {
      width: 3,
      'line-color': '#22d3ee',
      opacity: 1,
      'z-index': 1000,
    },
  });

  // Grounding flash — entity just linked to Wikipedia provenance
  styles.push({
    selector: 'node.grounding-flash',
    style: {
      'border-width': 5,
      'border-color': '#4ade80', // green-400
      'border-opacity': 1,
      'overlay-color': '#4ade80',
      'overlay-padding': 8,
      'overlay-opacity': 0.3,
      'z-index': 1000,
    },
  });

  // LOD cluster parent nodes (compound containers)
  styles.push({
    selector: 'node.lod-cluster',
    style: {
      'background-opacity': 0.12,
      'background-color': '#64748b',
      'border-width': 1,
      'border-color': '#475569',
      'border-opacity': 0.5,
      shape: 'round-rectangle',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': '11px',
      'font-weight': 'bold',
      color: '#94a3b8',
      'padding': '12px',
    },
  });

  return styles;
}
