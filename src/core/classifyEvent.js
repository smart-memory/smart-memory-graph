/**
 * Classify a raw WebSocket event into a graph-relevant operation.
 * Returns null for events that should be ignored.
 *
 * Pure function — no React, no side effects.
 * Extracted from useGraphStream.js:12-75.
 */
export function classifyEvent(raw) {
  if (!raw || raw.type !== 'new_event') return null;

  const { component, operation, name, data, trace_id } = raw;
  const memoryId = data?.memory_id || data?.item_id || null;
  const id = raw.event_id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = { id, timestamp: raw.timestamp || new Date().toISOString(), traceId: trace_id, meta: raw };

  // Graph mutations
  if (component === 'graph') {
    if (operation === 'add_node' || operation === 'add_nodes_bulk') {
      const nodeId = data?.item_id || memoryId;
      if (nodeId && nodeId.startsWith('wikipedia:')) return null;
      return { ...base, category: 'node_added', label: `Node "${data?.label || memoryId || 'unknown'}" added`, nodeId: memoryId };
    }
    if (operation === 'add_edge' || operation === 'add_edges_bulk') {
      const src = data?.source_id || data?.source || '';
      const tgt = data?.target_id || data?.target || '';
      const edgeType = data?.edge_type || 'RELATES_TO';
      if (edgeType === 'GROUNDED_IN' || src.startsWith('wikipedia:') || tgt.startsWith('wikipedia:')) {
        const groundedNodeId = src.startsWith('wikipedia:') ? tgt : src;
        const wikiId = src.startsWith('wikipedia:') ? src : tgt;
        const wikiName = wikiId.replace('wikipedia:', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return { ...base, category: 'grounding_flash', label: `Grounded "${wikiName}"`, nodeId: groundedNodeId };
      }
      const edgeId = data?.edge_id || (src && tgt ? `${src}->${tgt}` : null);
      return { ...base, category: 'edge_added', label: `Edge "${edgeType}"`, nodeId: src || null, edgeId };
    }
    if (operation === 'clear_all') {
      const nuclear = data?.nuclear ? ' (nuclear)' : '';
      return { ...base, category: 'graph_cleared', label: `Graph cleared${nuclear}`, nodeId: null };
    }
    if (operation?.startsWith('delete')) {
      return { ...base, category: 'node_removed', label: `Removed ${memoryId || 'element'}`, nodeId: memoryId };
    }
  }

  // Pipeline stages
  if (component === 'pipeline' || (name && name.startsWith('pipeline.'))) {
    const stage = operation || name?.split('.').pop() || 'unknown';
    const durationStr = raw.duration_ms != null ? ` (${Math.round(raw.duration_ms)}ms)` : '';
    return { ...base, category: 'pipeline_stage', label: `Pipeline: ${stage}${durationStr}`, nodeId: memoryId };
  }

  // Search
  if (component === 'memory' && operation === 'search') {
    const query = data?.query || '';
    const resultCount = data?.result_count ?? data?.top_k ?? 0;
    const matchIds = data?.result_ids || [];
    return { ...base, category: 'search_highlight', label: `Search: ${resultCount} results for "${query.substring(0, 30)}"`, nodeId: null, matchIds };
  }

  // Ingest
  if (component === 'memory' && operation === 'ingest') {
    const preview = data?.content?.substring(0, 30) || memoryId || '';
    return { ...base, category: 'ingest_started', label: `Ingesting: "${preview}..."`, nodeId: memoryId };
  }

  return null;
}
