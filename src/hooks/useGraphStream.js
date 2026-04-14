import { useState, useEffect, useRef, useCallback } from 'react';
import { classifyEvent } from '../core/classifyEvent';
import { eventToGraphNode, eventToGraphEdge } from '../core/eventTransform';
import { coalesceGraphData } from '../core/coalesce';
import { saveRecording, shouldSaveToIDB } from '../core/eventStore';
import { subscribeProgress } from '@smartmemory/sdk-js/progress';

/**
 * React hook for real-time graph event streaming via SmartMemory SSE progress bus.
 *
 * Transport: uses `subscribeProgress` from the JS SDK (fetch-based SSE, header auth).
 * WS transport is removed — the Insights WebSocket endpoint is no longer the
 * graph viewer's data source. The new source is GET /memory/progress/stream.
 *
 * @param {Object} options
 * @param {string} [options.sseBaseUrl] - SmartMemory API base URL (e.g. 'http://localhost:9001')
 * @param {string} [options.token] - Bearer JWT for SSE auth
 * @param {boolean} [options.enabled=true] - Toggle connection
 * @param {number} [options.bufferSize=100] - Ring buffer capacity
 * @param {string} [options.runId] - When set, subscribes in replay mode (run_id + from_seq=0)
 * @param {Function} [options.onElementAdded] - Callback with GraphNode | GraphEdge
 * @param {Function} [options.onSearchHighlight] - Callback with array of matching node IDs
 * @param {Function} [options.onPipelineProgress] - Callback with { nodeId, stage, durationMs }
 * @param {Function} [options.onGraphCleared] - Callback when graph is cleared
 * @param {Function} [options.onReconnect] - Callback on SSE reconnection
 * @param {Function} [options.onGroundingFlash] - Callback with nodeId when entity is grounded
 */
export function useGraphStream(options = {}) {
  const {
    sseBaseUrl = '',
    token,
    enabled = true,
    bufferSize = 100,
    runId,
    onElementAdded,
    onSearchHighlight,
    onPipelineProgress,
    onGraphCleared,
    onReconnect,
    onGroundingFlash,
    onReplayNotFound,
  } = options;

  const [status, setStatus] = useState('disconnected');
  const [operations, setOperations] = useState(() => {
    try {
      const saved = sessionStorage.getItem('graph:operations');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [opsPerSecond, setOpsPerSecond] = useState(0);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  const callbacksRef = useRef({ onElementAdded, onSearchHighlight, onPipelineProgress, onGraphCleared, onReconnect, onGroundingFlash, onReplayNotFound });
  callbacksRef.current = { onElementAdded, onSearchHighlight, onPipelineProgress, onGraphCleared, onReconnect, onGroundingFlash, onReplayNotFound };

  const batchRef = useRef([]);
  const batchTimerRef = useRef(null);
  const opsTimestampsRef = useRef([]);
  const unmountedRef = useRef(false);
  const pendingElementsRef = useRef([]);
  const recordingBufferRef = useRef({});
  const RECORDING_FLUSH_DELAY = 2000;
  const canonicalMapRef = useRef({});
  // Set to a non-null string when SSE fails for the retry budget — gates IDB writes.
  const sseFailedReasonRef = useRef(null);

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
      const result = next.length > bufferSize ? next.slice(0, bufferSize) : next;
      try { sessionStorage.setItem('graph:operations', JSON.stringify(result)); } catch {}
      return result;
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
      // Pipeline stage: record so replay can show the same stage indicator transitions.
      if (op.category === 'pipeline_stage') {
        const groupKey = op.traceId || batchKey;
        const buf = recordingBufferRef.current;
        if (!buf[groupKey]) buf[groupKey] = { elements: [], label: '', timer: null };
        buf[groupKey].elements.push({
          category: 'pipeline_stage',
          meta: op.meta,
          label: op.label,
          timestamp: op.timestamp,
        });
        continue;
      }

      // Grounding flash: no graph element, but record nodeId so replay can trigger the flash animation.
      if (op.category === 'grounding_flash' && op.nodeId) {
        const groupKey = op.traceId || batchKey;
        const buf = recordingBufferRef.current;
        if (buf[groupKey]) {
          buf[groupKey].elements.push({ category: 'grounding_flash', nodeId: op.nodeId, timestamp: op.timestamp });
        }
        continue;
      }

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
          // IDB write only on offline / SSE-failure path (no-silent-degradation.md).
          // In the common case (online + SSE connected) shouldSaveToIDB returns false.
          if (shouldSaveToIDB(sseFailedReasonRef.current)) {
            saveRecording({
              traceId: capturedKey,
              label: finalRec.label || `Recording ${new Date().toLocaleTimeString()}`,
              events: finalRec.elements,
            });
          }
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

  // SSE connection via subscribeProgress
  useEffect(() => {
    unmountedRef.current = false;

    if (!enabled) {
      setStatus('disconnected');
      return;
    }

    let unmounted = false;
    let subscription = null;

    // Reset SSE-failed gate on each new connection attempt
    sseFailedReasonRef.current = null;
    setStatus('connecting');

    const subscribeOpts = {
      baseUrl: sseBaseUrl,
      onEvent(progressEvent) {
        if (unmounted || isPausedRef.current) return;

        // Translate ProgressEvent into the legacy classified-event shape so the
        // existing batching + callback-dispatch pipeline (flushBatch) is unchanged.
        const classified = classifyProgressEvent(progressEvent);
        if (!classified) return;

        batchRef.current.push(classified);

        if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(() => {
            batchTimerRef.current = null;
            flushBatch();
          }, 200);
        }
      },
      onError(err) {
        if (unmounted) return;
        const errMsg = err?.message || String(err) || '';
        const reason = errMsg || 'SSE connection failed after retries';
        console.warn('[useGraphStream] SSE error:', err);
        setStatus('disconnected');
        // Flip the IDB gate on so subsequent recording flushes persist for offline replay.
        // shouldSaveToIDB(reason) will log the warning per no-silent-degradation.md.
        sseFailedReasonRef.current = reason;

        // 404: run has expired from the stream window — try IDB, then surface "not available"
        if (runId && errMsg.includes('404')) {
          import('../core/eventStore').then(({ getRecordingByRunId }) =>
            getRecordingByRunId(runId)
          ).then((recording) => {
            if (unmounted) return;
            callbacksRef.current.onReplayNotFound?.(recording);
          });
        }
      },
      onReconnect() {
        if (unmounted) return;
        callbacksRef.current.onReconnect?.();
      },
    };

    if (token) {
      subscribeOpts.token = token;
    }

    // Replay mode: pass runId + fromSeq=0
    if (runId) {
      subscribeOpts.runId = runId;
      subscribeOpts.fromSeq = 0;
    }

    subscription = subscribeProgress(subscribeOpts);
    setStatus('connected');

    return () => {
      unmounted = true;
      unmountedRef.current = true;
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
      if (subscription) {
        subscription.close();
      }
    };
  }, [sseBaseUrl, token, enabled, runId, flushBatch]);

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
    try { sessionStorage.removeItem('graph:operations'); } catch {}
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

// ---------------------------------------------------------------------------
// ProgressEvent → classified event adapter
//
// The existing flushBatch() dispatch pipeline (and the recording accumulator)
// work on the "classified" shape produced by classifyEvent(rawWsFrame).
// ProgressEvents have a different wire shape (kind, stage, payload.data, etc.).
// This adapter bridges the two without changing classifyEvent or flushBatch.
// ---------------------------------------------------------------------------

/**
 * Translate a ProgressEvent from the SSE bus into the classified-event shape
 * that useGraphStream's flushBatch + recording accumulator expect.
 *
 * Returns null for event kinds the graph viewer doesn't handle.
 *
 * @param {Object} progressEvent - ProgressEvent per progress-event-contract.json
 */
function classifyProgressEvent(progressEvent) {
  if (!progressEvent) return null;

  const { kind, stage, status, payload, run_id, seq, ts } = progressEvent;
  const id = `pe-${run_id}-${seq}`;
  const timestamp = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  const traceId = run_id;
  const base = { id, timestamp, traceId, meta: progressEvent };

  // Graph node events
  if (kind === 'graph.node' && payload?.data) {
    const data = payload.data;
    const nodeId = data.memory_id || data.item_id || data.node_id || data.id || null;
    if (nodeId && nodeId.startsWith('wikipedia:')) return null;
    return {
      ...base,
      category: 'node_added',
      label: `Node "${data.label || nodeId || 'unknown'}" added`,
      nodeId,
      meta: { ...progressEvent, data, operation: 'add_node' },
    };
  }

  // Graph edge events
  if (kind === 'graph.edge' && payload?.data) {
    const data = payload.data;
    const src = data.source_id || data.source || '';
    const tgt = data.target_id || data.target || '';
    const edgeType = data.edge_type || data.link_type || 'RELATES_TO';

    if (edgeType === 'GROUNDED_IN' || src.startsWith('wikipedia:') || tgt.startsWith('wikipedia:')) {
      const groundedNodeId = src.startsWith('wikipedia:') ? tgt : src;
      const wikiId = src.startsWith('wikipedia:') ? src : tgt;
      const wikiName = wikiId.replace('wikipedia:', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { ...base, category: 'grounding_flash', label: `Grounded "${wikiName}"`, nodeId: groundedNodeId };
    }

    const edgeId = data.edge_id || (src && tgt ? `${src}->${tgt}` : null);
    return {
      ...base,
      category: 'edge_added',
      label: `Edge "${edgeType}"`,
      nodeId: src || null,
      edgeId,
      meta: { ...progressEvent, data, operation: 'add_edge' },
    };
  }

  // Pipeline stage events
  if (kind === 'pipeline.stage') {
    const stageName = stage || 'unknown';
    const durationMs = payload?.duration_ms;
    const durationStr = durationMs != null ? ` (${Math.round(durationMs)}ms)` : '';
    return {
      ...base,
      category: 'pipeline_stage',
      label: `Pipeline: ${stageName.replace(/_/g, ' ')}${durationStr}`,
      nodeId: payload?.memory_id || null,
      meta: { ...progressEvent, operation: stageName, duration_ms: durationMs },
    };
  }

  // Graph clear events
  if (kind === 'graph.cleared') {
    return { ...base, category: 'graph_cleared', label: 'Graph cleared', nodeId: null };
  }

  // Search result events
  if (kind === 'search.result' && payload?.result_ids) {
    return {
      ...base,
      category: 'search_highlight',
      label: `Search: ${payload.result_ids.length} results`,
      nodeId: null,
      matchIds: payload.result_ids,
    };
  }

  // Ingest start events
  if (kind === 'ingest.started') {
    const preview = payload?.content?.substring(0, 30) || payload?.memory_id || '';
    return { ...base, category: 'ingest_started', label: `Ingesting: "${preview}..."`, nodeId: payload?.memory_id || null };
  }

  return null;
}
