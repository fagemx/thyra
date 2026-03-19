/**
 * routes/outcomes.ts — Outcome window + report API routes
 *
 * GET  /api/v1/outcome-windows/:id          — get outcome window (spec §15.1)
 * POST /api/v1/outcome-windows/:id/evaluate — evaluate outcome (spec §15.2)
 * GET  /api/v1/outcome-reports/:id          — get outcome report (spec §15.3)
 * GET  /api/v1/worlds/:id/outcome-windows   — list outcome windows (spec §15.4)
 *
 * CONTRACT: THY-11 — unified response envelope { ok, data/error }
 * CONTRACT: API-01 — THY-11 envelope on all responses
 * CONTRACT: API-02 — route paths match world-cycle-api.md
 * CONTRACT: THY-07 — audit log on mutations
 * CONTRACT: OUTCOME-01 — open -> evaluating -> closed lifecycle
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../db';
import { appendAudit } from '../db';
import { evaluateOutcome } from '../canonical-cycle/outcome-evaluator';
import { buildOutcomeReport } from '../canonical-cycle/outcome-report-builder';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const EvaluateInput = z.object({
  currentSnapshot: z.record(z.string(), z.number()),
  expectedEffects: z.array(z.object({
    metric: z.string(),
    expectedDirection: z.enum(['up', 'down', 'stable']),
  })),
  sideEffectMetrics: z.array(z.string()).default([]),
});

const ListWindowsQuery = z.object({
  status: z.enum(['open', 'evaluating', 'closed']).optional(),
  proposalId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface OutcomeWindowRow {
  id: string;
  world_id: string;
  applied_change_id: string;
  proposal_id: string;
  cycle_id: string;
  status: string;
  baseline_snapshot: string;
  opened_at: string;
  evaluated_at: string | null;
  closed_at: string | null;
  version: number;
  created_at: string;
}

interface OutcomeReportRow {
  id: string;
  outcome_window_id: string;
  applied_change_id: string;
  primary_objective_met: number;
  expected_effects: string;
  side_effects: string;
  verdict: string;
  recommendation: string;
  notes: string;
  version: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function windowRowToResponse(row: OutcomeWindowRow): Record<string, unknown> {
  return {
    id: row.id,
    worldId: row.world_id,
    appliedChangeId: row.applied_change_id,
    proposalId: row.proposal_id,
    cycleId: row.cycle_id,
    status: row.status,
    baselineSnapshot: JSON.parse(row.baseline_snapshot) as unknown,
    openedAt: row.opened_at,
    evaluatedAt: row.evaluated_at,
    closedAt: row.closed_at,
    version: row.version,
    createdAt: row.created_at,
  };
}

function reportRowToResponse(row: OutcomeReportRow): Record<string, unknown> {
  return {
    id: row.id,
    outcomeWindowId: row.outcome_window_id,
    appliedChangeId: row.applied_change_id,
    primaryObjectiveMet: row.primary_objective_met === 1,
    expectedEffects: JSON.parse(row.expected_effects) as unknown,
    sideEffects: JSON.parse(row.side_effects) as unknown,
    verdict: row.verdict,
    recommendation: row.recommendation,
    notes: JSON.parse(row.notes) as unknown,
    version: row.version,
    createdAt: row.created_at,
  };
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function outcomeRoutes(db: Database): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // §15.1 — Get Outcome Window
  // -----------------------------------------------------------------------
  app.get('/api/v1/outcome-windows/:id', (c) => {
    const windowId = c.req.param('id');
    const row = db.prepare('SELECT * FROM outcome_windows WHERE id = ?').get(windowId) as OutcomeWindowRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Outcome window not found' } },
        404,
      );
    }

    return c.json({ ok: true, data: windowRowToResponse(row) });
  });

  // -----------------------------------------------------------------------
  // §15.2 — Evaluate Outcome Window
  // OUTCOME-01: open -> evaluating -> closed
  // -----------------------------------------------------------------------
  app.post('/api/v1/outcome-windows/:id/evaluate', async (c) => {
    const windowId = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = EvaluateInput.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const window = db.prepare('SELECT * FROM outcome_windows WHERE id = ?').get(windowId) as OutcomeWindowRow | null;

    if (!window) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Outcome window not found' } },
        404,
      );
    }

    if (window.status !== 'open') {
      return c.json(
        { ok: false, error: { code: 'INVALID_STATE', message: `Cannot evaluate window in status: ${window.status}. Must be open.` } },
        409,
      );
    }

    const timestamp = now();
    const baselineSnapshot = JSON.parse(window.baseline_snapshot) as Record<string, number>;

    // Step 1: transition to evaluating (OUTCOME-01)
    db.prepare(
      'UPDATE outcome_windows SET status = ?, evaluated_at = ?, version = version + 1 WHERE id = ?'
    ).run('evaluating', timestamp, windowId);

    // Step 2: run evaluation
    const evaluationResult = evaluateOutcome({
      baselineSnapshot,
      currentSnapshot: parsed.data.currentSnapshot,
      expectedEffects: parsed.data.expectedEffects,
      sideEffectMetrics: parsed.data.sideEffectMetrics,
    });

    // Step 3: build outcome report
    const report = buildOutcomeReport({
      appliedChangeId: window.applied_change_id,
      outcomeWindowId: windowId,
      evaluationResult,
    });

    // Step 4: persist outcome report
    db.prepare(`
      INSERT INTO outcome_reports (
        id, outcome_window_id, applied_change_id,
        primary_objective_met, expected_effects, side_effects,
        verdict, recommendation, notes, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      report.id,
      windowId,
      window.applied_change_id,
      report.primaryObjectiveMet ? 1 : 0,
      JSON.stringify(report.expectedEffects),
      JSON.stringify(report.sideEffects),
      report.verdict,
      report.recommendation,
      JSON.stringify(report.notes),
      report.createdAt,
    );

    // Step 5: transition to closed (OUTCOME-01)
    db.prepare(
      'UPDATE outcome_windows SET status = ?, closed_at = ?, version = version + 1 WHERE id = ?'
    ).run('closed', timestamp, windowId);

    // THY-07: audit log
    appendAudit(db, 'outcome_window', windowId, 'evaluated', {
      reportId: report.id,
      verdict: report.verdict,
      recommendation: report.recommendation,
    }, 'system');

    const reportRow = db.prepare('SELECT * FROM outcome_reports WHERE id = ?').get(report.id) as OutcomeReportRow;
    return c.json({ ok: true, data: reportRowToResponse(reportRow) });
  });

  // -----------------------------------------------------------------------
  // §15.3 — Get Outcome Report
  // -----------------------------------------------------------------------
  app.get('/api/v1/outcome-reports/:id', (c) => {
    const reportId = c.req.param('id');
    const row = db.prepare('SELECT * FROM outcome_reports WHERE id = ?').get(reportId) as OutcomeReportRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Outcome report not found' } },
        404,
      );
    }

    return c.json({ ok: true, data: reportRowToResponse(row) });
  });

  // -----------------------------------------------------------------------
  // §15.4 — List Outcome Windows for a World
  // -----------------------------------------------------------------------
  app.get('/api/v1/worlds/:id/outcome-windows', (c) => {
    const worldId = c.req.param('id');
    const queryParsed = ListWindowsQuery.safeParse({
      status: c.req.query('status'),
      proposalId: c.req.query('proposalId'),
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: queryParsed.error.message } },
        400,
      );
    }

    const { status, proposalId } = queryParsed.data;

    let sql = 'SELECT * FROM outcome_windows WHERE world_id = ?';
    const params: string[] = [worldId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (proposalId) {
      sql += ' AND proposal_id = ?';
      params.push(proposalId);
    }

    sql += ' ORDER BY opened_at DESC';

    const rows = db.prepare(sql).all(...params) as OutcomeWindowRow[];
    return c.json({ ok: true, data: rows.map(windowRowToResponse) });
  });

  return app;
}
