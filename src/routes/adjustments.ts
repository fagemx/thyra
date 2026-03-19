/**
 * routes/adjustments.ts — Governance adjustment API routes
 *
 * POST /api/worlds/:worldId/adjustments — 評估 OutcomeReport 並建立調整
 * GET  /api/worlds/:worldId/adjustments — 列出世界的治理調整記錄
 *
 * CONTRACT: THY-11 — 統一回應格式 { ok, data/error }
 * CONTRACT: THY-07 — 寫 audit_log
 * CONTRACT: ADJ-01 — target + before/after 必填
 * CONTRACT: ADJ-02 — 只在 harmful / rollback / retune 時觸發
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../db';
import { appendAudit } from '../db';
import { OutcomeReportSchema } from '../schemas/outcome-report';
import { GovernanceAdjustmentSchema, type GovernanceAdjustment } from '../schemas/governance-adjustment';
import { evaluateOutcomeForAdjustment } from '../canonical-cycle/governance-adjuster';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const EvaluateInput = z.object({
  report: OutcomeReportSchema,
});

const ListQuery = z.object({
  status: z.enum(['proposed', 'approved', 'applied', 'rejected']).optional(),
  adjustmentType: z.enum([
    'law_threshold', 'chief_permission', 'chief_style', 'risk_policy', 'simulation_policy',
  ]).optional(),
});

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface AdjustmentRow {
  id: string;
  world_id: string;
  triggered_by: string;
  adjustment_type: string;
  target: string;
  before_val: string;
  after_val: string;
  rationale: string;
  status: string;
  version: number;
  created_at: string;
}

function rowToAdjustment(row: AdjustmentRow): GovernanceAdjustment {
  return GovernanceAdjustmentSchema.parse({
    id: row.id,
    worldId: row.world_id,
    triggeredBy: row.triggered_by,
    adjustmentType: row.adjustment_type,
    target: row.target,
    before: row.before_val,
    after: row.after_val,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.created_at,
    version: row.version,
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function adjustmentRoutes(db: Database): Hono {
  const app = new Hono();

  const base = '/api/worlds/:worldId/adjustments';

  // POST — 評估 OutcomeReport 並建立調整（如需要）
  app.post(base, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = EvaluateInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const worldId = c.req.param('worldId');
    const adjustment = evaluateOutcomeForAdjustment(parsed.data.report, worldId);

    if (!adjustment) {
      return c.json({ ok: true, data: { adjustment: null, triggered: false } });
    }

    // Persist to DB
    db.prepare(`
      INSERT INTO governance_adjustments (
        id, world_id, triggered_by, adjustment_type, target,
        before_val, after_val, rationale, status, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adjustment.id,
      adjustment.worldId,
      adjustment.triggeredBy,
      adjustment.adjustmentType,
      adjustment.target,
      adjustment.before,
      adjustment.after,
      adjustment.rationale,
      adjustment.status,
      adjustment.version,
      adjustment.createdAt,
    );

    // THY-07: audit log
    appendAudit(db, 'governance_adjustment', adjustment.id, 'created', adjustment, 'system');

    return c.json({ ok: true, data: { adjustment, triggered: true } });
  });

  // GET — 列出世界的治理調整記錄
  app.get(base, (c) => {
    const worldId = c.req.param('worldId');
    const query = ListQuery.safeParse({
      status: c.req.query('status'),
      adjustmentType: c.req.query('adjustmentType'),
    });
    if (!query.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: query.error.message } },
        400,
      );
    }

    let sql = 'SELECT * FROM governance_adjustments WHERE world_id = ?';
    const params: string[] = [worldId];

    if (query.data.status) {
      sql += ' AND status = ?';
      params.push(query.data.status);
    }
    if (query.data.adjustmentType) {
      sql += ' AND adjustment_type = ?';
      params.push(query.data.adjustmentType);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = db.prepare(sql).all(...params) as AdjustmentRow[];
    const adjustments = rows.map(rowToAdjustment);

    return c.json({ ok: true, data: adjustments });
  });

  return app;
}
