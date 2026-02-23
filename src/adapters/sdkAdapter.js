/**
 * SDK-based adapter for the SmartMemory Graph API.
 * Delegates to the JS SDK's typed API classes, which handle auth, team headers,
 * token refresh, and base URL transparently.
 *
 * @param {import('@smartmemory/sdk-js').SmartMemoryClient} client - SDK client instance
 * @returns {import('./types').GraphAPIAdapter}
 */
export function createSDKAdapter(client) {
  return {
    getFullGraph: (limit) =>
      client.graph.getFullGraph(limit),

    getEdgesBulk: (nodeIds) =>
      client.graph.getEdgesBulk(nodeIds),

    getGroundingStatus: (id) =>
      client.graph.getGroundingStatus(id),

    updateEntityNode: (id, updates) =>
      client.graph.updateEntityNode(id, updates),

    removeGrounding: (id) =>
      client.graph.removeGrounding(id),

    createOntologyPattern: (name, type, confidence = 1.0) =>
      client.ontology.createPattern({ name, entityType: type, confidence }),

    deleteOntologyPattern: (name, type) =>
      client.ontology.deletePattern(name, type),

    getTemporalSnapshot: (ts, limit = 2000) =>
      client.temporal.timeTravel(ts, { limit }),

    searchMemories: (query, topK = 20) =>
      client.memories.search(query, { topK, enableHybrid: true }),

    getMemory: (id) =>
      client.memories.get(id),

    getLinks: (id) =>
      client.graph.getLinks(id),

    getNeighbors: (id) =>
      client.graph.getNeighbors(id),

    findPath: (startId, endId, maxHops = 5) =>
      client.graph.findShortestPath(startId, endId, maxHops),

    listMemories: (limit = 2000, offset = 0) =>
      client.memories.list({ limit, offset }),

    deleteNode: (id) =>
      client.memories.delete(id),

    deleteEntityNode: (id) =>
      client.graph.deleteEntityNode(id),

    getAuthToken: () =>
      client.auth.tokenManager.getAccessToken(),
  };
}
