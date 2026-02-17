/**
 * Merge multiple AnnotationSets into a single GraphAnnotations object.
 * GraphExplorer never sees AnnotationSet[] — this runs in the consumer wrapper.
 *
 * @param {Array<{annotations: object}>} sets
 * @param {object} graphData - { nodes, edges }
 * @param {{ precedence?: string[] }} [config]
 * @returns {object} GraphAnnotations
 */
export function resolveAnnotationSets(sets, graphData, config = {}) {
  if (!sets?.length) return { nodes: {}, edges: {}, activeKinds: [] };

  const nodes = {};
  const edges = {};
  const activeKindsSet = new Set();

  for (const set of sets) {
    if (!set?.annotations) continue;

    // Merge node annotations (last-write-wins per nodeId+kind)
    for (const [nodeId, annoList] of Object.entries(set.annotations.nodes || {})) {
      if (!nodes[nodeId]) nodes[nodeId] = [];
      for (const anno of annoList) {
        const idx = nodes[nodeId].findIndex((a) => a.kind === anno.kind);
        if (idx >= 0) nodes[nodeId].splice(idx, 1);
        nodes[nodeId].push(anno);
        activeKindsSet.add(anno.kind);
      }
    }

    // Merge edge annotations (same logic)
    for (const [edgeId, annoList] of Object.entries(set.annotations.edges || {})) {
      if (!edges[edgeId]) edges[edgeId] = [];
      for (const anno of annoList) {
        const idx = edges[edgeId].findIndex((a) => a.kind === anno.kind);
        if (idx >= 0) edges[edgeId].splice(idx, 1);
        edges[edgeId].push(anno);
        activeKindsSet.add(anno.kind);
      }
    }

    // Merge activeKinds
    for (const kind of set.annotations.activeKinds || []) {
      activeKindsSet.add(kind);
    }
  }

  return {
    nodes,
    edges,
    activeKinds: Array.from(activeKindsSet),
    precedence: config.precedence,
  };
}
