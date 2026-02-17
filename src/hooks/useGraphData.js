import { useState, useEffect, useCallback } from 'react';
import { normalizeAPIResponse } from '../core/normalize';
import { coalesceGraphData } from '../core/coalesce';
import { MEMORY_TYPE_SET } from '../core/graphColors';

/**
 * Fetch and manage graph data via adapter.
 * Refactored: accepts adapter parameter, returns GraphNode/GraphEdge instead of Cytoscape elements.
 *
 * @param {GraphAPIAdapter} adapter
 * @returns {{ nodes, edges, loading, error, stats, refresh, incrementStats }}
 */
export function useGraphData(adapter) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0, types: {} });

  const fetchGraph = useCallback(async () => {
    if (!adapter) return;
    setLoading(true);
    setError(null);
    try {
      let graphNodes, graphEdges;
      try {
        const graphData = await adapter.getFullGraph();
        const normalized = normalizeAPIResponse(graphData);
        graphNodes = normalized.nodes;
        graphEdges = normalized.edges;
      } catch {
        // Fallback: use memory list + edge bulk
        const memoriesRes = await adapter.listMemories(2000);
        const rawMemories = memoriesRes?.items || memoriesRes?.memories || memoriesRes || [];
        const memories = Array.isArray(rawMemories)
          ? rawMemories.filter((m) => {
              const id = m.item_id || m.id || '';
              return !id.startsWith('version_');
            })
          : [];

        if (memories.length === 0) {
          setNodes([]);
          setEdges([]);
          setStats({ nodes: 0, edges: 0, types: {} });
          setLoading(false);
          return;
        }

        const nodeIds = memories.map((m) => m.item_id || m.id);
        const linksByNode = {};
        try {
          const edgesRes = await adapter.getEdgesBulk(nodeIds);
          for (const edge of edgesRes?.edges || []) {
            const link = { source_id: edge.source_id, target_id: edge.target_id, link_type: edge.edge_type };
            if (!linksByNode[edge.source_id]) linksByNode[edge.source_id] = [];
            linksByNode[edge.source_id].push(link);
          }
        } catch {
          const results = await Promise.allSettled(
            memories.slice(0, 100).map((m) => {
              const id = m.item_id || m.id;
              return adapter.getLinks(id).then((links) => ({ id, links }));
            })
          );
          for (const result of results) {
            if (result.status === 'fulfilled') {
              const { id, links } = result.value;
              linksByNode[id] = Array.isArray(links) ? links : links?.links || [];
            }
          }
        }

        // Transform to GraphNode/GraphEdge
        graphNodes = [];
        graphEdges = [];
        const seenEdges = new Set();

        for (const item of memories) {
          const id = item.item_id || item.id;
          const type = item.memory_type || item.type || 'semantic';
          const label = item.title || item.content?.substring(0, 40) || id.substring(0, 12);
          const category = MEMORY_TYPE_SET.has(type) ? 'memory' : 'entity';
          graphNodes.push({ id, label, type, category, content: item.content || '' });

          const links = linksByNode[id] || [];
          for (const link of links) {
            const sourceId = link.source_id || link.source;
            const targetId = link.target_id || link.target;
            const edgeType = link.link_type || link.relation_type || link.type || 'RELATES_TO';
            const edgeKey = `${sourceId}->${targetId}:${edgeType}`;
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              graphEdges.push({ id: edgeKey, source: sourceId, target: targetId, label: edgeType, type: edgeType });
            }
          }
        }

        // Filter edges to only those with valid endpoints
        const nodeIdSet = new Set(graphNodes.map(n => n.id));
        graphEdges = graphEdges.filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
      }

      // Coalesce
      const { nodes: coalescedNodes, edges: coalescedEdges } = coalesceGraphData(graphNodes, graphEdges, {});

      // Calculate stats
      const typeCounts = {};
      for (const node of coalescedNodes) {
        typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
      }

      setNodes(coalescedNodes);
      setEdges(coalescedEdges);
      setStats({ nodes: coalescedNodes.length, edges: coalescedEdges.length, types: typeCounts });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const incrementStats = useCallback((addedNodes, addedEdges) => {
    const nodeArr = Array.isArray(addedNodes) ? addedNodes : [];
    const edgeNum = typeof addedEdges === 'number' ? addedEdges : 0;
    if (nodeArr.length === 0 && edgeNum === 0) return;
    setStats((prev) => {
      const types = { ...prev.types };
      for (const node of nodeArr) {
        const t = node.type || 'semantic';
        types[t] = (types[t] || 0) + 1;
      }
      return { nodes: prev.nodes + nodeArr.length, edges: prev.edges + edgeNum, types };
    });
  }, []);

  return { nodes, edges, loading, error, stats, refresh: fetchGraph, incrementStats };
}
