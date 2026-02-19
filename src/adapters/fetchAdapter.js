/**
 * Fetch-based adapter for the SmartMemory Graph API.
 * Used by the standalone viewer — wraps raw fetch with auth headers.
 *
 * @param {Object} config
 * @param {string} config.apiUrl - Base API URL (e.g., 'http://localhost:9001')
 * @param {function(): string|null} config.getToken - Returns current JWT token
 * @param {function(): string|null} config.getTeamId - Returns current team ID
 * @returns {GraphAPIAdapter}
 */
export function createFetchAdapter({ apiUrl, getToken, getTeamId }) {
  async function request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    const team = getTeamId();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (team) headers['X-Team-Id'] = team;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${apiUrl}${path}`, opts);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  return {
    // No client-side default cap; backend applies the authoritative limit.
    getFullGraph: (limit) => request('GET', limit == null ? '/memory/graph/full' : `/memory/graph/full?limit=${encodeURIComponent(limit)}`),
    getEdgesBulk: (nodeIds) => request('POST', '/memory/graph/edges', { node_ids: nodeIds }),
    getGroundingStatus: (id) => request('GET', `/memory/graph/nodes/${encodeURIComponent(id)}/grounding`),
    updateEntityNode: (id, updates) => request('PATCH', `/memory/graph/nodes/${encodeURIComponent(id)}`, updates),
    removeGrounding: (id) => request('DELETE', `/memory/graph/nodes/${encodeURIComponent(id)}/grounding`),
    createOntologyPattern: (name, type, confidence) => request('POST', '/memory/ontology/patterns', { name, entity_type: type, confidence }),
    deleteOntologyPattern: (name, type) => request('DELETE', `/memory/ontology/patterns/${encodeURIComponent(name)}?entity_type=${encodeURIComponent(type)}`),
    getTemporalSnapshot: (ts, limit = 2000) => request('GET', `/memory/temporal/at/${encodeURIComponent(ts)}?limit=${limit}`),
    searchMemories: (query, topK = 20) => request('POST', '/memory/search', { query, top_k: topK, enable_hybrid: true }),
    getMemory: (id) => request('GET', `/memory/${encodeURIComponent(id)}`),
    getLinks: (id) => request('GET', `/memory/${encodeURIComponent(id)}/links`),
    getNeighbors: (id) => request('GET', `/memory/${encodeURIComponent(id)}/neighbors`),
    findPath: (startId, endId, maxHops = 5) => request('GET', `/memory/graph/path?start_id=${encodeURIComponent(startId)}&end_id=${encodeURIComponent(endId)}&max_hops=${maxHops}`),
    listMemories: (limit = 2000, offset = 0) => request('GET', `/memory/list?limit=${limit}&offset=${offset}`),
    getAuthToken: () => getToken(),
  };
}
