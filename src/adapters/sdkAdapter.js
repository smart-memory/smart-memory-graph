/**
 * SDK-based adapter for the SmartMemory Graph API.
 * Stub for VIS-GRAPH-5 (web app integration).
 *
 * Delegates to the JS SDK's ApiCompat layer, which handles auth, team headers,
 * and base URL transparently via the host app's existing API setup.
 *
 * @param {Object} apiCompat - SmartMemory JS SDK ApiCompat instance
 * @returns {GraphAPIAdapter}
 */
export function createSDKAdapter(apiCompat) {
  // TODO: Implement when VIS-GRAPH-5 starts
  // Each method should delegate to apiCompat.request() or the SDK's typed methods
  throw new Error('@smartmemory/graph: createSDKAdapter is not yet implemented. Use createFetchAdapter for now.');
}
