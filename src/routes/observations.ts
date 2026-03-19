/**
 * routes/observations.ts — Observation batch API routes
 *
 * GET  /api/v1/cycles/:id/observations — get observation batch (spec SS10.2)
 * POST /api/v1/cycles/:id/observations — create observation batch (spec SS10.1)
 *
 * CONTRACT: THY-11 — unified response envelope { ok, data/error }
 * CONTRACT: API-01 — THY-11 envelope on all responses
 * CONTRACT: API-02 — route paths match world-cycle-api.md
 * CONTRACT: THY-07 — audit log on mutations
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../db';
import { appendAudit } from '../db';
import { ObservationSchema } from '../schemas/observation';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const CreateObservationBatchInput = z.object({
  observations: z.array(ObservationSchema).min(1),
});

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface ObservationBatchRow {
  id: string;
  world_id: string;
  cycle_id: string;
  observations: string;
  created_at: string;
  version: number;
}

interface CycleRunRow {
  id: string;
  world_id: string;
  current_stage: string;
  observation_batch_id: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `obs_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function rowToResponse(row: ObservationBatchRow): Record<string, unknown> {
  return {
    id: row.id,
    worldId: row.world_id,
    cycleId: row.cycle_id,
    observations: JSON.parse(row.observations) as unknown[],
    createdAt: row.created_at,
    version: row.version,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function observationRoutes(db: Database): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // SS10.2 — Get Observation Batch for a Cycle
  // -----------------------------------------------------------------------
  app.get('/api/v1/cycles/:id/observations', (c) => {
    const cycleId = c.req.param('id');

    // Verify cycle exists
    const cycle = db.prepare('SELECT id FROM cycle_runs WHERE id = ?').get(cycleId) as { id: string } | null;
    if (!cycle) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Cycle not found' } },
        404,
      );
    }

    const row = db.prepare(
      'SELECT * FROM observation_batches WHERE cycle_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(cycleId) as ObservationBatchRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No observation batch for this cycle' } },
        404,
      );
    }

    return c.json({ ok: true, data: rowToResponse(row) });
  });

  // -----------------------------------------------------------------------
  // SS10.1 — Create Observation Batch for a Cycle
  // -----------------------------------------------------------------------
  app.post('/api/v1/cycles/:id/observations', async (c) => {
    const cycleId = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = CreateObservationBatchInput.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    // Verify cycle exists and is open
    const cycle = db.prepare(
      'SELECT id, world_id, current_stage, observation_batch_id FROM cycle_runs WHERE id = ?'
    ).get(cycleId) as CycleRunRow | null;

    if (!cycle) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Cycle not found' } },
        404,
      );
    }

    if (cycle.current_stage === 'complete' || cycle.current_stage === 'failed') {
      return c.json(
        { ok: false, error: { code: 'CYCLE_CLOSED', message: 'Cannot add observations to a closed cycle' } },
        409,
      );
    }

    // Check if batch already exists for this cycle
    const existing = db.prepare(
      'SELECT id FROM observation_batches WHERE cycle_id = ? LIMIT 1'
    ).get(cycleId) as { id: string } | null;

    if (existing) {
      return c.json(
        { ok: false, error: { code: 'BATCH_EXISTS', message: `Observation batch already exists for this cycle: ${existing.id}` } },
        409,
      );
    }

    const id = generateId();
    const timestamp = now();

    db.prepare(`
      INSERT INTO observation_batches (id, world_id, cycle_id, observations, created_at, version)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, cycle.world_id, cycleId, JSON.stringify(parsed.data.observations), timestamp);

    // Update cycle_runs to reference the batch
    db.prepare(
      'UPDATE cycle_runs SET observation_batch_id = ? WHERE id = ?'
    ).run(id, cycleId);

    // THY-07: audit log
    appendAudit(db, 'observation_batch', id, 'created', {
      cycleId,
      worldId: cycle.world_id,
      observationCount: parsed.data.observations.length,
    }, 'system');

    const row = db.prepare('SELECT * FROM observation_batches WHERE id = ?').get(id) as ObservationBatchRow;

    return c.json({ ok: true, data: rowToResponse(row) }, 201);
  });

  return app;
}
