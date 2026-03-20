/**
 * routes/cycles.ts — Cycle management API routes
 *
 * POST /api/v1/worlds/:id/cycles       — open new cycle (spec SS9.1)
 * GET  /api/v1/worlds/:id/cycles/active — get active cycle (spec SS9.2)
 * GET  /api/v1/cycles/:id              — get cycle by ID (spec SS9.3)
 * POST /api/v1/cycles/:id/close        — close cycle (spec SS9.4)
 * GET  /api/v1/worlds/:id/cycles       — list cycles (spec SS9.5)
 *
 * CONTRACT: THY-11 — unified response envelope { ok, data/error }
 * CONTRACT: API-01 — THY-11 envelope on all responses
 * CONTRACT: API-02 — route paths match world-cycle-api.md
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../db';
import { appendAudit } from '../db';
import type { CycleRunRow } from '../schemas/cycle-run';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const OpenCycleInput = z.object({
  mode: z.enum(['normal', 'peak', 'incident', 'shutdown']).default('normal'),
  openedBy: z.object({
    type: z.enum(['system', 'human']),
    id: z.string(),
  }),
});

const ListCyclesQuery = z.object({
  status: z.enum(['open', 'closed']).optional(),
  mode: z.enum(['normal', 'peak', 'incident', 'shutdown']).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

/**
 * Map DB snake_case row to API camelCase response.
 */
function rowToResponse(row: CycleRunRow): Record<string, unknown> {
  return {
    cycleId: row.id,
    worldId: row.world_id,
    cycleNumber: row.cycle_number,
    status: row.current_stage === 'complete' || row.current_stage === 'failed'
      ? 'closed'
      : 'open',
    currentStage: row.current_stage,
    mode: row.mode ?? 'normal',
    openedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    failedStage: row.failed_stage,
    failureReason: row.failure_reason,
    observationBatchId: row.observation_batch_id,
    proposalIds: JSON.parse(row.proposal_ids) as string[],
    judgmentReportIds: JSON.parse(row.judgment_report_ids) as string[],
    appliedChangeIds: JSON.parse(row.applied_change_ids) as string[],
    pulseFrameId: row.pulse_frame_id,
    createdAt: row.created_at,
    version: row.version,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function cycleRoutes(db: Database): Hono {
  const app = new Hono();

  // Ensure mode + opened_by columns exist (idempotent ALTER TABLE)
  try { db.run("ALTER TABLE cycle_runs ADD COLUMN mode TEXT DEFAULT 'normal'"); } catch { /* exists */ }
  try { db.run("ALTER TABLE cycle_runs ADD COLUMN opened_by TEXT DEFAULT NULL"); } catch { /* exists */ }

  // -----------------------------------------------------------------------
  // SS9.2 — Get Active Cycle (must be registered before SS9.5 list route)
  // -----------------------------------------------------------------------
  app.get('/api/v1/worlds/:id/cycles/active', (c) => {
    const worldId = c.req.param('id');

    const row = db.prepare(
      `SELECT * FROM cycle_runs
       WHERE world_id = ? AND current_stage NOT IN ('complete', 'failed')
       ORDER BY started_at DESC
       LIMIT 1`
    ).get(worldId) as CycleRunRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NO_ACTIVE_CYCLE', message: 'No active cycle for this world' } },
        404,
      );
    }

    return c.json({ ok: true, data: rowToResponse(row) });
  });

  // -----------------------------------------------------------------------
  // SS9.1 — Open Cycle
  // -----------------------------------------------------------------------
  app.post('/api/v1/worlds/:id/cycles', async (c) => {
    const worldId = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = OpenCycleInput.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    // Check for existing active cycle
    const existing = db.prepare(
      `SELECT id FROM cycle_runs
       WHERE world_id = ? AND current_stage NOT IN ('complete', 'failed')
       LIMIT 1`
    ).get(worldId) as { id: string } | null;

    if (existing) {
      return c.json(
        { ok: false, error: { code: 'ACTIVE_CYCLE_EXISTS', message: `World already has active cycle: ${existing.id}` } },
        409,
      );
    }

    const id = generateId();
    const timestamp = now();
    const { mode, openedBy } = parsed.data;

    // Get next cycle number
    const maxRow = db.prepare(
      'SELECT MAX(cycle_number) as max_num FROM cycle_runs WHERE world_id = ?'
    ).get(worldId) as { max_num: number | null } | null;
    const cycleNumber = (maxRow?.max_num ?? 0) + 1;

    db.prepare(`
      INSERT INTO cycle_runs (
        id, world_id, cycle_number, current_stage,
        started_at, created_at, version,
        proposal_ids, judgment_report_ids, applied_change_ids,
        mode, opened_by
      ) VALUES (?, ?, ?, 'idle', ?, ?, 1, '[]', '[]', '[]', ?, ?)
    `).run(
      id, worldId, cycleNumber,
      timestamp, timestamp,
      mode, JSON.stringify(openedBy),
    );

    // THY-07: audit log
    appendAudit(db, 'cycle_run', id, 'opened', { worldId, mode, openedBy, cycleNumber }, 'system');

    const row = db.prepare('SELECT * FROM cycle_runs WHERE id = ?').get(id) as CycleRunRow;

    return c.json({ ok: true, data: rowToResponse(row) }, 201);
  });

  // -----------------------------------------------------------------------
  // SS9.5 — List Cycles
  // -----------------------------------------------------------------------
  app.get('/api/v1/worlds/:id/cycles', (c) => {
    const worldId = c.req.param('id');
    const queryParsed = ListCyclesQuery.safeParse({
      status: c.req.query('status'),
      mode: c.req.query('mode'),
      limit: c.req.query('limit'),
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: queryParsed.error.message } },
        400,
      );
    }

    const { status, mode, limit } = queryParsed.data;

    let sql = 'SELECT * FROM cycle_runs WHERE world_id = ?';
    const params: (string | number)[] = [worldId];

    if (status === 'open') {
      sql += " AND current_stage NOT IN ('complete', 'failed')";
    } else if (status === 'closed') {
      sql += " AND current_stage IN ('complete', 'failed')";
    }

    if (mode) {
      sql += ' AND mode = ?';
      params.push(mode);
    }

    sql += ' ORDER BY started_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const rows = db.prepare(sql).all(...params) as CycleRunRow[];
    return c.json({ ok: true, data: rows.map(rowToResponse) });
  });

  // -----------------------------------------------------------------------
  // SS9.3 — Get Cycle by ID
  // -----------------------------------------------------------------------
  app.get('/api/v1/cycles/:id', (c) => {
    const cycleId = c.req.param('id');
    const row = db.prepare('SELECT * FROM cycle_runs WHERE id = ?').get(cycleId) as CycleRunRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Cycle not found' } },
        404,
      );
    }

    return c.json({ ok: true, data: rowToResponse(row) });
  });

  // -----------------------------------------------------------------------
  // SS9.4 — Close Cycle
  // -----------------------------------------------------------------------
  app.post('/api/v1/cycles/:id/close', (c) => {
    const cycleId = c.req.param('id');
    const row = db.prepare('SELECT * FROM cycle_runs WHERE id = ?').get(cycleId) as CycleRunRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Cycle not found' } },
        404,
      );
    }

    if (row.current_stage === 'complete' || row.current_stage === 'failed') {
      return c.json(
        { ok: false, error: { code: 'CYCLE_ALREADY_CLOSED', message: 'Cycle is already closed' } },
        409,
      );
    }

    const timestamp = now();
    db.prepare(`
      UPDATE cycle_runs
      SET current_stage = 'complete', completed_at = ?, version = version + 1
      WHERE id = ?
    `).run(timestamp, cycleId);

    // THY-07: audit log
    appendAudit(db, 'cycle_run', cycleId, 'closed', {
      worldId: row.world_id,
      previousStage: row.current_stage,
    }, 'system');

    const updated = db.prepare('SELECT * FROM cycle_runs WHERE id = ?').get(cycleId) as CycleRunRow;
    return c.json({ ok: true, data: rowToResponse(updated) });
  });

  return app;
}
