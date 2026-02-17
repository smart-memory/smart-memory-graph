import { describe, it, expect } from 'vitest';
import { buildAnnotationLegend } from '../src/core/annotationLegend';

const graphData = {
  nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'n4' }, { id: 'n5' }],
  edges: [{ id: 'e1' }],
};

describe('buildAnnotationLegend', () => {
  it('returns empty array when annotations have no activeKinds', () => {
    expect(buildAnnotationLegend(graphData, null)).toEqual([]);
    expect(buildAnnotationLegend(graphData, { activeKinds: [] })).toEqual([]);
    expect(buildAnnotationLegend(graphData, undefined)).toEqual([]);
  });

  it('counts node annotations correctly', () => {
    const annotations = {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }],
        n2: [{ kind: 'diff', value: 'only_a' }],
        n3: [{ kind: 'diff', value: 'only_b' }],
        n4: [{ kind: 'diff', value: 'only_b' }],
        n5: [{ kind: 'diff', value: 'only_b' }],
      },
      edges: {},
      activeKinds: ['diff'],
    };

    const items = buildAnnotationLegend(graphData, annotations);
    expect(items).toHaveLength(2);

    const onlyA = items.find((i) => i.key === 'only_a');
    expect(onlyA.count).toBe(2);
    expect(onlyA.kind).toBe('diff');
    expect(onlyA.label).toBe('Only in A');
    expect(onlyA.color).toBe('#ef4444');
    expect(onlyA.styleToken).toBe('anno-fill-diff-only_a');

    const onlyB = items.find((i) => i.key === 'only_b');
    expect(onlyB.count).toBe(3);
    expect(onlyB.color).toBe('#22c55e');
  });

  it('counts edge annotations alongside nodes', () => {
    const annotations = {
      nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
      edges: { e1: [{ kind: 'diff', value: 'only_a' }] },
      activeKinds: ['diff'],
    };

    const items = buildAnnotationLegend(graphData, annotations);
    const onlyA = items.find((i) => i.key === 'only_a');
    expect(onlyA.count).toBe(2);
  });

  it('excludes zero-count items by default', () => {
    const annotations = {
      nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
      edges: {},
      activeKinds: ['diff'],
    };

    const items = buildAnnotationLegend(graphData, annotations);
    // diff has 4 values but only only_a has annotations
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('only_a');
  });

  it('includes zero-count items when showEmpty is true', () => {
    const annotations = {
      nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
      edges: {},
      activeKinds: ['diff'],
    };

    const items = buildAnnotationLegend(graphData, annotations, { showEmpty: true });
    // diff has 4 values: only_a, only_b, common, modified
    expect(items).toHaveLength(4);
    expect(items.find((i) => i.key === 'only_b').count).toBe(0);
  });

  it('filters by visibleIds when provided', () => {
    const annotations = {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }],
        n2: [{ kind: 'diff', value: 'only_a' }],
        n3: [{ kind: 'diff', value: 'only_b' }],
      },
      edges: {},
      activeKinds: ['diff'],
    };

    const visibleIds = new Set(['n1', 'n3']);
    const items = buildAnnotationLegend(graphData, annotations, { visibleIds });
    expect(items.find((i) => i.key === 'only_a').count).toBe(1); // n1 only
    expect(items.find((i) => i.key === 'only_b').count).toBe(1);
  });

  it('filters by specific kinds', () => {
    const annotations = {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_a' }, { kind: 'confidence', value: 'high' }],
      },
      edges: {},
      activeKinds: ['diff', 'confidence'],
    };

    const items = buildAnnotationLegend(graphData, annotations, { kinds: ['confidence'] });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('confidence');
  });

  it('handles search_match color objects', () => {
    const annotations = {
      nodes: { n1: [{ kind: 'search_match', value: 'exact' }] },
      edges: {},
      activeKinds: ['search_match'],
    };

    const items = buildAnnotationLegend(graphData, annotations);
    expect(items).toHaveLength(1);
    // search_match exact has an object color — should extract .color
    expect(items[0].color).toBe('#fbbf24');
  });

  it('orders items by kind then value', () => {
    const annotations = {
      nodes: {
        n1: [{ kind: 'diff', value: 'only_b' }, { kind: 'confidence', value: 'low' }],
        n2: [{ kind: 'diff', value: 'only_a' }],
      },
      edges: {},
      activeKinds: ['diff', 'confidence'],
    };

    const items = buildAnnotationLegend(graphData, annotations);
    // diff items first (only_a, only_b per contract value order), then confidence (low)
    const kinds = items.map((i) => i.kind);
    const diffIdx = kinds.indexOf('diff');
    const confIdx = kinds.indexOf('confidence');
    expect(diffIdx).toBeLessThan(confIdx);
  });
});
