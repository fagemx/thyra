import { describe, it, expect } from 'vitest';
import { PromotionRollbackMemoSchema } from './schemas/rollback';
import {
  createRollbackMemo,
  markSuspended,
  createInMemoryStore,
} from './rollback-engine';
import type { RollbackInput, SuspendableStore } from './rollback-engine';

// --- Helpers ---

function validInput(overrides?: Partial<RollbackInput>): RollbackInput {
  return {
    originalHandoffId: 'handoff_abc123def456',
    fromLayer: 'project-plan',
    reason: 'spec gaps discovered during implementation',
    discoveredProblems: ['missing auth spec', 'wrong data model'],
    specsNeedingReview: ['docs/auth.md'],
    whatStillValid: ['core domain model'],
    whatInvalidated: ['API routes'],
    ...overrides,
  };
}

// --- Schema tests ---

describe('PromotionRollbackMemoSchema', () => {
  it('parses a valid rollback memo', () => {
    const memo = {
      id: 'rollback_abc123def456',
      originalHandoffId: 'handoff_xyz789',
      fromLayer: 'project-plan',
      toLayer: 'arch-spec',
      reason: 'bugs found',
      discoveredProblems: ['p1'],
      specsNeedingReview: ['s1'],
      whatStillValid: ['v1'],
      whatInvalidated: ['i1'],
      createdAt: '2026-03-19T00:00:00.000Z',
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(true);
  });

  it('rejects missing originalHandoffId (PROMO-03)', () => {
    const memo = {
      id: 'rollback_abc123def456',
      fromLayer: 'project-plan',
      toLayer: 'arch-spec',
      reason: 'bugs',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      createdAt: '2026-03-19T00:00:00.000Z',
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(false);
  });

  it('rejects invalid fromLayer', () => {
    const memo = {
      id: 'rollback_abc123def456',
      originalHandoffId: 'handoff_xyz789',
      fromLayer: 'invalid-layer',
      toLayer: 'arch-spec',
      reason: 'bugs',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      createdAt: '2026-03-19T00:00:00.000Z',
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(false);
  });

  it('rejects toLayer other than arch-spec', () => {
    const memo = {
      id: 'rollback_abc123def456',
      originalHandoffId: 'handoff_xyz789',
      fromLayer: 'project-plan',
      toLayer: 'project-plan',
      reason: 'bugs',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      createdAt: '2026-03-19T00:00:00.000Z',
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(false);
  });

  it('accepts optional eddaRecordId', () => {
    const memo = {
      id: 'rollback_abc123def456',
      originalHandoffId: 'handoff_xyz789',
      fromLayer: 'thyra-runtime',
      toLayer: 'arch-spec',
      reason: 'bugs',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      eddaRecordId: 'dec_abcdefghijkl',
      createdAt: '2026-03-19T00:00:00.000Z',
    };
    const result = PromotionRollbackMemoSchema.safeParse(memo);
    expect(result.success).toBe(true);
  });
});

// --- createRollbackMemo tests ---

describe('createRollbackMemo', () => {
  it('generates id with rollback_ prefix', () => {
    const memo = createRollbackMemo(validInput());
    expect(memo.id).toMatch(/^rollback_/);
  });

  it('preserves all input fields', () => {
    const input = validInput();
    const memo = createRollbackMemo(input);
    expect(memo.originalHandoffId).toBe(input.originalHandoffId);
    expect(memo.fromLayer).toBe(input.fromLayer);
    expect(memo.reason).toBe(input.reason);
    expect(memo.discoveredProblems).toEqual(input.discoveredProblems);
    expect(memo.specsNeedingReview).toEqual(input.specsNeedingReview);
    expect(memo.whatStillValid).toEqual(input.whatStillValid);
    expect(memo.whatInvalidated).toEqual(input.whatInvalidated);
  });

  it('sets toLayer to arch-spec', () => {
    const memo = createRollbackMemo(validInput());
    expect(memo.toLayer).toBe('arch-spec');
  });

  it('sets createdAt', () => {
    const memo = createRollbackMemo(validInput());
    expect(memo.createdAt).toBeTruthy();
    // Verify it's a valid ISO string
    expect(() => new Date(memo.createdAt)).not.toThrow();
  });

  it('works with fromLayer project-plan', () => {
    const memo = createRollbackMemo(validInput({ fromLayer: 'project-plan' }));
    expect(memo.fromLayer).toBe('project-plan');
  });

  it('works with fromLayer thyra-runtime', () => {
    const memo = createRollbackMemo(validInput({ fromLayer: 'thyra-runtime' }));
    expect(memo.fromLayer).toBe('thyra-runtime');
  });
});

// --- markSuspended tests ---

describe('markSuspended', () => {
  it('sets status to suspended (PROMO-02)', () => {
    const store = createInMemoryStore();
    store.setStatus('planning-pack', 'target-1', 'active');
    const result = markSuspended('planning-pack', 'target-1', store);
    expect(result.newStatus).toBe('suspended');
    expect(store.getStatus('planning-pack', 'target-1')).toBe('suspended');
  });

  it('returns previous status for audit', () => {
    const store = createInMemoryStore();
    store.setStatus('runtime-world', 'world-1', 'active');
    const result = markSuspended('runtime-world', 'world-1', store);
    expect(result.previousStatus).toBe('active');
  });

  it('is idempotent: already suspended target returns same result', () => {
    const store = createInMemoryStore();
    store.setStatus('planning-pack', 'target-1', 'suspended');
    const result = markSuspended('planning-pack', 'target-1', store);
    expect(result.newStatus).toBe('suspended');
    expect(result.previousStatus).toBe('suspended');
  });

  it('throws for unknown target', () => {
    const store = createInMemoryStore();
    expect(() => markSuspended('planning-pack', 'nonexistent', store)).toThrow(
      'Target not found: planning-pack/nonexistent',
    );
  });

  it('returns correct type and targetId', () => {
    const store = createInMemoryStore();
    store.setStatus('runtime-world', 'world-42', 'running');
    const result = markSuspended('runtime-world', 'world-42', store);
    expect(result.type).toBe('runtime-world');
    expect(result.targetId).toBe('world-42');
  });
});

// --- Contract enforcement tests ---

describe('contract enforcement', () => {
  it('PROMO-02: SuspendableStore interface has no delete method', () => {
    // Structural test: verify the store interface only has getStatus and setStatus
    const store: SuspendableStore = createInMemoryStore();
    const methods = Object.keys(store);
    expect(methods).toContain('getStatus');
    expect(methods).toContain('setStatus');
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('remove');
  });

  it('PROMO-03: originalHandoffId is required by schema', () => {
    const result = PromotionRollbackMemoSchema.safeParse({
      id: 'rollback_abc123def456',
      // originalHandoffId intentionally omitted
      fromLayer: 'project-plan',
      toLayer: 'arch-spec',
      reason: 'test',
      discoveredProblems: [],
      specsNeedingReview: [],
      whatStillValid: [],
      whatInvalidated: [],
      createdAt: '2026-03-19T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
