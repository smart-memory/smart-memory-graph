/**
 * Conversion layer between canonical GraphNode/GraphEdge and Cytoscape element format.
 * This is the ONE place where format conversion happens — enforced by the internal/ convention.
 */

// GraphNode → Cytoscape node element
export function graphNodeToCyElement(node) {
  return {
    group: 'nodes',
    data: {
      id: node.id,
      label: node.label,
      type: node.type,
      category: node.category || 'entity',
      content: node.content || '',
      confidence: node.confidence,
      created_at: node.created_at,
      parentId: node.parentId || null,
      metadata: node.metadata,
    },
  };
}

// GraphEdge → Cytoscape edge element
export function graphEdgeToCyElement(edge) {
  const id = edge.id || `${edge.source}->${edge.target}:${edge.label}`;
  return {
    group: 'edges',
    data: {
      id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.type || edge.label,
      confidence: edge.confidence,
      metadata: edge.metadata,
    },
  };
}

// Cytoscape node element → GraphNode (for callbacks to consumers)
export function cyElementToGraphNode(el) {
  const d = el.data ? el.data : el;
  return {
    id: d.id,
    label: d.label,
    type: d.type,
    category: d.category,
    content: d.content,
    confidence: d.confidence,
    created_at: d.created_at,
    metadata: d.metadata,
  };
}

// Cytoscape edge element → GraphEdge (for callbacks to consumers)
export function cyElementToGraphEdge(el) {
  const d = el.data ? el.data : el;
  return {
    id: d.id,
    source: d.source,
    target: d.target,
    label: d.label,
    type: d.type,
    confidence: d.confidence,
    metadata: d.metadata,
  };
}
