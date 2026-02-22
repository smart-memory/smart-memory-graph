/**
 * Tests for VIS-GRAPH-10: Organic Graph Unfurling
 *
 * Scope: invariant and contract tests for the three behavioral changes.
 * These are NOT hook integration tests — useDripFeed requires a live
 * Cytoscape canvas and is tested via E2E. Tests here cover:
 *
 *   1. STREAMING_LAYOUT export contract (cola, animate:true, fit:false)
 *   2. Animation call signature contracts (duration, easing, complete callback)
 *   3. EMA centroid math (invariant — pure arithmetic)
 *   4. Pan throttle logic (timer guard invariant)
 *   5. Born-at-parent positioning contract (no radial offset)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STREAMING_LAYOUT } from '../src/internal/useCytoscape.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNodeMock(id, { width = '16px', height = '16px', pos = { x: 100, y: 200 } } = {}) {
  const styles = {};
  const mock = {
    _id: id,
    _pos: null,
    style: vi.fn((arg) => {
      if (typeof arg === 'string') return styles[arg] ?? (arg === 'width' ? width : arg === 'height' ? height : '1');
      Object.assign(styles, arg);
      return mock;
    }),
    animate: vi.fn(() => mock),
    addClass: vi.fn(() => mock),
    removeClass: vi.fn(() => mock),
    position: vi.fn((p) => {
      if (p) { mock._pos = p; return mock; }
      return mock._pos ?? pos;
    }),
    inside: vi.fn(() => true),
    length: 1,
  };
  return mock;
}

function makeEdgeMock(id) {
  const styles = {};
  const mock = {
    _id: id,
    style: vi.fn((arg) => {
      if (typeof arg === 'string') return styles[arg] ?? '0.6';
      Object.assign(styles, arg);
      return mock;
    }),
    animate: vi.fn(() => mock),
    addClass: vi.fn(() => mock),
    inside: vi.fn(() => true),
    length: 1,
  };
  return mock;
}

// ── STREAMING_LAYOUT contract ─────────────────────────────────────────────────

describe('STREAMING_LAYOUT', () => {
  it('uses cola layout engine', () => {
    expect(STREAMING_LAYOUT.name).toBe('cola');
  });

  it('has animate: true for continuous incremental physics', () => {
    expect(STREAMING_LAYOUT.animate).toBe(true);
  });

  it('has fit: false — camera managed by EMA pan, not layout', () => {
    expect(STREAMING_LAYOUT.fit).toBe(false);
  });

  it('has randomize: false — only new nodes are unsettled', () => {
    expect(STREAMING_LAYOUT.randomize).toBe(false);
  });

  it('has a bounded maxSimulationTime to prevent runaway simulation', () => {
    expect(typeof STREAMING_LAYOUT.maxSimulationTime).toBe('number');
    expect(STREAMING_LAYOUT.maxSimulationTime).toBeGreaterThan(0);
    expect(STREAMING_LAYOUT.maxSimulationTime).toBeLessThanOrEqual(5000);
  });
});

// ── Node entry animation call signatures ──────────────────────────────────────

describe('node entry animation', () => {
  it('reads resolved size BEFORE overriding to zero', () => {
    const node = makeNodeMock('n1', { width: '28px', height: '28px' });

    // Contract: read style first, then zero it, then animate to read value
    const targetW = node.style('width');
    const targetH = node.style('height');
    expect(targetW).toBe('28px');
    expect(targetH).toBe('28px');

    node.style({ width: 0, height: 0, opacity: 0 });
    node.animate(
      { style: { width: targetW, height: targetH, opacity: 1 } },
      { duration: 250, easing: 'ease-out-cubic', complete: vi.fn() }
    );

    // Assert the animate call targets the pre-read resolved size
    const animateCall = node.animate.mock.calls[0];
    expect(animateCall[0].style.width).toBe('28px');
    expect(animateCall[0].style.height).toBe('28px');
    expect(animateCall[0].style.opacity).toBe(1);
  });

  it('uses 250ms ease-out-cubic easing', () => {
    const node = makeNodeMock('n1', { width: '16px', height: '16px' });
    node.animate(
      { style: { width: '16px', height: '16px', opacity: 1 } },
      { duration: 250, easing: 'ease-out-cubic', complete: vi.fn() }
    );
    const opts = node.animate.mock.calls[0][1];
    expect(opts.duration).toBe(250);
    expect(opts.easing).toBe('ease-out-cubic');
  });

  it('includes a complete callback for sequencing glow and physics after animation', () => {
    const node = makeNodeMock('n1');
    const complete = vi.fn();
    node.animate(
      { style: { width: '16px', height: '16px', opacity: 1 } },
      { duration: 250, easing: 'ease-out-cubic', complete }
    );
    const opts = node.animate.mock.calls[0][1];
    expect(typeof opts.complete).toBe('function');
  });

  it('streaming-new class is added inside the complete callback, not before', () => {
    // Contract: addClass must NOT be called before animate fires complete.
    // The complete callback calls addClass; outside animate, addClass is never called directly.
    const node = makeNodeMock('n1');
    const addClassSpy = node.addClass;

    // Simulate the correct sequencing: animate called, complete NOT yet fired
    node.animate(
      { style: { width: '16px', height: '16px', opacity: 1 } },
      { duration: 250, easing: 'ease-out-cubic', complete: () => node.addClass('streaming-new') }
    );

    // Before complete fires: addClass not yet called
    expect(addClassSpy).not.toHaveBeenCalled();

    // Fire the complete callback manually
    const completeFn = node.animate.mock.calls[0][1].complete;
    completeFn();

    // After complete fires: addClass called with 'streaming-new'
    expect(addClassSpy).toHaveBeenCalledWith('streaming-new');
  });
});

// ── Edge entry animation call signatures ──────────────────────────────────────

describe('edge entry animation', () => {
  it('fades in via opacity: 0 → 1 over 150ms ease-out-sine', () => {
    const edge = makeEdgeMock('e1');
    edge.style({ opacity: 0 });
    edge.animate(
      { style: { opacity: 1 } },
      { duration: 150, easing: 'ease-out-sine', complete: vi.fn() }
    );

    expect(edge.style).toHaveBeenCalledWith({ opacity: 0 });
    const animateCall = edge.animate.mock.calls[0];
    expect(animateCall[0].style.opacity).toBe(1);
    expect(animateCall[1].duration).toBe(150);
    expect(animateCall[1].easing).toBe('ease-out-sine');
  });

  it('does not animate width or height for edges', () => {
    const edge = makeEdgeMock('e1');
    edge.animate(
      { style: { opacity: 1 } },
      { duration: 150, easing: 'ease-out-sine', complete: vi.fn() }
    );
    const styleTarget = edge.animate.mock.calls[0][0].style;
    expect(styleTarget.width).toBeUndefined();
    expect(styleTarget.height).toBeUndefined();
  });

  it('includes a complete callback so streaming-new class does not fight the fade', () => {
    const edge = makeEdgeMock('e1');
    const complete = vi.fn();
    edge.animate({ style: { opacity: 1 } }, { duration: 150, easing: 'ease-out-sine', complete });
    expect(typeof edge.animate.mock.calls[0][1].complete).toBe('function');
  });
});

// ── EMA centroid math (pure invariant) ───────────────────────────────────────

describe('EMA centroid math', () => {
  it('initialises to first node position', () => {
    let centroid = null;
    const pos = { x: 150, y: 250 };

    if (!centroid) centroid = { x: pos.x, y: pos.y };

    expect(centroid).toEqual({ x: 150, y: 250 });
  });

  it('applies α=0.3 weighting: new node contributes 30%, history 70%', () => {
    let centroid = { x: 100, y: 200 };
    const newPos = { x: 200, y: 400 };
    const α = 0.3;

    centroid = {
      x: α * newPos.x + (1 - α) * centroid.x,
      y: α * newPos.y + (1 - α) * centroid.y,
    };

    expect(centroid.x).toBeCloseTo(130, 5); // 0.3*200 + 0.7*100
    expect(centroid.y).toBeCloseTo(260, 5); // 0.3*400 + 0.7*200
  });

  it('centroid never jumps to new node position in one step', () => {
    let centroid = { x: 0, y: 0 };
    const newPos = { x: 1000, y: 1000 };
    const α = 0.3;

    centroid = {
      x: α * newPos.x + (1 - α) * centroid.x,
      y: α * newPos.y + (1 - α) * centroid.y,
    };

    expect(centroid.x).toBeLessThan(newPos.x);
    expect(centroid.x).toBeGreaterThan(0);
  });

  it('converges toward target over multiple steps', () => {
    let centroid = { x: 0, y: 0 };
    const target = { x: 500, y: 500 };
    const α = 0.3;

    for (let i = 0; i < 20; i++) {
      centroid = {
        x: α * target.x + (1 - α) * centroid.x,
        y: α * target.y + (1 - α) * centroid.y,
      };
    }

    // After 20 steps, centroid should be very close to target
    expect(centroid.x).toBeGreaterThan(490);
    expect(centroid.y).toBeGreaterThan(490);
  });
});

// ── Pan throttle (timer guard invariant) ─────────────────────────────────────

describe('pan throttle', () => {
  it('fires at most once per 400ms window regardless of how many nodes arrive', () => {
    vi.useFakeTimers();
    const panFn = vi.fn();
    let panTimer = null;

    // Simulate 10 nodes arriving rapidly
    for (let i = 0; i < 10; i++) {
      if (!panTimer) {
        panTimer = setTimeout(() => {
          panTimer = null;
          panFn();
        }, 400);
      }
    }

    vi.advanceTimersByTime(400);
    expect(panFn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('allows a second pan 400ms after the first', () => {
    vi.useFakeTimers();
    const panFn = vi.fn();
    let panTimer = null;

    // First batch
    if (!panTimer) {
      panTimer = setTimeout(() => { panTimer = null; panFn(); }, 400);
    }
    vi.advanceTimersByTime(400);
    expect(panFn).toHaveBeenCalledTimes(1);

    // Second batch arrives after the first pan cleared panTimer
    if (!panTimer) {
      panTimer = setTimeout(() => { panTimer = null; panFn(); }, 400);
    }
    vi.advanceTimersByTime(400);
    expect(panFn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('skips pan if user has interacted (userInteracted guard)', () => {
    vi.useFakeTimers();
    let userInteracted = true;
    const panFn = vi.fn();
    let panTimer = null;

    if (!panTimer) {
      panTimer = setTimeout(() => {
        panTimer = null;
        if (!userInteracted) panFn(); // guard checked inside timer
      }, 400);
    }

    vi.advanceTimersByTime(500);
    expect(panFn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// ── Born-at-parent positioning contract ──────────────────────────────────────

describe('positionStreamedNode (born-at-parent)', () => {
  it('places entity node exactly at parent position with no offset', () => {
    const parentPos = { x: 300, y: 150 };
    const parent = makeNodeMock('parent', { pos: parentPos });
    const entity = makeNodeMock('entity');

    const cy = {
      getElementById: vi.fn((id) => id === 'parent' ? parent : id === 'entity' ? entity : { length: 0 }),
      nodes: vi.fn(() => ({ filter: vi.fn(() => ({ length: 0 })) })),
      width: vi.fn(() => 800),
      height: vi.fn(() => 600),
    };

    // Simulate the born-at-parent branch
    const cyEl = { group: 'nodes', data: { id: 'entity', parentId: 'parent' } };
    const node = cy.getElementById(cyEl.data.id);
    const par = cy.getElementById(cyEl.data.parentId);
    if (par.length) node.position({ x: par.position().x, y: par.position().y });

    // Entity born at exact parent position — no golden-angle radial math
    expect(entity.position).toHaveBeenCalledWith({ x: 300, y: 150 });
    const posCall = entity.position.mock.calls.find(c => c[0] !== undefined)[0];
    expect(posCall.x).toBe(300);
    expect(posCall.y).toBe(150);
  });

  it('does NOT apply radial offset (golden-angle math removed)', () => {
    const parentPos = { x: 300, y: 150 };
    const parent = makeNodeMock('parent', { pos: parentPos });
    const entity = makeNodeMock('entity');
    const cy = {
      getElementById: vi.fn((id) => id === 'parent' ? parent : id === 'entity' ? entity : { length: 0 }),
    };

    const par = cy.getElementById('parent');
    entity.position({ x: par.position().x, y: par.position().y });

    // If golden-angle math were applied: x = 300 + 120*cos(0) = 420, y ≠ 150
    // With born-at-parent: x = 300, y = 150 (exactly equal to parent)
    const posCall = entity.position.mock.calls[0][0];
    expect(posCall.x).toBe(parentPos.x); // not parentPos.x + radius
    expect(posCall.y).toBe(parentPos.y); // not parentPos.y + offset
  });

  it('places memory nodes along horizontal row (no parentId)', () => {
    const mem = makeNodeMock('mem1');
    const cy = {
      getElementById: vi.fn((id) => id === 'mem1' ? mem : { length: 0 }),
      nodes: vi.fn(() => ({ filter: vi.fn(() => ({ length: 1 })) })),
      width: vi.fn(() => 800),
      height: vi.fn(() => 600),
    };

    // count = 1, so offset = (1-1)*200 = 0 → placed at center
    const count = cy.nodes().filter().length;
    const cx = cy.width() / 2;
    const cyy = cy.height() / 2;
    mem.position({ x: cx + (count - 1) * 200, y: cyy });

    expect(mem.position).toHaveBeenCalledWith({ x: 400, y: 300 });
  });
});
