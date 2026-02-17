import { describe, it, expect } from 'vitest';
import { classifyEvent } from '../classifyEvent';

const makeEvent = (overrides = {}) => ({
  type: 'new_event',
  event_id: 'evt-1',
  timestamp: '2026-02-15T10:00:00Z',
  event_type: 'span',
  component: 'graph',
  operation: 'add_node',
  name: 'graph.add_node',
  data: { memory_id: 'node-1', label: 'Test Node' },
  trace_id: 'trace-1',
  span_id: 'span-1',
  duration_ms: 5,
  ...overrides,
});

describe('classifyEvent', () => {
  it('classifies graph/add_node as node_added', () => {
    const result = classifyEvent(makeEvent());
    expect(result).not.toBeNull();
    expect(result.category).toBe('node_added');
    expect(result.nodeId).toBe('node-1');
    expect(result.label).toContain('Test Node');
  });

  it('classifies graph/add_edge as edge_added', () => {
    const result = classifyEvent(makeEvent({
      operation: 'add_edge',
      name: 'graph.add_edge',
      data: { source_id: 'a', target_id: 'b', edge_type: 'RELATES_TO' },
    }));
    expect(result.category).toBe('edge_added');
    expect(result.nodeId).toBe('a');
  });

  it('classifies graph/add_edges_bulk as edge_added', () => {
    const result = classifyEvent(makeEvent({
      operation: 'add_edges_bulk',
      data: { source_id: 'x', target_id: 'y' },
    }));
    expect(result.category).toBe('edge_added');
  });

  it('classifies graph/delete_node as node_removed', () => {
    const result = classifyEvent(makeEvent({ operation: 'delete_node' }));
    expect(result.category).toBe('node_removed');
  });

  it('classifies pipeline events as pipeline_stage', () => {
    const result = classifyEvent(makeEvent({
      component: 'pipeline',
      operation: 'classify',
      name: 'pipeline.classify',
      data: { memory_id: 'mem-1' },
      duration_ms: 12,
    }));
    expect(result.category).toBe('pipeline_stage');
    expect(result.label).toContain('classify');
    expect(result.label).toContain('12ms');
  });

  it('classifies pipeline events by name prefix when component differs', () => {
    const result = classifyEvent(makeEvent({
      component: 'other',
      operation: 'extract',
      name: 'pipeline.extract',
    }));
    expect(result.category).toBe('pipeline_stage');
  });

  it('classifies memory/search as search_highlight', () => {
    const result = classifyEvent(makeEvent({
      component: 'memory',
      operation: 'search',
      name: 'memory.search',
      data: { query: 'AI ethics', result_count: 3, result_ids: ['a', 'b', 'c'] },
    }));
    expect(result.category).toBe('search_highlight');
    expect(result.matchIds).toEqual(['a', 'b', 'c']);
    expect(result.label).toContain('3 results');
  });

  it('classifies memory/ingest as ingest_started', () => {
    const result = classifyEvent(makeEvent({
      component: 'memory',
      operation: 'ingest',
      name: 'memory.ingest',
      data: { content: 'Some content here', memory_id: 'mem-2' },
    }));
    expect(result.category).toBe('ingest_started');
    expect(result.nodeId).toBe('mem-2');
  });

  it('returns null for system_health events (unknown component)', () => {
    const result = classifyEvent(makeEvent({
      component: 'system',
      operation: 'health_check',
      name: 'system.health_check',
    }));
    expect(result).toBeNull();
  });

  it('returns null for non new_event messages', () => {
    expect(classifyEvent({ type: 'connection_ack' })).toBeNull();
    expect(classifyEvent(null)).toBeNull();
    expect(classifyEvent(undefined)).toBeNull();
  });

  it('preserves traceId and meta from raw event', () => {
    const raw = makeEvent();
    const result = classifyEvent(raw);
    expect(result.traceId).toBe('trace-1');
    expect(result.meta).toBe(raw);
  });

  it('generates fallback timestamp when raw.timestamp is missing', () => {
    const result = classifyEvent(makeEvent({ timestamp: undefined }));
    expect(result.timestamp).toBeTruthy();
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('generates fallback id when event_id is missing', () => {
    const result = classifyEvent(makeEvent({ event_id: undefined }));
    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe('string');
    expect(result.id.startsWith('evt-')).toBe(true);
  });

  it('generates unique fallback ids for consecutive events', () => {
    const a = classifyEvent(makeEvent({ event_id: undefined }));
    const b = classifyEvent(makeEvent({ event_id: undefined }));
    expect(a.id).not.toBe(b.id);
  });

  describe('evolution lifecycle events (pipeline component)', () => {
    const EVOLUTION_OPS = [
      'evolution_cycle',
      'dream_phase',
      'opinion_synthesis',
      'observation_synthesis',
      'opinion_reinforcement',
    ];

    it.each(EVOLUTION_OPS)('%s classifies as pipeline_stage', (op) => {
      const result = classifyEvent(makeEvent({
        component: 'pipeline',
        operation: op,
        name: null,
        data: { workspace_id: 'ws-1', status: 'completed' },
        duration_ms: null,
      }));
      expect(result).not.toBeNull();
      expect(result.category).toBe('pipeline_stage');
    });

    it.each(EVOLUTION_OPS)('%s label normalizes underscores to spaces', (op) => {
      const result = classifyEvent(makeEvent({
        component: 'pipeline',
        operation: op,
        name: null,
        data: {},
        duration_ms: null,
      }));
      expect(result.label).toBe(`Pipeline: ${op.replace(/_/g, ' ')}`);
    });

    it('unknown pipeline ops also normalize underscores to spaces', () => {
      const result = classifyEvent(makeEvent({
        component: 'pipeline',
        operation: 'some_future_enricher',
        name: null,
        data: {},
        duration_ms: null,
      }));
      expect(result.category).toBe('pipeline_stage');
      expect(result.label).toBe('Pipeline: some future enricher');
    });
  });
});
