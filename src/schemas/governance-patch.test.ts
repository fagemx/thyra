import { describe, it, expect } from 'vitest';
import { GovernancePatchSchema, createGovernancePatch } from './governance-patch';

describe('GovernancePatchSchema', () => {
  const validPatch = {
    version: 'governance.patch.v1' as const,
    event_id: 'evt_abc-123',
    occurred_at: '2026-03-12T00:00:00.000Z',
    source_village_id: 'village-001',
    patch_type: 'constitution_created' as const,
    payload: { constitution_id: 'const-xyz' },
  };

  it('validates a correct payload', () => {
    const result = GovernancePatchSchema.safeParse(validPatch);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('governance.patch.v1');
      expect(result.data.patch_type).toBe('constitution_created');
    }
  });

  it('accepts all valid patch_type values', () => {
    const types = [
      'constitution_created', 'constitution_superseded', 'constitution_revoked',
      'law_proposed', 'law_enacted', 'law_repealed',
    ] as const;
    for (const pt of types) {
      const result = GovernancePatchSchema.safeParse({ ...validPatch, patch_type: pt });
      expect(result.success).toBe(true);
    }
  });

  it('rejects missing version', () => {
    const { version: _, ...noVersion } = validPatch;
    const result = GovernancePatchSchema.safeParse(noVersion);
    expect(result.success).toBe(false);
  });

  it('rejects wrong version string', () => {
    const result = GovernancePatchSchema.safeParse({ ...validPatch, version: 'governance.patch.v2' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid patch_type', () => {
    const result = GovernancePatchSchema.safeParse({ ...validPatch, patch_type: 'invalid_type' });
    expect(result.success).toBe(false);
  });

  it('rejects event_id without evt_ prefix', () => {
    const result = GovernancePatchSchema.safeParse({ ...validPatch, event_id: 'no-prefix' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid occurred_at (non-ISO)', () => {
    const result = GovernancePatchSchema.safeParse({ ...validPatch, occurred_at: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('rejects empty source_village_id', () => {
    const result = GovernancePatchSchema.safeParse({ ...validPatch, source_village_id: '' });
    expect(result.success).toBe(false);
  });
});

describe('createGovernancePatch', () => {
  it('generates a valid patch with auto event_id and timestamp', () => {
    const patch = createGovernancePatch('village-001', 'law_enacted', { law_id: 'law-1' });
    const result = GovernancePatchSchema.safeParse(patch);
    expect(result.success).toBe(true);
  });

  it('event_id starts with evt_', () => {
    const patch = createGovernancePatch('village-001', 'constitution_created');
    expect(patch.event_id).toMatch(/^evt_/);
  });

  it('occurred_at is a valid ISO timestamp', () => {
    const patch = createGovernancePatch('village-001', 'law_proposed');
    expect(() => new Date(patch.occurred_at)).not.toThrow();
    expect(new Date(patch.occurred_at).toISOString()).toBe(patch.occurred_at);
  });

  it('version is governance.patch.v1', () => {
    const patch = createGovernancePatch('village-001', 'constitution_revoked');
    expect(patch.version).toBe('governance.patch.v1');
  });

  it('defaults payload to empty object', () => {
    const patch = createGovernancePatch('village-001', 'law_repealed');
    expect(patch.payload).toEqual({});
  });

  it('each call generates a unique event_id', () => {
    const a = createGovernancePatch('v1', 'law_enacted');
    const b = createGovernancePatch('v1', 'law_enacted');
    expect(a.event_id).not.toBe(b.event_id);
  });
});
