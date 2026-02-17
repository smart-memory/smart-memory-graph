/**
 * Transform raw graph event data into canonical GraphNode/GraphEdge objects.
 * Pure functions — no React, no Cytoscape format.
 *
 * Extracted from useGraphStream.js:80-113.
 * Key change: returns GraphNode/GraphEdge instead of Cytoscape elements.
 */

import { MEMORY_TYPE_SET } from './graphColors';

/**
 * Build a GraphNode from a graph event's data payload.
 * Returns null for events that should be skipped.
 */
export function eventToGraphNode(data) {
  if (!data) return null;
  const id = data.memory_id || data.item_id || data.node_id || data.id;
  if (!id) return null;
  // Skip internal nodes (version tracker artifacts, Wikipedia grounding nodes)
  if (id.startsWith('version_') || id.startsWith('wikipedia:')) return null;

  const label = data.label || data.title || data.content?.substring(0, 40) || id.substring(0, 12);
  const isEntity = data.node_category === 'entity' || !!data.entity_type;
  const type = isEntity
    ? (data.entity_type || data.type || 'concept')
    : (data.memory_type || data.type || 'semantic');
  const category = isEntity ? 'entity' : (MEMORY_TYPE_SET.has(type) ? 'memory' : 'entity');

  return { id, label, type, category, content: data.content || '', parentId: data.parent_memory_id || null };
}

/**
 * Build a GraphEdge from a graph event's data payload.
 * Returns null for events that should be skipped.
 */
export function eventToGraphEdge(data) {
  if (!data) return null;
  const src = data.source_id || data.source;
  const tgt = data.target_id || data.target;
  if (!src || !tgt) return null;

  const edgeType = data.edge_type || data.link_type || 'RELATES_TO';
  // Skip Wikipedia grounding edges
  if (edgeType === 'GROUNDED_IN') return null;
  if (src.startsWith('wikipedia:') || tgt.startsWith('wikipedia:')) return null;

  return {
    id: `${src}->${tgt}:${edgeType}`,
    source: src,
    target: tgt,
    label: edgeType,
    type: edgeType,
  };
}
