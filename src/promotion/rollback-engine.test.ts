import { describe, it, expect } from 'vitest';
import { PromotionRollbackMemoSchema } from './schemas/rollback';
import { createRollbackMemo, markSuspended } from './rollback-engine';
import type { RollbackInput, SuspendableDb } from './rollback-engine';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRollbackInput(overrides?: Partial<RollbackInput>): RollbackInput {
  return {
    originalHandoffId: 'handoff_aBcDeFgHiJkL',
    fromLayer: 'project-plan',
    reason: 'Canonical form changed after promotion',
    discoveredProblems: ['naming conflict in Merchant model'],
    specsNeedingReview: ['docs/spec/merchant.md'],
    whatStillValid: ['core market cycle', 'stall assignment'],
    whatInvalidated: ['merchant pricing model'],
    ...overrides,
  };
}

function makeFakeDb(records: Record<string, { status: string }>): SuspendableDb {
  return {
    get(targetId: string) {
      return records[targetId];
    },
    setStatus(targetId: string, status: string) {
      const record = records[targetId];
      if (record) {
        record.status = status;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('PromotionRollbackMemoSchema', () => {
  it('validates a complete rollback memo', () => {
    const memo = {
      id: 'rollback_aBcDeFgHiJkL',
      originalHandoffId: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'project-plan',
      toLayer: 'arch-spec',
      reason: 'Canonical form changed',
      discoveredProblems: ['naming conflict'],
      specsNeedingReview: ['docs/spec/merchant.md'],
      whatStillValid: ['core market cycle'],
      whatInvalidated: ['pricing model'],
      createdAt: new Date().toISOString(),
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(true);
  });

  it('accepts optional eddaRecordId', () => {
    const memo = {
      id: 'rollback_aBcDeFgHiJkL',
      originalHandoffId: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'project-plan',
      toLayer: 'arch-spec',
      reason: 'reason',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      eddaRecordId: 'dec_xyzXYZ123456',
      createdAt: new Date().toISOString(),
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(true);
  });

  it('rejects missing originalHandoffId (CONTRACT PROMO-03)', () => {
    const memo = {
      id: 'rollback_aBcDeFgHiJkL',
      fromLayer: 'project-plan',
      toLayer: 'arch-spec',
      reason: 'reason',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      createdAt: new Date().toISOString(),
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(false);
  });

  it('rejects invalid fromLayer', () => {
    const memo = {
      id: 'rollback_aBcDeFgHiJkL',
      originalHandoffId: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'arch-spec',
      toLayer: 'arch-spec',
      reason: 'reason',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      createdAt: new Date().toISOString(),
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(false);
  });

  it('rejects toLayer other than arch-spec', () => {
    const memo = {
      id: 'rollback_aBcDeFgHiJkL',
      originalHandoffId: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'project-plan',
      toLayer: 'project-plan',
      reason: 'reason',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      createdAt: new Date().toISOString(),
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(false);
  });

  it('accepts both fromLayer values', () => {
    for (const fromLayer of ['project-plan', 'thyra-runtime'] as const) {
      const memo = {
        id: 'rollback_aBcDeFgHiJkL',
        originalHandoffId: 'handoff_aBcDeFgHiJkL',
        fromLayer,
        toLayer: 'arch-spec',
        reason: 'reason',
        discoveredProblems: [],
        specsNeedingReview: [],
        whatStillValid: [],
        whatInvalidated: [],
        createdAt: new Date().toISOString(),
      };
      const result = PromotionRollbackMemoSchema.safeParse(memo);
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// createRollbackMemo tests
// ---------------------------------------------------------------------------

describe('createRollbackMemo', () => {
  it('produces a valid memo with rollback_ prefix', () => {
    const input = makeRollbackInput();
    const memo = createRollbackMemo(input);

    expect(memo.id).toMatch(/^rollback_/);
    expect(memo.toLayer).toBe('arch-spec');
    expect(memo.createdAt).toBeTruthy();

    // Round-trip validation
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(true);
  });

  it('always sets toLayer to arch-spec', () => {
    const memo = createRollbackMemo(makeRollbackInput({ fromLayer: 'thyra-runtime' }));
    expect(memo.toLayer).toBe('arch-spec');
  });

  it('preserves originalHandoffId (CONTRACT PROMO-03)', () => {
    const input = makeRollbackInput({ originalHandoffId: 'handoff_specificId1' });
    const memo = createRollbackMemo(input);
    expect(memo.originalHandoffId).toBe('handoff_specificId1');
  });

  it('generates unique IDs', () => {
    const input = makeRollbackInput();
    const ids = new Set(
      Array.from({ length: 20 }, () => createRollbackMemo(input).id),
    );
    expect(ids.size).toBe(20);
  });

  it('sets createdAt to a valid ISO string', () => {
    const memo = createRollbackMemo(makeRollbackInput());
    const parsed = new Date(memo.createdAt);
    expect(parsed.toISOString()).toBe(memo.createdAt);
  });

  it('preserves all input fields', () => {
    const input = makeRollbackInput();
    const memo = createRollbackMemo(input);

    expect(memo.fromLayer).toBe(input.fromLayer);
    expect(memo.reason).toBe(input.reason);
    expect(memo.discoveredProblems).toEqual(input.discoveredProblems);
    expect(memo.specsNeedingReview).toEqual(input.specsNeedingReview);
    expect(memo.whatStillValid).toEqual(input.whatStillValid);
    expect(memo.whatInvalidated).toEqual(input.whatInvalidated);
  });

  it('works with thyra-runtime fromLayer (Type B rollback)', () => {
    const input = makeRollbackInput({ fromLayer: 'thyra-runtime' });
    const memo = createRollbackMemo(input);

    expect(memo.fromLayer).toBe('thyra-runtime');
    expect(memo.toLayer).toBe('arch-spec');
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markSuspended tests
// ---------------------------------------------------------------------------

describe('markSuspended', () => {
  it('sets status to suspended for planning-pack (CONTRACT PROMO-02)', () => {
    const db = makeFakeDb({ 'pack_001': { status: 'active' } });
    const result = markSuspended('planning-pack', 'pack_001', db);

    expect(result.type).toBe('planning-pack');
    expect(result.targetId).toBe('pack_001');
    expect(result.previousStatus).toBe('active');
    expect(result.newStatus).toBe('suspended');
  });

  it('sets status to suspended for runtime-world', () => {
    const db = makeFakeDb({ 'world_001': { status: 'running' } });
    const result = markSuspended('runtime-world', 'world_001', db);

    expect(result.type).toBe('runtime-world');
    expect(result.previousStatus).toBe('running');
    expect(result.newStatus).toBe('suspended');
  });

  it('actually updates the db record', () => {
    const records = { 'pack_002': { status: 'active' } };
    const db = makeFakeDb(records);
    markSuspended('planning-pack', 'pack_002', db);

    expect(records['pack_002'].status).toBe('suspended');
  });

  it('throws if target not found', () => {
    const db = makeFakeDb({});
    expect(() => markSuspended('planning-pack', 'nonexistent', db)).toThrow(
      'planning-pack with id "nonexistent" not found',
    );
  });

  it('is idempotent when already suspended', () => {
    const db = makeFakeDb({ 'pack_003': { status: 'suspended' } });
    const result = markSuspended('planning-pack', 'pack_003', db);

    expect(result.previousStatus).toBe('suspended');
    expect(result.newStatus).toBe('suspended');
  });

  it('never deletes — only sets suspended (CONTRACT PROMO-02)', () => {
    const records = { 'world_002': { status: 'active' } };
    const db = makeFakeDb(records);
    markSuspended('runtime-world', 'world_002', db);

    // Record still exists after markSuspended
    expect(records['world_002']).toBeDefined();
    expect(records['world_002'].status).toBe('suspended');
  });
});
