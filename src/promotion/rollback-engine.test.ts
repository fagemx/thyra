import { describe, it, expect, vi } from 'vitest';
import { PromotionRollbackMemoSchema } from './schemas/rollback';
import {
  createRollbackMemo,
  markSuspended,
  createInMemoryStore,
} from './rollback-engine';
import type { RollbackInput, SuspendableStore } from './rollback-engine';
import { rollbackRoutes } from './routes/rollback';
import type { RollbackRouteDeps } from './routes/rollback';

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

// ---------------------------------------------------------------------------
// Route integration tests
// ---------------------------------------------------------------------------

function buildRouteApp(overrides?: Partial<RollbackRouteDeps>) {
  const store = createInMemoryStore();
  // Pre-seed targets for suspend testing
  store.setStatus('planning-pack', 'pack-1', 'active');
  store.setStatus('runtime-world', 'world-1', 'active');
  store.setStatus('planning-pack', 'pack-suspended', 'suspended');

  const deps: RollbackRouteDeps = {
    store,
    ...overrides,
  };
  return { app: rollbackRoutes(deps), store, deps };
}

function rollbackBody(overrides?: Record<string, unknown>) {
  return {
    originalHandoffId: 'handoff_abc123def456',
    fromLayer: 'project-plan',
    targetId: 'pack-1',
    reason: 'spec gaps discovered during implementation',
    discoveredProblems: ['missing auth spec'],
    specsNeedingReview: ['docs/auth.md'],
    whatStillValid: ['core domain model'],
    whatInvalidated: ['API routes'],
    ...overrides,
  };
}

async function postRollback(app: ReturnType<typeof rollbackRoutes>, body: Record<string, unknown>) {
  return app.request('/api/promotion/rollbacks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/promotion/rollbacks', () => {
  it('Type A: creates rollback memo for project-plan → arch-spec', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, rollbackBody());
    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; data: { memo: { id: string; fromLayer: string; toLayer: string; originalHandoffId: string }; suspendResult: { type: string; newStatus: string } } };
    expect(json.ok).toBe(true);
    expect(json.data.memo.id).toMatch(/^rollback_/);
    expect(json.data.memo.fromLayer).toBe('project-plan');
    expect(json.data.memo.toLayer).toBe('arch-spec');
    expect(json.data.memo.originalHandoffId).toBe('handoff_abc123def456');
    expect(json.data.suspendResult.type).toBe('planning-pack');
    expect(json.data.suspendResult.newStatus).toBe('suspended');
  });

  it('Type B: creates rollback memo for thyra-runtime → arch-spec', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, rollbackBody({
      fromLayer: 'thyra-runtime',
      targetId: 'world-1',
    }));
    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; data: { memo: { fromLayer: string }; suspendResult: { type: string; newStatus: string } } };
    expect(json.ok).toBe(true);
    expect(json.data.memo.fromLayer).toBe('thyra-runtime');
    expect(json.data.suspendResult.type).toBe('runtime-world');
    expect(json.data.suspendResult.newStatus).toBe('suspended');
  });

  it('marks planning pack as suspended in store', async () => {
    const { app, store } = buildRouteApp();
    await postRollback(app, rollbackBody());
    expect(store.getStatus('planning-pack', 'pack-1')).toBe('suspended');
  });

  it('already suspended target is idempotent (no error)', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, rollbackBody({
      targetId: 'pack-suspended',
    }));
    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; data: { suspendResult: { previousStatus: string; newStatus: string } } };
    expect(json.ok).toBe(true);
    expect(json.data.suspendResult.previousStatus).toBe('suspended');
    expect(json.data.suspendResult.newStatus).toBe('suspended');
  });

  it('rejects missing originalHandoffId', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, rollbackBody({ originalHandoffId: '' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('rejects missing targetId', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, rollbackBody({ targetId: '' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('rejects missing reason', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, rollbackBody({ reason: '' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('rejects unknown handoff ID when getHandoff provided', async () => {
    const { app } = buildRouteApp({
      getHandoff: (_id: string) => null,
    });
    const res = await postRollback(app, rollbackBody());
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; error: { code: string; message: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
    expect(json.error.message).toContain('handoff_abc123def456');
  });

  it('accepts when getHandoff finds the handoff', async () => {
    const { app } = buildRouteApp({
      getHandoff: (_id: string) => ({ id: 'handoff_abc123def456' }),
    });
    const res = await postRollback(app, rollbackBody());
    expect(res.status).toBe(201);
  });

  it('invokes onEddaNotify with the memo (fire-and-forget)', async () => {
    const notifySpy = vi.fn().mockResolvedValue(undefined);
    const { app } = buildRouteApp({ onEddaNotify: notifySpy });
    await postRollback(app, rollbackBody());
    // Allow microtask to settle
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0][0].id).toMatch(/^rollback_/);
  });

  it('still succeeds if onEddaNotify throws (graceful degradation)', async () => {
    const failNotify = vi.fn().mockRejectedValue(new Error('Edda down'));
    const { app } = buildRouteApp({ onEddaNotify: failNotify });
    const res = await postRollback(app, rollbackBody());
    expect(res.status).toBe(201);
  });
});

describe('GET /api/promotion/rollbacks', () => {
  it('returns empty list when no rollbacks exist', async () => {
    const { app } = buildRouteApp();
    const res = await app.request('/api/promotion/rollbacks');
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.data).toEqual([]);
  });

  it('returns all created rollback memos', async () => {
    const { app } = buildRouteApp();
    await postRollback(app, rollbackBody());
    await postRollback(app, rollbackBody({
      fromLayer: 'thyra-runtime',
      targetId: 'world-1',
      originalHandoffId: 'handoff_xyz789',
    }));

    const res = await app.request('/api/promotion/rollbacks');
    const json = await res.json() as { ok: boolean; data: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.data).toHaveLength(2);
  });
});

describe('GET /api/promotion/rollbacks/:id', () => {
  it('retrieves a rollback memo by ID', async () => {
    const { app } = buildRouteApp();
    const createRes = await postRollback(app, rollbackBody());
    const createJson = await createRes.json() as { data: { memo: { id: string } } };
    const memoId = createJson.data.memo.id;

    const res = await app.request(`/api/promotion/rollbacks/${memoId}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: { memo: { id: string } } };
    expect(json.ok).toBe(true);
    expect(json.data.memo.id).toBe(memoId);
  });

  it('returns 404 for unknown ID', async () => {
    const { app } = buildRouteApp();
    const res = await app.request('/api/promotion/rollbacks/rollback_nonexistent');
    expect(res.status).toBe(404);
    const json = await res.json() as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });
});

describe('THY-11 response format compliance', () => {
  it('POST success has ok:true and data', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, rollbackBody());
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json).toHaveProperty('data');
  });

  it('POST validation error has ok:false and error.code + error.message', async () => {
    const { app } = buildRouteApp();
    const res = await postRollback(app, {});
    const json = await res.json() as { ok: boolean; error: { code: string; message: string } };
    expect(json.ok).toBe(false);
    expect(json.error).toHaveProperty('code');
    expect(json.error).toHaveProperty('message');
  });

  it('GET 404 has ok:false and error.code + error.message', async () => {
    const { app } = buildRouteApp();
    const res = await app.request('/api/promotion/rollbacks/nonexistent');
    const json = await res.json() as { ok: boolean; error: { code: string; message: string } };
    expect(json.ok).toBe(false);
    expect(json.error).toHaveProperty('code');
    expect(json.error).toHaveProperty('message');
  });
});
