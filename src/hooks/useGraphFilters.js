import { useState, useCallback, useMemo } from 'react';

/**
 * Filter state for graph nodes and edges.
 * Refactored: operates on GraphNode[] instead of Cytoscape elements.
 *
 * @param {GraphNode[]} nodes - Array of graph nodes
 * @param {GraphEdge[]} edges - Array of graph edges
 */
export function useGraphFilters(nodes, edges) {
  const [activeMemoryTypes, setActiveMemoryTypes] = useState(null);
  const [activeEntityTypes, setActiveEntityTypes] = useState(null);
  const [activeRelationTypes, setActiveRelationTypes] = useState(null);

  // Streamed types/nodes (not in the initial arrays)
  const [streamedTypes, setStreamedTypes] = useState({ memory: new Set(), entity: new Set(), relation: new Set() });
  const [streamedNodeMap, setStreamedNodeMap] = useState(new Map());
  const [cascadeEdgeFilter, setCascadeEdgeFilter] = useState(() => {
    const stored = localStorage.getItem('graph:cascadeEdgeFilter');
    return stored !== null ? stored === 'true' : false;
  });

  // Register types from streaming elements (accepts GraphNode | GraphEdge)
  const registerStreamedElements = useCallback((els) => {
    if (!els || els.length === 0) return;

    setStreamedTypes((prev) => {
      let changed = false;
      const memory = new Set(prev.memory);
      const entity = new Set(prev.entity);
      const relation = new Set(prev.relation);
      for (const el of els) {
        if ('source' in el) {
          // Edge
          if (!relation.has(el.type)) { relation.add(el.type); changed = true; }
        } else {
          // Node
          if (el.category === 'memory' && !memory.has(el.type)) { memory.add(el.type); changed = true; }
          else if (el.category === 'entity' && !entity.has(el.type)) { entity.add(el.type); changed = true; }
        }
      }
      return changed ? { memory, entity, relation } : prev;
    });

    setStreamedNodeMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const el of els) {
        if (!('source' in el) && !next.has(el.id)) {
          next.set(el.id, { type: el.type, category: el.category });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Extract available types from data + streaming
  const availableTypes = useMemo(() => {
    const memoryTypes = new Set(streamedTypes.memory);
    const entityTypes = new Set(streamedTypes.entity);
    const relationTypes = new Set(streamedTypes.relation);

    for (const node of (nodes || [])) {
      if (node.category === 'memory') memoryTypes.add(node.type);
      else if (node.category === 'entity') entityTypes.add(node.type);
    }
    for (const edge of (edges || [])) {
      relationTypes.add(edge.type);
    }

    return {
      memoryTypes: Array.from(memoryTypes).sort(),
      entityTypes: Array.from(entityTypes).sort(),
      relationTypes: Array.from(relationTypes).sort(),
    };
  }, [nodes, edges, streamedTypes]);

  const activeMemorySet = useMemo(() => {
    return activeMemoryTypes === null ? new Set(availableTypes.memoryTypes) : activeMemoryTypes;
  }, [activeMemoryTypes, availableTypes.memoryTypes]);

  const activeEntitySet = useMemo(() => {
    return activeEntityTypes === null ? new Set(availableTypes.entityTypes) : activeEntityTypes;
  }, [activeEntityTypes, availableTypes.entityTypes]);

  const activeEdgeTypes = useMemo(() => {
    return activeRelationTypes === null ? new Set(availableTypes.relationTypes) : activeRelationTypes;
  }, [activeRelationTypes, availableTypes.relationTypes]);

  // Compute visible node IDs (includes both API and streamed nodes)
  const visibleNodeIds = useMemo(() => {
    const ids = new Set();

    for (const node of (nodes || [])) {
      if (node.category === 'memory' && activeMemorySet.has(node.type)) {
        ids.add(node.id);
      } else if (node.category === 'entity' && activeEntitySet.has(node.type)) {
        ids.add(node.id);
      }
    }

    for (const [nodeId, { type, category }] of streamedNodeMap) {
      if (category === 'memory' && activeMemorySet.has(type)) {
        ids.add(nodeId);
      } else if (category === 'entity' && activeEntitySet.has(type)) {
        ids.add(nodeId);
      }
    }

    return ids;
  }, [nodes, activeMemorySet, activeEntitySet, streamedNodeMap]);

  const toggleMemoryType = useCallback((type) => {
    setActiveMemoryTypes((prev) => {
      const current = prev === null ? new Set(availableTypes.memoryTypes) : new Set(prev);
      if (current.has(type)) current.delete(type);
      else current.add(type);
      return current;
    });
  }, [availableTypes.memoryTypes]);

  const toggleEntityType = useCallback((type) => {
    setActiveEntityTypes((prev) => {
      const current = prev === null ? new Set(availableTypes.entityTypes) : new Set(prev);
      if (current.has(type)) current.delete(type);
      else current.add(type);
      return current;
    });
  }, [availableTypes.entityTypes]);

  const toggleRelationType = useCallback((type) => {
    setActiveRelationTypes((prev) => {
      const current = prev === null ? new Set(availableTypes.relationTypes) : new Set(prev);
      if (current.has(type)) current.delete(type);
      else current.add(type);
      return current;
    });
  }, [availableTypes.relationTypes]);

  const selectAllMemoryTypes = useCallback(() => setActiveMemoryTypes(null), []);
  const deselectAllMemoryTypes = useCallback(() => setActiveMemoryTypes(new Set()), []);
  const selectAllEntityTypes = useCallback(() => setActiveEntityTypes(null), []);
  const deselectAllEntityTypes = useCallback(() => setActiveEntityTypes(new Set()), []);
  const selectAllRelationTypes = useCallback(() => setActiveRelationTypes(null), []);
  const deselectAllRelationTypes = useCallback(() => setActiveRelationTypes(new Set()), []);

  return {
    activeMemoryTypes: activeMemorySet,
    activeEntityTypes: activeEntitySet,
    activeRelationTypes,
    activeEdgeTypes,
    availableTypes,
    visibleNodeIds,
    toggleMemoryType,
    toggleEntityType,
    toggleRelationType,
    setActiveRelationTypes,
    selectAllMemoryTypes,
    deselectAllMemoryTypes,
    selectAllEntityTypes,
    deselectAllEntityTypes,
    selectAllRelationTypes,
    deselectAllRelationTypes,
    registerStreamedElements,
    cascadeEdgeFilter,
    toggleCascadeEdgeFilter: () =>
      setCascadeEdgeFilter((prev) => {
        const next = !prev;
        localStorage.setItem('graph:cascadeEdgeFilter', String(next));
        return next;
      }),
  };
}
