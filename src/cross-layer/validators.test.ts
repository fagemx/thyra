import { describe, it, expect } from 'vitest';
import { validateSourceRef, validateIdPrefix, isValidLayer } from './validators';
import { ID_PREFIXES } from './id-generator';

describe('validateSourceRef', () => {
  it('returns ok for valid L0 conversation ref', () => {
    const result = validateSourceRef({ layer: 'L0', kind: 'conversation', id: 'user-message-123' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ layer: 'L0', kind: 'conversation', id: 'user-message-123' });
    }
  });

  it('returns ok for valid L1 decision-session ref', () => {
    const result = validateSourceRef({ layer: 'L1', kind: 'decision-session', id: 'ds_aBcDeFgHiJkL' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.layer).toBe('L1');
      expect(result.data.kind).toBe('decision-session');
    }
  });

  it('returns ok for L2 spec:// URI format', () => {
    const result = validateSourceRef({ layer: 'L2', kind: 'spec-file', id: 'spec://thyra/cross-layer-ids-v0' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('spec://thyra/cross-layer-ids-v0');
    }
  });

  it('returns ok for L3 world ref', () => {
    const result = validateSourceRef({ layer: 'L3', kind: 'world', id: 'world_abc123' });
    expect(result.ok).toBe(true);
  });

  it('returns ok for L4 governance ref', () => {
    const result = validateSourceRef({ layer: 'L4', kind: 'governance', id: 'gov_rule_001' });
    expect(result.ok).toBe(true);
  });

  it('returns ok for L5 precedent ref', () => {
    const result = validateSourceRef({ layer: 'L5', kind: 'precedent', id: 'prec_aBcDeFgHiJkL' });
    expect(result.ok).toBe(true);
  });

  it('preserves optional note field', () => {
    const result = validateSourceRef({ layer: 'L1', kind: 'card', id: 'card_abc123xyz0', note: 'test note' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.note).toBe('test note');
    }
  });

  it('returns ok when note is omitted', () => {
    const result = validateSourceRef({ layer: 'L1', kind: 'card', id: 'card_abc123xyz0' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.note).toBeUndefined();
    }
  });

  it('returns error for invalid layer', () => {
    const result = validateSourceRef({ layer: 'L9', kind: 'test', id: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it('returns error for missing layer', () => {
    const result = validateSourceRef({ kind: 'test', id: 'abc' });
    expect(result.ok).toBe(false);
  });

  it('returns error for missing kind', () => {
    const result = validateSourceRef({ layer: 'L0', id: 'abc' });
    expect(result.ok).toBe(false);
  });

  it('returns error for missing id', () => {
    const result = validateSourceRef({ layer: 'L0', kind: 'conversation' });
    expect(result.ok).toBe(false);
  });

  it('returns error for empty kind', () => {
    const result = validateSourceRef({ layer: 'L0', kind: '', id: 'abc' });
    expect(result.ok).toBe(false);
  });

  it('returns error for empty id', () => {
    const result = validateSourceRef({ layer: 'L0', kind: 'conversation', id: '' });
    expect(result.ok).toBe(false);
  });

  it('returns error for null input', () => {
    const result = validateSourceRef(null);
    expect(result.ok).toBe(false);
  });

  it('returns error for undefined input', () => {
    const result = validateSourceRef(undefined);
    expect(result.ok).toBe(false);
  });

  it('returns error for string input', () => {
    const result = validateSourceRef('not-an-object');
    expect(result.ok).toBe(false);
  });

  it('returns error for numeric layer', () => {
    const result = validateSourceRef({ layer: 0, kind: 'test', id: 'abc' });
    expect(result.ok).toBe(false);
  });
});

describe('validateIdPrefix', () => {
  it.each(Object.entries(ID_PREFIXES))('accepts known prefix for %s ("%s")', (_key, prefix) => {
    const id = `${prefix}_aBcDeFgHiJkL`;
    expect(validateIdPrefix(id)).toBe(true);
  });

  it('rejects unknown prefix', () => {
    expect(validateIdPrefix('unknown_aBcDeFgHiJkL')).toBe(false);
  });

  it('rejects ID without underscore', () => {
    expect(validateIdPrefix('nounderscore')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateIdPrefix('')).toBe(false);
  });

  it('rejects ID starting with underscore', () => {
    expect(validateIdPrefix('_abc123')).toBe(false);
  });

  it('rejects ID with numeric prefix', () => {
    expect(validateIdPrefix('123_abc')).toBe(false);
  });

  it('accepts known prefix with Volva UUID format', () => {
    expect(validateIdPrefix('ds_550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
});

describe('isValidLayer', () => {
  it.each(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'])('accepts valid layer %s', (layer) => {
    expect(isValidLayer(layer)).toBe(true);
  });

  it.each(['L6', 'L7', 'foo', '', 'l0', 'l1', 'layer0', 'L-1'])('rejects invalid layer "%s"', (layer) => {
    expect(isValidLayer(layer)).toBe(false);
  });
});
