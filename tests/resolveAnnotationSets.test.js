import { describe, it, expect } from 'vitest';
import { resolveAnnotationSets } from '../src/core/resolveAnnotationSets';

const graphData = {
  nodes: [{ id: 'n1' }, { id: 'n2' }],
  edges: [{ id: 'e1' }],
};

describe('resolveAnnotationSets', () => {
  it('handles null/empty input gracefully', () => {
    expect(resolveAnnotationSets(null, graphData)).toEqual({ nodes: {}, edges: {}, activeKinds: [] });
    expect(resolveAnnotationSets([], graphData)).toEqual({ nodes: {}, edges: {}, activeKinds: [] });
    expect(resolveAnnotationSets(undefined, graphData)).toEqual({ nodes: {}, edges: {}, activeKinds: [] });
  });

  it('passes through a single set unchanged', () => {
    const set = {
      annotations: {
        nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
        edges: { e1: [{ kind: 'diff', value: 'common' }] },
        activeKinds: ['diff'],
      },
    };

    const result = resolveAnnotationSets([set], graphData);
    expect(result.nodes.n1).toEqual([{ kind: 'diff', value: 'only_a' }]);
    expect(result.edges.e1).toEqual([{ kind: 'diff', value: 'common' }]);
    expect(result.activeKinds).toContain('diff');
  });

  it('merges two sets with different kinds', () => {
    const set1 = {
      annotations: {
        nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
        edges: {},
        activeKinds: ['diff'],
      },
    };
    const set2 = {
      annotations: {
        nodes: { n1: [{ kind: 'confidence', value: 'high' }] },
        edges: {},
        activeKinds: ['confidence'],
      },
    };

    const result = resolveAnnotationSets([set1, set2], graphData);
    expect(result.nodes.n1).toHaveLength(2);
    expect(result.nodes.n1).toContainEqual({ kind: 'diff', value: 'only_a' });
    expect(result.nodes.n1).toContainEqual({ kind: 'confidence', value: 'high' });
    expect(result.activeKinds).toContain('diff');
    expect(result.activeKinds).toContain('confidence');
  });

  it('last-write-wins for same (nodeId, kind)', () => {
    const set1 = {
      annotations: {
        nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
        edges: {},
        activeKinds: ['diff'],
      },
    };
    const set2 = {
      annotations: {
        nodes: { n1: [{ kind: 'diff', value: 'only_b' }] },
        edges: {},
        activeKinds: ['diff'],
      },
    };

    const result = resolveAnnotationSets([set1, set2], graphData);
    expect(result.nodes.n1).toHaveLength(1);
    expect(result.nodes.n1[0].value).toBe('only_b');
  });

  it('last-write-wins for same (edgeId, kind)', () => {
    const set1 = {
      annotations: {
        nodes: {},
        edges: { e1: [{ kind: 'diff', value: 'common' }] },
        activeKinds: ['diff'],
      },
    };
    const set2 = {
      annotations: {
        nodes: {},
        edges: { e1: [{ kind: 'diff', value: 'modified' }] },
        activeKinds: ['diff'],
      },
    };

    const result = resolveAnnotationSets([set1, set2], graphData);
    expect(result.edges.e1).toHaveLength(1);
    expect(result.edges.e1[0].value).toBe('modified');
  });

  it('activeKinds is union of all sets', () => {
    const set1 = { annotations: { nodes: {}, edges: {}, activeKinds: ['diff'] } };
    const set2 = { annotations: { nodes: {}, edges: {}, activeKinds: ['confidence', 'provenance'] } };

    const result = resolveAnnotationSets([set1, set2], graphData);
    expect(result.activeKinds).toEqual(expect.arrayContaining(['diff', 'confidence', 'provenance']));
    expect(result.activeKinds).toHaveLength(3);
  });

  it('passes through config.precedence', () => {
    const set = { annotations: { nodes: {}, edges: {}, activeKinds: ['diff'] } };
    const result = resolveAnnotationSets([set], graphData, { precedence: ['confidence', 'diff'] });
    expect(result.precedence).toEqual(['confidence', 'diff']);
  });

  it('skips sets with null annotations', () => {
    const set1 = { annotations: null };
    const set2 = {
      annotations: {
        nodes: { n1: [{ kind: 'diff', value: 'only_a' }] },
        edges: {},
        activeKinds: ['diff'],
      },
    };

    const result = resolveAnnotationSets([set1, set2], graphData);
    expect(result.nodes.n1).toEqual([{ kind: 'diff', value: 'only_a' }]);
  });
});
