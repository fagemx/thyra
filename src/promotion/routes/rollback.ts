import { Hono } from 'hono';
import { z } from 'zod';
import { createRollbackMemo, markSuspended } from '../rollback-engine';
import type { SuspendableStore, SuspendableType } from '../rollback-engine';
import type { PromotionRollbackMemo } from '../schemas/rollback';

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const CreateRollbackInput = z.object({
  originalHandoffId: z.string().min(1),
  fromLayer: z.enum(['project-plan', 'thyra-runtime']),
  targetId: z.string().min(1),
  reason: z.string().min(1),
  discoveredProblems: z.array(z.string()),
  specsNeedingReview: z.array(z.string()),
  whatStillValid: z.array(z.string()),
  whatInvalidated: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface RollbackRouteDeps {
  store: SuspendableStore;
  onEddaNotify?: (memo: PromotionRollbackMemo) => Promise<void>;
  getHandoff?: (id: string) => unknown | null;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/** fromLayer → SuspendableType 對應 */
function deriveSuspendableType(fromLayer: 'project-plan' | 'thyra-runtime'): SuspendableType {
  return fromLayer === 'project-plan' ? 'planning-pack' : 'runtime-world';
}

export function rollbackRoutes(deps: RollbackRouteDeps): Hono {
  const app = new Hono();
  const memos = new Map<string, { memo: PromotionRollbackMemo; suspendResult: { type: SuspendableType; targetId: string; previousStatus: string; newStatus: 'suspended' } }>();

  // POST /api/promotion/rollbacks — 建立 rollback memo + suspend downstream
  app.post('/api/promotion/rollbacks', async (c) => {
    const parsed = CreateRollbackInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const { targetId, ...rollbackInput } = parsed.data;

    // 驗證 handoff 存在（若提供 getHandoff）
    if (deps.getHandoff) {
      const handoff = deps.getHandoff(rollbackInput.originalHandoffId);
      if (!handoff) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: `Handoff not found: ${rollbackInput.originalHandoffId}` } },
          400,
        );
      }
    }

    // 建立 rollback memo
    const memo = createRollbackMemo(rollbackInput);

    // Suspend downstream artifact (PROMO-02: never delete)
    const suspendType = deriveSuspendableType(parsed.data.fromLayer);
    const suspendResult = markSuspended(suspendType, targetId, deps.store);

    // 儲存到 in-memory store
    memos.set(memo.id, { memo, suspendResult });

    // Fire-and-forget Edda notification (THY-06: graceful degradation)
    if (deps.onEddaNotify) {
      void deps.onEddaNotify(memo).catch(console.error);
    }

    return c.json({ ok: true, data: { memo, suspendResult } }, 201);
  });

  // GET /api/promotion/rollbacks — list all rollback memos
  app.get('/api/promotion/rollbacks', (c) => {
    const data = Array.from(memos.values());
    return c.json({ ok: true, data });
  });

  // GET /api/promotion/rollbacks/:id — retrieve rollback memo by ID
  app.get('/api/promotion/rollbacks/:id', (c) => {
    const entry = memos.get(c.req.param('id'));
    if (!entry) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Rollback memo not found' } },
        404,
      );
    }
    return c.json({ ok: true, data: entry });
  });

  return app;
}
