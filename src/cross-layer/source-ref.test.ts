import { describe, it, expect } from 'vitest';
import { SourceRefSchema, LayerSchema } from './source-ref';

describe('LayerSchema', () => {
  const validLayers = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;

  it.each(validLayers)('accepts valid layer %s', (layer) => {
    const result = LayerSchema.safeParse(layer);
    expect(result.success).toBe(true);
  });

  it.each(['L6', 'L7', 'foo', '', 'l0', 'l1'])('rejects invalid layer %s', (layer) => {
    const result = LayerSchema.safeParse(layer);
    expect(result.success).toBe(false);
  });
});

describe('SourceRefSchema', () => {
  it('accepts a valid L0 SourceRef', () => {
    const ref = { layer: 'L0', kind: 'conversation', id: 'user-message-123' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.layer).toBe('L0');
      expect(result.data.kind).toBe('conversation');
      expect(result.data.id).toBe('user-message-123');
      expect(result.data.note).toBeUndefined();
    }
  });

  it('accepts a valid L1 SourceRef with note', () => {
    const ref = { layer: 'L1', kind: 'decision-session', id: 'ds_aBcDeFgHiJkL', note: 'initial session' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe('initial session');
    }
  });

  it('accepts L2 spec:// URI format', () => {
    const ref = { layer: 'L2', kind: 'spec-file', id: 'spec://thyra/cross-layer-ids-v0' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(true);
  });

  it('accepts L3 SourceRef', () => {
    const ref = { layer: 'L3', kind: 'world', id: 'world_abc123' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(true);
  });

  it('accepts L4 SourceRef', () => {
    const ref = { layer: 'L4', kind: 'governance', id: 'gov_rule_001' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(true);
  });

  it('accepts L5 SourceRef', () => {
    const ref = { layer: 'L5', kind: 'precedent', id: 'prec_aBcDeFgHiJkL' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(true);
  });

  it('rejects missing layer', () => {
    const ref = { kind: 'conversation', id: 'abc' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(false);
  });

  it('rejects missing kind', () => {
    const ref = { layer: 'L0', id: 'abc' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const ref = { layer: 'L0', kind: 'conversation' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(false);
  });

  it('rejects invalid layer value', () => {
    const ref = { layer: 'L9', kind: 'conversation', id: 'abc' };
    const result = SourceRefSchema.safeParse(ref);
    expect(result.success).toBe(false);
  });
});
