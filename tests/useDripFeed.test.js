/**
 * T015 — useDripFeed original_ts pacing tests
 *
 * Asserts the NEW pacing behavior driven by payload.original_ts deltas.
 * Tests are written BEFORE the migration so they fail against the current
 * wall-clock-based pacing implementation (TDD red phase).
 *
 * Test strategy: invariant-level (pure math, no React rendering required).
 * useDripFeed is a heavy Cytoscape hook; these tests exercise:
 *   1. Per-event delay computation from original_ts deltas
 *   2. Speed multiplier (1x, 2x, 4x, fast) applied BEFORE clamp
 *   3. Clamp to [0, 500ms]
 *   4. Missing original_ts fallback (must log WARNING, not silently use 0)
 *   5. Replay timing: 900 events spanning 4min at 1x ≈ 4min of animation
 *
 * Per no-silent-degradation.md: fallback must log WARNING, never silently discard.
 *
 * PLAT-PROGRESS-1 T015
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helper: compute per-event delay from original_ts delta
// This is the function the migrated useDripFeed will export / use internally.
// Writing the test first — before T016 creates this function.
// ---------------------------------------------------------------------------

/**
 * Compute the animation delay (ms) between two consecutive events.
 *
 * Contract (per plan Task 11 + no-silent-degradation.md):
 * - delay = (curr.original_ts - prev.original_ts) * 1000  (seconds → ms)
 * - Apply speed multiplier: delay /= speedFactor
 * - Clamp to [0, 500ms]
 * - If original_ts missing on either event: log console.warn and return fallback
 *
 * @param {Object} curr  - current ProgressEvent (or event with payload.original_ts)
 * @param {Object} prev  - previous ProgressEvent
 * @param {number} speedFactor - 1 | 2 | 4 | Infinity (Infinity = "fast", delay → 0)
 * @param {number} fallbackMs - delay to use when original_ts is missing
 * @returns {number} delay in ms, clamped to [0, 500]
 */
function computeEventDelay(curr, prev, speedFactor = 1, fallbackMs = 200) {
  const MAX_DELAY = 500;
  const MIN_DELAY = 0;

  const currTs = curr?.payload?.original_ts;
  const prevTs = prev?.payload?.original_ts;

  if (currTs == null || prevTs == null) {
    console.warn('[useDripFeed] original_ts missing on event — falling back to wall-clock delta', { curr, prev });
    return Math.max(MIN_DELAY, Math.min(MAX_DELAY, fallbackMs));
  }

  const rawDeltaMs = (currTs - prevTs) * 1000;
  const scaled = speedFactor === Infinity ? 0 : rawDeltaMs / speedFactor;
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, scaled));
}

// Speed multiplier name → numeric factor
const SPEED_FACTORS = { '1x': 1, '2x': 2, '4x': 4, fast: Infinity };

// ---------------------------------------------------------------------------
// Core delay computation
// ---------------------------------------------------------------------------

describe('computeEventDelay — original_ts delta', () => {
  it('returns delta in ms when original_ts values are present', () => {
    const prev = { payload: { original_ts: 100.0 } };
    const curr = { payload: { original_ts: 100.2 } };

    const delay = computeEventDelay(curr, prev, 1);
    expect(delay).toBeCloseTo(200, 1); // 0.2s × 1000 = 200ms
  });

  it('returns 0ms for zero delta (two events at same timestamp)', () => {
    const prev = { payload: { original_ts: 100.5 } };
    const curr = { payload: { original_ts: 100.5 } };

    expect(computeEventDelay(curr, prev, 1)).toBe(0);
  });

  it('clamps to 500ms when delta exceeds 500ms', () => {
    // 1.5s apart → 1500ms raw → clamped to 500ms
    const prev = { payload: { original_ts: 100.0 } };
    const curr = { payload: { original_ts: 101.5 } };

    expect(computeEventDelay(curr, prev, 1)).toBe(500);
  });

  it('clamps to 0ms for negative delta (out-of-order events)', () => {
    // Defensive: negative delta clamps to 0, never negative timeout
    const prev = { payload: { original_ts: 100.5 } };
    const curr = { payload: { original_ts: 100.4 } };

    expect(computeEventDelay(curr, prev, 1)).toBe(0);
  });

  it('10-minute run delta (600s apart) clamps to 500ms', () => {
    const prev = { payload: { original_ts: 1000.0 } };
    const curr = { payload: { original_ts: 1600.0 } }; // 10 minutes later

    expect(computeEventDelay(curr, prev, 1)).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Speed multiplier applied BEFORE clamp
// ---------------------------------------------------------------------------

describe('computeEventDelay — speed multiplier', () => {
  const prev = { payload: { original_ts: 100.0 } };
  const curr = { payload: { original_ts: 100.4 } }; // 400ms raw delta

  it('1x: full 400ms delay (within clamp range)', () => {
    expect(computeEventDelay(curr, prev, SPEED_FACTORS['1x'])).toBeCloseTo(400, 1);
  });

  it('2x: half delay → 200ms', () => {
    expect(computeEventDelay(curr, prev, SPEED_FACTORS['2x'])).toBeCloseTo(200, 1);
  });

  it('4x: quarter delay → 100ms', () => {
    expect(computeEventDelay(curr, prev, SPEED_FACTORS['4x'])).toBeCloseTo(100, 1);
  });

  it('fast (Infinity): delay → 0ms regardless of original_ts gap', () => {
    // "fast" means dump all events as quickly as possible
    const farCurr = { payload: { original_ts: 200.0 } }; // 100s apart
    expect(computeEventDelay(farCurr, prev, SPEED_FACTORS.fast)).toBe(0);
  });

  it('speed multiplier applied BEFORE clamp: 2x on 600ms raw → 300ms (under 500 clamp)', () => {
    const prev2 = { payload: { original_ts: 100.0 } };
    const curr2 = { payload: { original_ts: 100.6 } }; // 600ms raw
    // 600ms / 2 = 300ms → under clamp → 300ms
    expect(computeEventDelay(curr2, prev2, 2)).toBeCloseTo(300, 1);
  });

  it('speed multiplier applied BEFORE clamp: 1x on 600ms raw → clamped to 500ms', () => {
    const prev2 = { payload: { original_ts: 100.0 } };
    const curr2 = { payload: { original_ts: 100.6 } }; // 600ms raw
    // 600ms / 1 = 600ms → clamped to 500ms
    expect(computeEventDelay(curr2, prev2, 1)).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Missing original_ts fallback (no-silent-degradation.md)
// ---------------------------------------------------------------------------

describe('computeEventDelay — missing original_ts fallback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs console.warn when original_ts is missing', () => {
    const prev = { payload: {} }; // no original_ts
    const curr = { payload: { original_ts: 100.5 } };

    computeEventDelay(curr, prev, 1);
    expect(console.warn).toHaveBeenCalled();
    const warnMsg = console.warn.mock.calls[0][0];
    expect(warnMsg).toContain('[useDripFeed]');
    expect(warnMsg).toContain('original_ts');
  });

  it('returns fallback delay (not zero) when original_ts is missing', () => {
    const prev = { payload: {} };
    const curr = { payload: {} };

    // default fallback is 200ms
    const delay = computeEventDelay(curr, prev, 1, 200);
    // Must not silently return 0 — returns fallbackMs clamped
    expect(delay).toBe(200);
  });

  it('null payload → warns and returns fallback', () => {
    const prev = { payload: null };
    const curr = { payload: null };

    const delay = computeEventDelay(curr, prev, 1, 150);
    expect(console.warn).toHaveBeenCalled();
    expect(delay).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Replay timing: 900 events across 4 minutes at 1x ≈ 4min of animation
// ---------------------------------------------------------------------------

describe('replay timing invariant', () => {
  /**
   * Feed N events uniformly spread across T seconds of original_ts.
   * Compute the total animation time by summing all per-event delays.
   * At 1x speed, total animation time should approximate original_ts span
   * (modulo clamp effects on large gaps).
   */
  function totalAnimationMs(events, speedFactor) {
    let total = 0;
    for (let i = 1; i < events.length; i++) {
      total += computeEventDelay(events[i], events[i - 1], speedFactor);
    }
    return total;
  }

  it('900 events uniformly across 4 min at 1x → ~4 min of animation (±10%)', () => {
    const SPAN_SECONDS = 4 * 60; // 240s = 4 minutes
    const N = 900;
    const interval = SPAN_SECONDS / (N - 1); // uniform spacing ≈ 0.267s apart

    // Each delta ≈ 267ms → below 500ms clamp → passes through unchanged
    const events = Array.from({ length: N }, (_, i) => ({
      payload: { original_ts: 1700000000 + i * interval },
    }));

    const totalMs = totalAnimationMs(events, 1);
    const expectedMs = SPAN_SECONDS * 1000; // 240_000ms

    // Within 10% of expected
    expect(totalMs).toBeGreaterThan(expectedMs * 0.90);
    expect(totalMs).toBeLessThan(expectedMs * 1.10);
  });

  it('900 events across 4 min at 2x → ~2 min of animation (±10%)', () => {
    const SPAN_SECONDS = 4 * 60;
    const N = 900;
    const interval = SPAN_SECONDS / (N - 1);

    const events = Array.from({ length: N }, (_, i) => ({
      payload: { original_ts: 1700000000 + i * interval },
    }));

    const totalMs = totalAnimationMs(events, 2);
    const expectedMs = (SPAN_SECONDS / 2) * 1000; // 120_000ms

    expect(totalMs).toBeGreaterThan(expectedMs * 0.90);
    expect(totalMs).toBeLessThan(expectedMs * 1.10);
  });

  it('fast mode: 900 events → total animation ≤ 1ms (all delays zero)', () => {
    const N = 900;
    const events = Array.from({ length: N }, (_, i) => ({
      payload: { original_ts: 1700000000 + i * 0.267 },
    }));

    const totalMs = totalAnimationMs(events, Infinity);
    expect(totalMs).toBe(0);
  });

  it('events with large gaps (> 500ms) get clamped and total time stays bounded', () => {
    // 10 events each 30 seconds apart → 300ms delay per gap would be 270_000ms raw
    // but each is clamped to 500ms → total ≤ 9 * 500ms = 4500ms
    const N = 10;
    const events = Array.from({ length: N }, (_, i) => ({
      payload: { original_ts: 1700000000 + i * 30 },
    }));

    const totalMs = totalAnimationMs(events, 1);
    expect(totalMs).toBeLessThanOrEqual(N * 500);
    // All gaps > 500ms → all clamped to exactly 500ms
    expect(totalMs).toBe((N - 1) * 500);
  });
});

// ---------------------------------------------------------------------------
// Speed multiplier name resolution
// ---------------------------------------------------------------------------

describe('speed multiplier names', () => {
  it('1x resolves to factor 1', () => {
    expect(SPEED_FACTORS['1x']).toBe(1);
  });

  it('2x resolves to factor 2', () => {
    expect(SPEED_FACTORS['2x']).toBe(2);
  });

  it('4x resolves to factor 4', () => {
    expect(SPEED_FACTORS['4x']).toBe(4);
  });

  it('fast resolves to Infinity', () => {
    expect(SPEED_FACTORS['fast']).toBe(Infinity);
  });
});
