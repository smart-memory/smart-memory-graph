import { useState, useEffect, useRef, useCallback } from 'react';
import { classifyEvent } from '../core/classifyEvent';
import { eventToGraphNode, eventToGraphEdge } from '../core/eventTransform';
import { coalesceGraphData } from '../core/coalesce';
import { saveRecording } from '../core/eventStore';

/**
 * React hook for real-time graph event streaming via Insights WebSocket.
 * Refactored: pure functions moved to core/, outputs GraphNode/GraphEdge instead of Cytoscape elements.
 *
 * @param {Object} options
 * @param {string} [options.wsUrl] - WebSocket URL
 * @param {string} [options.token] - JWT for WS auth
 * @param {boolean} [options.enabled=true] - Toggle connection
 * @param {number} [options.bufferSize=100] - Ring buffer capacity
 * @param {Function} [options.onElementAdded] - Callback with GraphNode | GraphEdge
 * @param {Function} [options.onSearchHighlight] - Callback with array of matching node IDs
 * @param {Function} [options.onPipelineProgress] - Callback with { nodeId, stage, durationMs }
 * @param {Function} [options.onGraphCleared] - Callback when graph is cleared
 * @param {Function} [options.onReconnect] - Callback on WS reconnection
 * @param {Function} [options.onGroundingFlash] - Callback with nodeId when entity is grounded
 */
export function useGraphStream(options = {}) {
  const {
    wsUrl,
    token,
    enabled = true,
    bufferSize = 100,
    onElementAdded,
    onSearchHighlight,
    onPipelineProgress,
    onGraphCleared,
    onReconnect,
    onGroundingFlash,
  } = options;

  // Build Sec-WebSocket-Protocol array for auth (avoids token in URL logs)
  const wsProtocols = (() => {
    const protocols = ['sm.v1'];
    if (token) {
      const enc = btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      protocols.push(`auth.${enc}`);
    }
    return protocols;
  })();

  const [status, setStatus] = useState('disconnected');
  const [operations, setOperations] = useState([]);
  const [opsPerSecond, setOpsPerSecond] = useState(0);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  const callbacksRef = useRef({ onElementAdded, onSearchHighlight, onPipelineProgress, onGraphCleared, onReconnect, onGroundingFlash });
  callbacksRef.current = { onElementAdded, onSearchHighlight, onPipelineProgress, onGraphCleared, onReconnect, onGroundingFlash };

  const batchRef = useRef([]);
  const batchTimerRef = useRef(null);
  const opsTimestampsRef = useRef([]);
  const unmountedRef = useRef(false);
  const pendingElementsRef = useRef([]);
  const recordingBufferRef = useRef({});
  const RECORDING_FLUSH_DELAY = 5000;
  const canonicalMapRef = useRef({});

  const flushBatch = useCallback(() => {
    if (unmountedRef.current || isPausedRef.current) return;
    const batch = batchRef.current;
    batchRef.current = [];
    if (batch.length === 0) return;

    const now = Date.now();
    opsTimestampsRef.current.push(...batch.map(() => now));
    const cutoff = now - 5000;
    opsTimestampsRef.current = opsTimestampsRef.current.filter((t) => t > cutoff);
    const timestamps = opsTimestampsRef.current;
    const elapsed = timestamps.length > 1 ? Math.max((now - timestamps[0]) / 1000, 1) : 1;
    const windowSec = Math.min(elapsed, 5);
    setOpsPerSecond(Math.round((timestamps.length / windowSec) * 10) / 10);

    setOperations((prev) => {
      const next = [...batch, ...prev];
      return next.length > bufferSize ? next.slice(0, bufferSize) : next;
    });

    const cbs = callbacksRef.current;
    const searchIds = [];

    // Build GraphNode/GraphEdge list preserving backend order
    const rawElements = [];
    let graphCleared = false;
    for (const op of batch) {
      if (op.category === 'graph_cleared') {
        graphCleared = true;
      } else if (op.category === 'node_added') {
        const el = eventToGraphNode(op.meta?.data);
        if (el) rawElements.push(el);
      } else if (op.category === 'edge_added') {
        const el = eventToGraphEdge(op.meta?.data);
        if (el) rawElements.push(el);
      } else if (op.category === 'search_highlight' && op.matchIds?.length) {
        searchIds.push(...op.matchIds);
      } else if (op.category === 'pipeline_stage' && cbs.onPipelineProgress) {
        cbs.onPipelineProgress({ nodeId: op.nodeId, stage: op.meta?.operation, durationMs: op.meta?.duration_ms });
      } else if (op.category === 'grounding_flash' && op.nodeId && cbs.onGroundingFlash) {
        cbs.onGroundingFlash(op.nodeId);
      }
    }

    if (graphCleared && cbs.onGraphCleared) {
      pendingElementsRef.current = [];
      canonicalMapRef.current = {};
      cbs.onGraphCleared();
      return;
    }

    // Coalesce — now operates on GraphNode/GraphEdge
    const rawNodes = rawElements.filter(el => !('source' in el));
    const rawEdges = rawElements.filter(el => 'source' in el);
    const { nodes: coalescedNodes, edges: coalescedEdges, idRemap } = coalesceGraphData(
      rawNodes, rawEdges, canonicalMapRef.current
    );

    // Rebuild interleaved order
    const coalescedNodeIds = new Set(coalescedNodes.map(n => n.id));
    const coalescedNodeMap = Object.fromEntries(coalescedNodes.map(n => [n.id, n]));
    const emittedIds = new Set();
    const interleavedElements = [];

    for (const raw of rawElements) {
      if (!('source' in raw)) {
        // Node
        if (idRemap[raw.id]) continue;
        if (coalescedNodeIds.has(raw.id) && !emittedIds.has(raw.id)) {
          interleavedElements.push(coalescedNodeMap[raw.id]);
          emittedIds.add(raw.id);
        }
      } else {
        // Edge: find coalesced version
        const src = idRemap[raw.source] || raw.source;
        const tgt = idRemap[raw.target] || raw.target;
        for (const ce of coalescedEdges) {
          if (emittedIds.has(ce.id)) continue;
          if ((ce.source === src && ce.target === tgt) || (ce.source === tgt && ce.target === src)) {
            interleavedElements.push(ce);
            emittedIds.add(ce.id);
            break;
          }
        }
      }
    }
    for (const ce of coalescedEdges) {
      if (!emittedIds.has(ce.id)) {
        interleavedElements.push(ce);
        emittedIds.add(ce.id);
      }
    }

    pendingElementsRef.current.push(...interleavedElements);

    // Recording accumulation
    const batchKey = batch[0]?.traceId || `batch-${Date.now()}`;
    for (const op of batch) {
      const el = op.category === 'node_added' ? eventToGraphNode(op.meta?.data)
        : op.category === 'edge_added' ? eventToGraphEdge(op.meta?.data)
        : null;
      if (!el) continue;

      const groupKey = op.traceId || batchKey;
      const buf = recordingBufferRef.current;
      if (!buf[groupKey]) {
        buf[groupKey] = { elements: [], label: '', timer: null };
      }
      const rec = buf[groupKey];
      rec.elements.push({ category: op.category, element: el, timestamp: op.timestamp });
      if (!rec.label && op.category === 'node_added' && el.content) {
        rec.label = el.content.substring(0, 60);
      }
      if (rec.timer) clearTimeout(rec.timer);
      const capturedKey = groupKey;
      rec.timer = setTimeout(() => {
        const finalRec = buf[capturedKey];
        if (finalRec && finalRec.elements.length > 0) {
          saveRecording({
            traceId: capturedKey,
            label: finalRec.label || `Recording ${new Date().toLocaleTimeString()}`,
            events: finalRec.elements,
          });
        }
        delete buf[capturedKey];
      }, RECORDING_FLUSH_DELAY);
    }

    // Dispatch
    if (interleavedElements.length > 0 && cbs.onElementAdded) {
      for (const el of interleavedElements) {
        cbs.onElementAdded(el);
      }
    }
    if (searchIds.length > 0 && cbs.onSearchHighlight) {
      cbs.onSearchHighlight([...new Set(searchIds)]);
    }
  }, [bufferSize]);

  // WebSocket connection
  useEffect(() => {
    unmountedRef.current = false;

    if (!enabled || !wsUrl) {
      setStatus('disconnected');
      return;
    }

    let ws = null;
    let reconnectTimer = null;
    let reconnectDelay = 1000;
    let unmounted = false;
    let hasConnectedOnce = false;
    let failedAttempts = 0;
    const MAX_RETRIES = 3;

    function connect() {
      if (unmounted) return;
      setStatus('connecting');

      try {
        ws = new WebSocket(wsUrl, wsProtocols);
      } catch {
        setStatus('disconnected');
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        if (unmounted) return;
        setStatus('connected');
        reconnectDelay = 1000;
        failedAttempts = 0;
        if (hasConnectedOnce && callbacksRef.current.onReconnect) {
          callbacksRef.current.onReconnect();
        }
        hasConnectedOnce = true;
      };

      ws.onmessage = (event) => {
        if (unmounted || isPausedRef.current) return;
        try {
          const raw = JSON.parse(event.data);
          const classified = classifyEvent(raw);
          if (!classified) return;

          batchRef.current.push(classified);

          if (!batchTimerRef.current) {
            batchTimerRef.current = setTimeout(() => {
              batchTimerRef.current = null;
              flushBatch();
            }, 200);
          }
        } catch {
          // Malformed message
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setStatus('disconnected');
        failedAttempts++;
        if (!hasConnectedOnce && failedAttempts >= MAX_RETRIES) return;
        scheduleReconnect();
      };

      ws.onerror = () => {};
    }

    function scheduleReconnect() {
      if (unmounted) return;
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connect();
      }, reconnectDelay);
    }

    connect();

    return () => {
      unmounted = true;
      unmountedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      // Clear recording buffer timers to prevent memory leak
      const buf = recordingBufferRef.current;
      for (const key of Object.keys(buf)) {
        if (buf[key]?.timer) clearTimeout(buf[key].timer);
      }
      recordingBufferRef.current = {};
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [wsUrl, token, enabled, flushBatch]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    batchRef.current = [];
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    setIsPaused(false);
  }, []);

  const drainPending = useCallback(() => {
    const elements = pendingElementsRef.current;
    pendingElementsRef.current = [];
    return elements;
  }, []);

  const clearOperations = useCallback(() => {
    setOperations([]);
    setOpsPerSecond(0);
    opsTimestampsRef.current = [];
  }, []);

  const pushOperation = useCallback((op) => {
    setOperations((prev) => {
      const next = [op, ...prev];
      return next.length > bufferSize ? next.slice(0, bufferSize) : next;
    });
  }, [bufferSize]);

  const getStateUpTo = useCallback((opId) => {
    const idx = operations.findIndex(o => o.id === opId);
    if (idx === -1) return null;
    const relevant = operations.slice(idx);
    const nodes = [];
    const edges = [];
    for (const op of relevant) {
      if (op.category === 'node_added') {
        const el = eventToGraphNode(op.meta?.data);
        if (el) nodes.push(el);
      } else if (op.category === 'edge_added') {
        const el = eventToGraphEdge(op.meta?.data);
        if (el) edges.push(el);
      }
    }
    const { nodes: cn, edges: ce } = coalesceGraphData(nodes, edges, {});
    return { nodes: cn, edges: ce };
  }, [operations]);

  return { status, operations, opsPerSecond, isPaused, pause, resume, drainPending, clearOperations, pushOperation, getStateUpTo, recordingBufferRef };
}
