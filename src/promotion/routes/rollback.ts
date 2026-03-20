import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db';
import { appendAudit } from '../../db';
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
  db: Database;
  store: SuspendableStore;
  onEddaNotify?: (memo: PromotionRollbackMemo) => Promise<void>;
  getHandoff?: (id: string) => unknown;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface RollbackEntry {
  memo: PromotionRollbackMemo;
  suspendResult: {
    type: SuspendableType;
    targetId: string;
    previousStatus: string;
    newStatus: 'suspended';
  };
}

function insertRollback(db: Database, entry: RollbackEntry): void {
  db.prepare(`
    INSERT INTO promotion_rollbacks (id, memo_json, suspend_result_json, version, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(
    entry.memo.id,
    JSON.stringify(entry.memo),
    JSON.stringify(entry.suspendResult),
    entry.memo.createdAt,
  );
}

function rowToEntry(row: Record<string, unknown>): RollbackEntry {
  const entry: RollbackEntry = {
    memo: JSON.parse(row['memo_json'] as string) as PromotionRollbackMemo,
    suspendResult: JSON.parse(row['suspend_result_json'] as string) as RollbackEntry['suspendResult'],
  };
  return entry;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/** fromLayer → SuspendableType */
function deriveSuspendableType(fromLayer: 'project-plan' | 'thyra-runtime'): SuspendableType {
  return fromLayer === 'project-plan' ? 'planning-pack' : 'runtime-world';
}

export function rollbackRoutes(deps: RollbackRouteDeps): Hono {
  const app = new Hono();

  // POST /api/promotion/rollbacks — build rollback memo + suspend downstream
  app.post('/api/promotion/rollbacks', async (c) => {
    const parsed = CreateRollbackInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const { targetId, ...rollbackInput } = parsed.data;

    // Verify handoff exists (if getHandoff provided)
    if (deps.getHandoff) {
      const handoff = deps.getHandoff(rollbackInput.originalHandoffId);
      if (!handoff) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: `Handoff not found: ${rollbackInput.originalHandoffId}` } },
          400,
        );
      }
    }

    // Build rollback memo
    const memo = createRollbackMemo(rollbackInput);

    // Suspend downstream artifact (PROMO-02: never delete)
    const suspendType = deriveSuspendableType(parsed.data.fromLayer);
    const suspendResult = markSuspended(suspendType, targetId, deps.store);

    // Persist to SQLite
    const entry: RollbackEntry = { memo, suspendResult };
    insertRollback(deps.db, entry);
    appendAudit(deps.db, 'promotion_rollback', memo.id, 'create', entry, 'system');

    // Fire-and-forget Edda notification (THY-06: graceful degradation)
    if (deps.onEddaNotify) {
      void deps.onEddaNotify(memo).catch(console.error);
    }

    return c.json({ ok: true, data: { memo, suspendResult } }, 201);
  });

  // GET /api/promotion/rollbacks — list all rollback memos
  app.get('/api/promotion/rollbacks', (c) => {
    const rows = deps.db.prepare('SELECT * FROM promotion_rollbacks ORDER BY created_at DESC').all() as Record<string, unknown>[];
    const data = rows.map(rowToEntry);
    return c.json({ ok: true, data });
  });

  // GET /api/promotion/rollbacks/:id — retrieve rollback memo by ID
  app.get('/api/promotion/rollbacks/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM promotion_rollbacks WHERE id = ?').get(c.req.param('id')) as Record<string, unknown> | null;
    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Rollback memo not found' } },
        404,
      );
    }
    return c.json({ ok: true, data: rowToEntry(row) });
  });

  return app;
}
