import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Tracks API connection state via health polling.
 * Refactored to accept healthUrl parameter instead of hardcoded env var.
 *
 * @param {Object} options
 * @param {string} options.healthUrl - Full URL to the health endpoint (e.g., 'http://localhost:9001/health')
 * @param {function} [options.onConnectionEvent] - Optional callback fired on connection state changes
 * @returns {{ connected, checking, markDisconnected, checkHealth }}
 */
export function useConnectionStatus({ healthUrl, onConnectionEvent } = {}) {
  const [connected, setConnected] = useState(true);
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef(null);
  const mountedRef = useRef(true);

  const checkHealth = useCallback(async () => {
    if (!healthUrl) return;
    setChecking(true);
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (mountedRef.current) {
        setConnected(res.ok);
        onConnectionEvent?.(res.ok);
      }
    } catch {
      if (mountedRef.current) {
        setConnected(false);
        onConnectionEvent?.(false);
      }
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, [healthUrl, onConnectionEvent]);

  const markDisconnected = useCallback(() => {
    setConnected(false);
    onConnectionEvent?.(false);
  }, [onConnectionEvent]);

  // When disconnected, poll health every 5s. When reconnected, stop.
  useEffect(() => {
    if (connected) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!intervalRef.current) {
      intervalRef.current = setInterval(checkHealth, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connected, checkHealth]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return { connected, checking, markDisconnected, checkHealth };
}
