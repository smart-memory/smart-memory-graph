/**
 * Persistent event store for graph streaming replay.
 *
 * Stores only the LAST session's graph events in IndexedDB.
 * Each "recording" is one ingest operation that can be replayed
 * offline through the same interleaved drip-feed animation pipeline.
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

/**
 * Save a recording, replacing any previous recording (last-session only).
 */
export async function saveRecording(recording) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Clear all previous recordings — only keep the latest
    store.clear();

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
