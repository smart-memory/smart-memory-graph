import { describe, it, expect } from 'vitest';
import { eventToGraphNode, eventToGraphEdge } from '../eventTransform';

describe('eventToGraphNode', () => {
  it('builds a GraphNode from event data', () => {
    const node = eventToGraphNode({ memory_id: 'n1', memory_type: 'semantic', label: 'Test' });
    expect(node.id).toBe('n1');
    expect(node.type).toBe('semantic');
    expect(node.category).toBe('memory');
    expect(node.label).toBe('Test');
  });

  it('classifies entity types correctly', () => {
    const node = eventToGraphNode({ memory_id: 'n2', entity_type: 'concept', label: 'AI' });
    expect(node.category).toBe('entity');
  });

  it('falls back to item_id and truncated content for label', () => {
    const node = eventToGraphNode({ item_id: 'abc123456789012345', content: 'Long content that exceeds forty characters for testing' });
    expect(node.id).toBe('abc123456789012345');
    expect(node.label).toBe('Long content that exceeds forty characte');
  });

  it('returns null for missing id', () => {
    expect(eventToGraphNode({ label: 'no id' })).toBeNull();
    expect(eventToGraphNode(null)).toBeNull();
  });

  it('skips version tracker and wikipedia grounding nodes', () => {
    expect(eventToGraphNode({ memory_id: 'version_abc' })).toBeNull();
    expect(eventToGraphNode({ memory_id: 'wikipedia:Marie_Curie' })).toBeNull();
  });
});

describe('eventToGraphEdge', () => {
  it('builds a GraphEdge from event data', () => {
    const edge = eventToGraphEdge({ source_id: 'a', target_id: 'b', edge_type: 'MENTIONS' });
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
    expect(edge.type).toBe('MENTIONS');
    expect(edge.id).toBe('a->b:MENTIONS');
  });

  it('defaults edge type to RELATES_TO', () => {
    const edge = eventToGraphEdge({ source_id: 'x', target_id: 'y' });
    expect(edge.type).toBe('RELATES_TO');
  });

  it('returns null for missing source or target', () => {
    expect(eventToGraphEdge({ source_id: 'a' })).toBeNull();
    expect(eventToGraphEdge({ target_id: 'b' })).toBeNull();
    expect(eventToGraphEdge(null)).toBeNull();
  });

  it('skips GROUNDED_IN edges', () => {
    expect(eventToGraphEdge({ source_id: 'a', target_id: 'b', edge_type: 'GROUNDED_IN' })).toBeNull();
  });

  it('skips edges involving wikipedia nodes', () => {
    expect(eventToGraphEdge({ source_id: 'wikipedia:X', target_id: 'b', edge_type: 'MENTIONS' })).toBeNull();
    expect(eventToGraphEdge({ source_id: 'a', target_id: 'wikipedia:Y', edge_type: 'MENTIONS' })).toBeNull();
  });
});
