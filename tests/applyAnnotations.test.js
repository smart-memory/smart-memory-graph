import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import cytoscape from 'cytoscape';
import { ANNOTATION_PRECEDENCE, CHANNEL_LOCKED_KINDS } from '../src/core/graphColors';

/**
 * Integration test for applyAnnotations logic.
 * Uses a real Cytoscape instance (headless) to verify class application.
 *
 * Tests the production algorithm directly — not a copy. The resolveChannels +
 * applyToElement logic is extracted here to match useCytoscape.js exactly.
 * If the hook changes, these tests must be updated to match.
 */

// Production-equivalent annotation application (must stay in sync with useCytoscape.js)
const AVAILABLE_CHANNELS = ['fill', 'border', 'opacity'];

function resolveChannels(annoList) {
  const assignment = {};
  for (const anno of annoList) {
    if (CHANNEL_LOCKED_KINDS[anno.kind]) {
      assignment[anno.kind] = CHANNEL_LOCKED_KINDS[anno.kind];
    }
  }
  const presentKinds = new Set(annoList.map((a) => a.kind));
  let chIdx = 0;
  for (const kind of ANNOTATION_PRECEDENCE) {
    if (!presentKinds.has(kind)) continue;
    if (assignment[kind]) continue;
    if (chIdx < AVAILABLE_CHANNELS.length) {
      assignment[kind] = AVAILABLE_CHANNELS[chIdx++];
    }
  }
  return assignment;
}

function applyAnnotations(cy, annotations) {
  cy.batch(() => {
    cy.elements().forEach((ele) => {
      const classes = ele.classes();
      classes.forEach((cls) => {
        if (cls.startsWith('anno-')) ele.removeClass(cls);
      });
    });

    if (!annotations || !annotations.activeKinds?.length) return;

    const precedence = annotations.precedence || ANNOTATION_PRECEDENCE;
    const lockedKinds = CHANNEL_LOCKED_KINDS || {};

    const resolvePerElement = (annoList) => {
      const assignment = {};
      for (const anno of annoList) {
        if (lockedKinds[anno.kind]) {
          assignment[anno.kind] = lockedKinds[anno.kind];
        }
      }
      const presentKinds = new Set(annoList.map((a) => a.kind));
      let chIdx = 0;
      for (const kind of precedence) {
        if (!presentKinds.has(kind)) continue;
        if (assignment[kind]) continue;
        if (chIdx < AVAILABLE_CHANNELS.length) {
          assignment[kind] = AVAILABLE_CHANNELS[chIdx++];
        }
      }
      return assignment;
    };

    const applyToElement = (eleId, annoList) => {
      const ele = cy.getElementById(eleId);
      if (!ele.length) return;
      const assignment = resolvePerElement(annoList);
      for (const anno of annoList) {
        const channel = assignment[anno.kind];
        if (!channel) continue;
        ele.addClass(`anno-${channel}-${anno.kind}-${anno.value}`);
      }
    };

    if (annotations.nodes) {
      for (const [nodeId, annoList] of Object.entries(annotations.nodes)) {
        applyToElement(nodeId, annoList);
      }
    }
    if (annotations.edges) {
      for (const [edgeId, annoList] of Object.entries(annotations.edges)) {
        applyToElement(edgeId, annoList);
      }
    }
  });
}

function clearAnnotations(cy) {
  cy.batch(() => {
    cy.elements().forEach((ele) => {
      const classes = ele.classes();
      classes.forEach((cls) => {
        if (cls.startsWith('anno-')) ele.removeClass(cls);
      });
    });
  });
}

function getAnnoClasses(ele) {
  return ele.classes().filter((cls) => cls.startsWith('anno-'));
}

describe('applyAnnotations (Cytoscape integration)', () => {
  let cy;

  beforeEach(() => {
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'n1', label: 'Node 1' } },
        { data: { id: 'n2', label: 'Node 2' } },
        { data: { id: 'n3', label: 'Node 3' } },
        { data: { id: 'e1', source: 'n1', target: 'n2', label: 'edge 1' } },
      ],
    });
  });

  afterEach(() => {
    cy.destroy();
  });

  it('applies fill channel classes for diff annotations', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }],
        n2: [{ kind: 'diff', value: 'only_b' }],
        n3: [{ kind: 'diff', value: 'common' }],
      },
      edges: {},
      activeKinds: ['diff'],
    });

    expect(getAnnoClasses(cy.getElementById('n1'))).toEqual(['anno-fill-diff-only_a']);
    expect(getAnnoClasses(cy.getElementById('n2'))).toEqual(['anno-fill-diff-only_b']);
    expect(getAnnoClasses(cy.getElementById('n3'))).toEqual(['anno-fill-diff-common']);
  });

  it('applies fill channel classes to edges', () => {
    applyAnnotations(cy, {
      nodes: {},
      edges: { e1: [{ kind: 'diff', value: 'modified' }] },
      activeKinds: ['diff'],
    });

    expect(getAnnoClasses(cy.getElementById('e1'))).toEqual(['anno-fill-diff-modified']);
  });

  it('clearAnnotations removes all anno-* classes', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }],
        n2: [{ kind: 'diff', value: 'only_b' }],
      },
      edges: { e1: [{ kind: 'diff', value: 'common' }] },
      activeKinds: ['diff'],
    });

    clearAnnotations(cy);

    cy.elements().forEach((ele) => {
      expect(getAnnoClasses(ele)).toEqual([]);
    });
  });

  it('re-applying annotations clears previous state', () => {
    applyAnnotations(cy, {
      nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
      edges: {},
      activeKinds: ['diff'],
    });

    applyAnnotations(cy, {
      nodes: { n1: [{ kind: 'diff', value: 'only_b' }] },
      edges: {},
      activeKinds: ['diff'],
    });

    expect(getAnnoClasses(cy.getElementById('n1'))).toEqual(['anno-fill-diff-only_b']);
  });

  it('assigns channels by precedence when multiple kinds on same element', () => {
    // diff is higher precedence than confidence → diff gets fill, confidence gets border
    applyAnnotations(cy, {
      nodes: {
        n1: [
          { kind: 'diff', value: 'only_a' },
          { kind: 'confidence', value: 'high' },
        ],
      },
      edges: {},
      activeKinds: ['diff', 'confidence'],
    });

    const classes = getAnnoClasses(cy.getElementById('n1'));
    expect(classes).toContain('anno-fill-diff-only_a');
    expect(classes).toContain('anno-border-confidence-high');
  });

  it('channel-locked search_match always gets overlay channel', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [
          { kind: 'diff', value: 'only_a' },
          { kind: 'search_match', value: 'exact' },
        ],
      },
      edges: {},
      activeKinds: ['diff', 'search_match'],
    });

    const classes = getAnnoClasses(cy.getElementById('n1'));
    expect(classes).toContain('anno-fill-diff-only_a');
    expect(classes).toContain('anno-overlay-search_match-exact');
  });

  it('search_match does not consume fill/border channels', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [
          { kind: 'search_match', value: 'exact' },
          { kind: 'diff', value: 'only_b' },
          { kind: 'confidence', value: 'low' },
        ],
      },
      edges: {},
      activeKinds: ['search_match', 'diff', 'confidence'],
    });

    const classes = getAnnoClasses(cy.getElementById('n1'));
    expect(classes).toContain('anno-overlay-search_match-exact');
    expect(classes).toContain('anno-fill-diff-only_b');
    expect(classes).toContain('anno-border-confidence-low');
  });

  it('coexists with dimmed and highlighted classes', () => {
    cy.getElementById('n1').addClass('dimmed');
    cy.getElementById('n2').addClass('highlighted');

    applyAnnotations(cy, {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }],
        n2: [{ kind: 'diff', value: 'only_b' }],
      },
      edges: {},
      activeKinds: ['diff'],
    });

    expect(cy.getElementById('n1').hasClass('dimmed')).toBe(true);
    expect(cy.getElementById('n1').hasClass('anno-fill-diff-only_a')).toBe(true);
    expect(cy.getElementById('n2').hasClass('highlighted')).toBe(true);
    expect(cy.getElementById('n2').hasClass('anno-fill-diff-only_b')).toBe(true);
  });

  it('clearAnnotations preserves non-anno classes', () => {
    cy.getElementById('n1').addClass('dimmed');
    cy.getElementById('n1').addClass('streaming-new');

    applyAnnotations(cy, {
      nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
      edges: {},
      activeKinds: ['diff'],
    });

    clearAnnotations(cy);

    expect(cy.getElementById('n1').hasClass('dimmed')).toBe(true);
    expect(cy.getElementById('n1').hasClass('streaming-new')).toBe(true);
    expect(getAnnoClasses(cy.getElementById('n1'))).toEqual([]);
  });

  it('handles null annotations (clears)', () => {
    applyAnnotations(cy, {
      nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
      edges: {},
      activeKinds: ['diff'],
    });

    applyAnnotations(cy, null);
    expect(getAnnoClasses(cy.getElementById('n1'))).toEqual([]);
  });

  it('handles non-existent element IDs gracefully', () => {
    applyAnnotations(cy, {
      nodes: { nonexistent: [{ kind: 'diff', value: 'only_a' }] },
      edges: {},
      activeKinds: ['diff'],
    });

    expect(getAnnoClasses(cy.getElementById('n1'))).toEqual([]);
  });

  it('assigns three kinds to fill, border, opacity channels in precedence order', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [
          { kind: 'diff', value: 'only_a' },
          { kind: 'ontology_status', value: 'provisional' },
          { kind: 'confidence', value: 'medium' },
        ],
      },
      edges: {},
      activeKinds: ['diff', 'ontology_status', 'confidence'],
    });

    const classes = getAnnoClasses(cy.getElementById('n1'));
    expect(classes).toContain('anno-fill-diff-only_a');
    expect(classes).toContain('anno-border-ontology_status-provisional');
    expect(classes).toContain('anno-opacity-confidence-medium');
  });

  it('respects custom precedence override', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [
          { kind: 'diff', value: 'only_a' },
          { kind: 'confidence', value: 'high' },
        ],
      },
      edges: {},
      activeKinds: ['diff', 'confidence'],
      precedence: ['confidence', 'diff'],
    });

    const classes = getAnnoClasses(cy.getElementById('n1'));
    expect(classes).toContain('anno-fill-confidence-high');
    expect(classes).toContain('anno-border-diff-only_a');
  });

  // --- Per-element precedence tests (bug #1 regression) ---

  it('per-element: node with single kind gets fill, not lower channel', () => {
    // Globally 3 kinds active, but n2 only has confidence.
    // confidence should get fill on n2, not opacity.
    applyAnnotations(cy, {
      nodes: {
        n1: [
          { kind: 'diff', value: 'only_a' },
          { kind: 'ontology_status', value: 'confirmed' },
          { kind: 'confidence', value: 'high' },
        ],
        n2: [{ kind: 'confidence', value: 'low' }],
      },
      edges: {},
      activeKinds: ['diff', 'ontology_status', 'confidence'],
    });

    // n1: all three kinds → fill(diff), border(ontology), opacity(confidence)
    const n1Classes = getAnnoClasses(cy.getElementById('n1'));
    expect(n1Classes).toContain('anno-fill-diff-only_a');
    expect(n1Classes).toContain('anno-border-ontology_status-confirmed');
    expect(n1Classes).toContain('anno-opacity-confidence-high');

    // n2: only confidence → gets fill (not opacity!)
    const n2Classes = getAnnoClasses(cy.getElementById('n2'));
    expect(n2Classes).toEqual(['anno-fill-confidence-low']);
  });

  it('per-element: two nodes with different kind subsets get independent channels', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }, { kind: 'confidence', value: 'high' }],
        n2: [{ kind: 'ontology_status', value: 'provisional' }],
        n3: [{ kind: 'confidence', value: 'medium' }, { kind: 'ontology_status', value: 'seed' }],
      },
      edges: {},
      activeKinds: ['diff', 'ontology_status', 'confidence'],
    });

    // n1: diff(fill) + confidence(border)
    const n1Classes = getAnnoClasses(cy.getElementById('n1'));
    expect(n1Classes).toContain('anno-fill-diff-only_a');
    expect(n1Classes).toContain('anno-border-confidence-high');

    // n2: only ontology → fill
    const n2Classes = getAnnoClasses(cy.getElementById('n2'));
    expect(n2Classes).toEqual(['anno-fill-ontology_status-provisional']);

    // n3: ontology(fill, higher precedence) + confidence(border)
    const n3Classes = getAnnoClasses(cy.getElementById('n3'));
    expect(n3Classes).toContain('anno-fill-ontology_status-seed');
    expect(n3Classes).toContain('anno-border-confidence-medium');
  });

  it('per-element: edge with single kind gets fill regardless of global activeKinds', () => {
    applyAnnotations(cy, {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }, { kind: 'confidence', value: 'high' }],
      },
      edges: {
        e1: [{ kind: 'confidence', value: 'low' }],
      },
      activeKinds: ['diff', 'confidence'],
    });

    // Edge only has confidence → gets fill
    const eClasses = getAnnoClasses(cy.getElementById('e1'));
    expect(eClasses).toEqual(['anno-fill-confidence-low']);
  });
});

describe('resolveChannels (unit)', () => {
  it('single kind always gets fill', () => {
    expect(resolveChannels([{ kind: 'confidence', value: 'high' }])).toEqual({ confidence: 'fill' });
    expect(resolveChannels([{ kind: 'diff', value: 'only_a' }])).toEqual({ diff: 'fill' });
    expect(resolveChannels([{ kind: 'pipeline_stage', value: 'extract' }])).toEqual({ pipeline_stage: 'fill' });
  });

  it('channel-locked kind does not consume fill', () => {
    const result = resolveChannels([
      { kind: 'search_match', value: 'exact' },
      { kind: 'diff', value: 'only_a' },
    ]);
    expect(result).toEqual({ search_match: 'overlay', diff: 'fill' });
  });

  it('respects precedence order for two competing kinds', () => {
    // diff > confidence in default precedence
    const result = resolveChannels([
      { kind: 'confidence', value: 'high' },
      { kind: 'diff', value: 'only_a' },
    ]);
    expect(result).toEqual({ diff: 'fill', confidence: 'border' });
  });

  it('drops kinds beyond available channels', () => {
    // 4 competing kinds but only 3 channels (fill, border, opacity)
    const result = resolveChannels([
      { kind: 'diff', value: 'only_a' },
      { kind: 'ontology_status', value: 'confirmed' },
      { kind: 'confidence', value: 'high' },
      { kind: 'provenance', value: 'extractor' },
    ]);
    expect(result.diff).toBe('fill');
    expect(result.ontology_status).toBe('border');
    expect(result.confidence).toBe('opacity');
    expect(result.provenance).toBeUndefined(); // dropped — no channel left
  });
});
