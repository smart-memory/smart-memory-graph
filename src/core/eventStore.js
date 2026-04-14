/**
 * Persistent event store for graph streaming replay.
 *
 * PLAT-PROGRESS-1 T017: IndexedDB is now an OFFLINE FALLBACK ONLY.
 * IDB writes happen only when:
 *   1. navigator.onLine === false (offline mode), OR
 *   2. The SSE connection has failed for the full retry budget
 *
 * Per no-silent-degradation.md: every fallback path logs console.warn with
 * the reason. Silent empty results are not allowed — if IDB also has nothing,
 * the caller receives null and must surface a "recording not available" state.
 *
 * For the common case (SSE connected, online): no IDB writes occur.
 *
 * Storage schema:
 *   recordings: { traceId, timestamp, label, events[] }
 *   events[]:   { category, element, timestamp }
 */

const DB_NAME = 'smartmemory-viewer-events';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('traceId', 'traceId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const MAX_RECORDINGS = 20;

/**
 * Determine whether a recording should be saved to IDB.
 *
 * Returns true (and logs a warning) only when:
 * - navigator.onLine is false, OR
 * - the caller supplies a non-null `reason` (SSE failure path)
 *
 * In the normal online + SSE-connected case, returns false silently.
 * Per no-silent-degradation.md: the fallback path MUST log.
 *
 * @param {string|null} reason - SSE failure reason, or null for online/connected check
 * @returns {boolean}
 */
export function shouldSaveToIDB(reason = null) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (offline) {
    console.warn('[EventStore] falling back to IDB: offline (navigator.onLine === false)');
    return true;
  }
  if (reason != null) {
    console.warn(`[EventStore] falling back to IDB: ${reason}`);
    return true;
  }
  return false;
}

/**
 * Save a recording to IDB (offline fallback only).
 *
 * Callers should check shouldSaveToIDB(reason) before calling this.
 * saveRecording itself does NOT check — it trusts the caller.
 * This keeps the API clean: check → decide → save.
 */
export async function saveRecording(recording) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Prune oldest entries if at capacity
    const keys = await new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (keys.length >= MAX_RECORDINGS) {
      keys.sort().slice(0, keys.length - MAX_RECORDINGS + 1).forEach((k) => store.delete(k));
    }

    store.add({
      ...recording,
      timestamp: Date.now(),
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[EventStore] Failed to save recording:', err);
  }
}

/**
 * Get the last recording (returns null if none exists).
 */
export async function getLastRecording() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (all.length === 0) return null;
    // Return the most recent one
    return all.sort((a, b) => b.timestamp - a.timestamp)[0];
  } catch (err) {
    console.warn('[EventStore] Failed to load recording:', err);
    return null;
  }
}

/**
 * Get a recording by traceId (= run_id).
 * Used as the 404 fallback: if the SSE server says the run has expired,
 * check IDB before surfacing "recording not available".
 *
 * Returns null if not found — never returns empty array silently.
 * Callers must handle null by surfacing a user-visible error state.
 *
 * @param {string} traceId - run_id / traceId to look up
 * @returns {Promise<Object|null>}
 */
export async function getRecordingByRunId(traceId) {
  if (!traceId) return null;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index('traceId');

    const match = await new Promise((resolve, reject) => {
      const req = idx.getAll(IDBKeyRange.only(traceId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    if (!match || match.length === 0) return null;
    // Return the most recent one if there are duplicates
    return match.sort((a, b) => b.timestamp - a.timestamp)[0];
  } catch (err) {
    console.warn('[EventStore] Failed to load recording by runId:', err);
    return null;
  }
}

/**
 * Get all recordings, newest first.
 */
export async function getAllRecordings() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    console.warn('[EventStore] Failed to load recordings:', err);
    return [];
  }
}

/**
 * Clear all recordings.
 */
export async function clearRecordings() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[EventStore] Failed to clear recordings:', err);
  }
}
