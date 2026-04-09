/**
 * Normalization helpers for converting API responses to GraphNode/GraphEdge arrays.
 */

/**
 * Convert /memory/graph/full API response to canonical GraphData.
 * Matches the logic from useGraphData.js:transformFullGraph (lines 9-66).
 */
export function normalizeAPIResponse(apiData) {
  if (!apiData) return { nodes: [], edges: [] };

  const nodes = [];
  const edges = [];
  const seenNodeIds = new Set();
  const seenEdgeIds = new Set();

  // Pre-scan edges to collect grounded node IDs (nodes with a GROUNDED_IN edge to a wikipedia: node)
  const groundedIds = new Set();
  for (const edge of (apiData.edges || apiData.links || [])) {
    const edgeType = edge.edge_type || edge.type || '';
    if (edgeType === 'GROUNDED_IN') {
      const src = edge.source_id || edge.source || '';
      const tgt = edge.target_id || edge.target || '';
      if (src && !src.startsWith('wikipedia:')) groundedIds.add(src);
      if (tgt && !tgt.startsWith('wikipedia:')) groundedIds.add(tgt);
    }
  }

  // Process nodes from the API response
  const rawNodes = apiData.nodes || apiData.items || [];
  for (const item of rawNodes) {
    const id = item.item_id || item.id;
    if (!id || seenNodeIds.has(id)) continue;
    // Skip internal nodes
    if (id.startsWith('version_') || id.startsWith('wikipedia:')) continue;
    seenNodeIds.add(id);

    const isEntity = item.node_category === 'entity' || item.category === 'entity' || !!item.entity_type;
    const type = isEntity
      ? (item.entity_type || item.memory_type || item.type || 'concept')
      : (item.memory_type || item.type || 'semantic');
    const category = isEntity ? 'entity' : 'memory';

    const origin = item.origin || item.properties?.origin || item.metadata?.origin || 'unknown';

    nodes.push({
      id,
      label: item.label || item.name || item.title || item.properties?.name || item.content?.substring(0, 40) || id.substring(0, 12),
      type,
      category,
      content: item.content || '',
      confidence: item.confidence,
      created_at: item.created_at,
      parentId: item.parent_memory_id || null,
      metadata: item.metadata,
      grounded: groundedIds.has(id),
      origin,
    });
  }

  // Process edges from the API response
  const rawEdges = apiData.edges || apiData.links || [];
  for (const edge of rawEdges) {
    const source = edge.source_id || edge.source;
    const target = edge.target_id || edge.target;
    if (!source || !target) continue;
    const edgeType = edge.edge_type || edge.type || 'RELATES_TO';
    // Skip grounding edges
    if (edgeType === 'GROUNDED_IN') continue;
    if (source.startsWith('wikipedia:') || target.startsWith('wikipedia:')) continue;

    const id = edge.edge_id || `${source}->${target}:${edgeType}`;
    if (seenEdgeIds.has(id)) continue;
    seenEdgeIds.add(id);

    edges.push({
      id,
      source,
      target,
      label: edgeType,
      type: edgeType,
      confidence: edge.confidence,
      metadata: edge.metadata,
    });
  }

  return { nodes, edges };
}

/**
 * Convert pipeline extraction output to GraphData (for Studio).
 */
export function normalizeExtractionResults(entities, relations) {
  const nodes = (entities || []).map((e) => ({
    id: e.item_id || e.id || e.name,
    label: e.label || e.name || e.content?.substring(0, 40) || '',
    type: e.entity_type || e.metadata?.entity_type || e.type || 'concept',
    category: 'entity',
    content: e.content || '',
    confidence: e.confidence ?? e.metadata?.confidence,
    metadata: e.metadata,
  }));

  const edges = (relations || []).map((r) => {
    const source = r.source_id || r.source;
    const target = r.target_id || r.target;
    const relType = r.relation_type || r.edge_type || r.type || 'RELATES_TO';
    return {
      id: r.id || `${source}->${target}:${relType}`,
      source,
      target,
      label: relType,
      type: relType,
      confidence: r.confidence,
      metadata: r.metadata,
    };
  });

  return { nodes, edges };
}
