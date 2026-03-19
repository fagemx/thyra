import { describe, it, expect } from 'vitest';
import { generateId, extractPrefix, isValidIdFormat, ID_PREFIXES } from './id-generator';
import { validateSourceRef, validateIdPrefix, isValidLayer } from './validators';

describe('ID_PREFIXES', () => {
  it('has 21 prefixes', () => {
    expect(Object.keys(ID_PREFIXES)).toHaveLength(21);
  });

  it('all prefix values are lowercase strings', () => {
    for (const value of Object.values(ID_PREFIXES)) {
      expect(value).toMatch(/^[a-z]+$/);
    }
  });
});

describe('generateId', () => {
  it('generates ID with correct prefix format', () => {
    const id = generateId('ds');
    expect(id).toMatch(/^ds_[A-Za-z0-9_-]{12}$/);
  });

  it.each(Object.values(ID_PREFIXES))('generates valid ID for prefix "%s"', (prefix) => {
    const id = generateId(prefix);
    expect(id.startsWith(`${prefix}_`)).toBe(true);
    const rest = id.slice(prefix.length + 1);
    expect(rest).toHaveLength(12);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('ds')));
    expect(ids.size).toBe(100);
  });
});

describe('extractPrefix', () => {
  it('extracts prefix from valid ID', () => {
    expect(extractPrefix('ds_aBcDeFgHiJkL')).toBe('ds');
  });

  it('extracts multi-char prefix', () => {
    expect(extractPrefix('handoff_aBcDeFgHiJkL')).toBe('handoff');
  });

  it('extracts prefix from UUID-style ID (Völva format)', () => {
    expect(extractPrefix('ds_550e8400-e29b-41d4-a716-446655440000')).toBe('ds');
  });

  it('returns null for ID without underscore', () => {
    expect(extractPrefix('nounderscore')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractPrefix('')).toBeNull();
  });

  it('returns null for ID starting with underscore', () => {
    expect(extractPrefix('_abc')).toBeNull();
  });

  it('returns null for ID with numeric prefix', () => {
    expect(extractPrefix('123_abc')).toBeNull();
  });
});

describe('isValidIdFormat', () => {
  it('accepts Thyra nanoid format', () => {
    expect(isValidIdFormat('ds_aBcDeFgHiJkL')).toBe(true);
  });

  it('accepts Völva UUID format', () => {
    expect(isValidIdFormat('ds_550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects ID with empty random part', () => {
    expect(isValidIdFormat('ds_')).toBe(false);
  });

  it('rejects ID with short random part', () => {
    expect(isValidIdFormat('ds_abc')).toBe(false);
  });

  it('rejects ID without prefix', () => {
    expect(isValidIdFormat('_aBcDeFgHiJkL')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidIdFormat('')).toBe(false);
  });

  it('rejects ID with special characters in random part', () => {
    expect(isValidIdFormat('ds_!!!!!!!!!!!!'))  .toBe(false);
  });
});

describe('validateIdPrefix', () => {
  it.each(Object.values(ID_PREFIXES))('accepts known prefix "%s"', (prefix) => {
    const id = `${prefix}_aBcDeFgHiJkL`;
    expect(validateIdPrefix(id)).toBe(true);
  });

  it('rejects unknown prefix', () => {
    expect(validateIdPrefix('unknown_aBcDeFgHiJkL')).toBe(false);
  });

  it('rejects invalid format', () => {
    expect(validateIdPrefix('nounderscore')).toBe(false);
  });
});

describe('validateSourceRef', () => {
  it('returns ok for valid ref', () => {
    const result = validateSourceRef({ layer: 'L1', kind: 'decision-session', id: 'ds_abc123' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.layer).toBe('L1');
    }
  });

  it('returns error for invalid ref', () => {
    const result = validateSourceRef({ layer: 'INVALID', kind: 'test', id: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });
});

describe('isValidLayer', () => {
  it.each(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'])('accepts %s', (layer) => {
    expect(isValidLayer(layer)).toBe(true);
  });

  it.each(['L6', 'foo', '', 'l0'])('rejects %s', (layer) => {
    expect(isValidLayer(layer)).toBe(false);
  });
});
