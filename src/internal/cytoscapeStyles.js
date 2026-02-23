import { MEMORY_COLORS, ENTITY_COLORS, SPECIAL_COLORS, ANNOTATION_COLORS, ANNOTATION_BORDERS, getNodeColor, desaturateColor } from '../core/graphColors';

/** Compute degree-based size for entity nodes (12–24px). Memory nodes stay fixed at 28px. */
function entityNodeSize(ele) {
  const deg = ele.degree();
  return Math.min(24, Math.max(12, 12 + deg * 1.5));
}

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
    // ── Hover effects ──────────────────────────────────────────────────────
    // Hovered node: soft colored glow ring + subtle scale
    {
      selector: 'node.hovered',
      style: {
        'border-width': 4,
        'border-color': (ele) => ele.style('background-color'),
        'border-opacity': 0.9,
        'overlay-color': (ele) => ele.style('background-color'),
        'overlay-padding': 6,
        'overlay-opacity': 0.15,
        'z-index': 100,
      },
    },
    // Non-neighbor nodes dimmed on hover
    {
      selector: 'node.hover-dimmed',
      style: {
        opacity: 0.25,
      },
    },
    // Non-neighbor edges dimmed on hover
    {
      selector: 'edge.hover-dimmed',
      style: {
        opacity: 0.1,
      },
    },
    // Base edge style
    {
      selector: 'edge',
      style: {
        width: (ele) => {
          const w = ele.data('weight') || ele.data('strength') || 1;
          return Math.min(4, Math.max(0.5, w * 1.5));
        },
        'line-color': '#475569', // slate-600
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#475569', // slate-600 — matches line-color
        'target-arrow-width': 0.8,
        'curve-style': 'bezier',
        opacity: 0.6,
        label: (ele) => {
          const t = ele.data('type') || ele.data('label') || '';
          return t === 'RELATED_ENTITY' ? '' : t;
        },
        'font-size': '8px',
        color: '#475569', // matches line-color (slate-600)
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
        color: '#64748b', // reveal label on selection
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
    // Edge label visible on hover (via class toggle in mouseover handler)
    {
      selector: 'edge.hover-edge-visible',
      style: {
        color: '#64748b', // slate-500
      },
    },
  ];

  // Add per-type node color styles for memory types (fixed 28px)
  for (const [type, color] of Object.entries(MEMORY_COLORS)) {
    styles.push({
      selector: `node[type="${type}"]`,
      style: { 'background-color': color, width: 28, height: 28 },
    });
  }

  // Add per-type node color styles for entity types (degree-based sizing)
  for (const [type, color] of Object.entries(ENTITY_COLORS)) {
    styles.push({
      selector: `node[type="${type}"]`,
      style: {
        'background-color': color,
        width: entityNodeSize,
        height: entityNodeSize,
      },
    });
  }

  // Grounding nodes (fixed 16px)
  styles.push({
    selector: 'node[category="grounding"]',
    style: { 'background-color': SPECIAL_COLORS.grounding, width: 16, height: 16 },
  });

  // Grounded nodes — thin border indicates Wikipedia/Wikidata provenance
  // Uses node.grounded class (set on load) AND data(grounded) (set for streaming nodes via onGroundingFlash)
  for (const sel of ['node.grounded', 'node[grounded]']) {
    styles.push({
      selector: sel,
      style: {
        'border-width': 1.5,
        'border-color': '#64748b', // slate-500 — visible on both colored nodes and dark canvas
        'border-opacity': 1,
      },
    });
  }

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

  // edge.streaming-new removed — edges use animateEdgePulse() (traveling dash) instead

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

  // LOD cluster parent nodes (compound containers) — subtle halo effect
  styles.push({
    selector: 'node.lod-cluster',
    style: {
      'background-opacity': 0.08,
      'background-color': '#64748b',
      'border-width': 2,
      'border-color': (ele) => ENTITY_COLORS[ele.data('type')] || '#64748b',
      'border-opacity': 0.4,
      shape: 'round-rectangle',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': '11px',
      'font-weight': 'bold',
      color: '#94a3b8',
      'padding': '12px',
    },
  });

  // ── Temporal decay desaturation ──────────────────────────────────────────
  // age_bucket is set on node data in cytoscapeConvert.js from created_at timestamp.
  // Nodes blend toward slate-400 as they age. Fresh nodes (< 1 day) are unaffected.
  const decayBuckets = [
    { bucket: 'recent', ratio: 0.15 },  // 1–7 days: very slight
    { bucket: 'aging',  ratio: 0.35 },  // 7–30 days: moderate
    { bucket: 'old',    ratio: 0.55 },  // 30+ days: strongly muted
  ];

  for (const { bucket, ratio } of decayBuckets) {
    styles.push({
      selector: `node[age_bucket="${bucket}"]`,
      style: {
        'background-color': (ele) => {
          const color = getNodeColor(ele.data('type'), ele.data('category'));
          return desaturateColor(color, ratio);
        },
      },
    });
  }

  // ── Annotation styles (channel-scoped) ──────────────────────────────
  // Generated from contracts/graph-annotations.json
  // Token format: anno-{channel}-{kind}-{value}

  // Fill channel (background-color for nodes, line-color for edges)
  for (const [kind, values] of Object.entries(ANNOTATION_COLORS)) {
    if (kind === 'search_match') continue;
    for (const [value, color] of Object.entries(values)) {
      if (typeof color !== 'string') continue;
      styles.push({
        selector: `node.anno-fill-${kind}-${value}`,
        style: { 'background-color': color },
      });
      styles.push({
        selector: `edge.anno-fill-${kind}-${value}`,
        style: { 'line-color': color },
      });
    }
  }

  // Border channel (border-color, border-style, border-width)
  for (const [kind, values] of Object.entries(ANNOTATION_BORDERS || {})) {
    for (const [value, border] of Object.entries(values)) {
      styles.push({
        selector: `node.anno-border-${kind}-${value}`,
        style: {
          'border-color': border.color,
          'border-style': border.style,
          'border-width': border.width,
        },
      });
    }
  }

  // Opacity channel (confidence kind only)
  const opacityMap = { high: 1.0, medium: 0.7, low: 0.4, unscored: 0.5 };
  const confidenceColors = ANNOTATION_COLORS.confidence;
  if (confidenceColors) {
    for (const value of Object.keys(confidenceColors)) {
      styles.push({
        selector: `node.anno-opacity-confidence-${value}`,
        style: { opacity: opacityMap[value] || 0.7 },
      });
    }
  }

  // Overlay channel (search_match — channel-locked)
  const searchColors = ANNOTATION_COLORS.search_match || {};
  for (const [value, config] of Object.entries(searchColors)) {
    if (typeof config === 'object' && config.color) {
      styles.push({
        selector: `node.anno-overlay-search_match-${value}`,
        style: {
          'overlay-color': config.color,
          'overlay-opacity': config.opacity || 0,
          'overlay-padding': config.padding || 0,
        },
      });
    }
  }

  return styles;
}
