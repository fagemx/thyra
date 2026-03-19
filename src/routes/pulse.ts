/**
 * routes/pulse.ts — Pulse API route
 *
 * GET /api/v1/worlds/:id/pulse — get current pulse (spec §14.1)
 *
 * CONTRACT: THY-11 — unified response envelope { ok, data/error }
 * CONTRACT: API-01 — THY-11 envelope on all responses
 * CONTRACT: API-02 — route paths match world-cycle-api.md
 * CONTRACT: PULSE-01 — PulseFrame has healthScore + mode + stability + concerns
 */

import { Hono } from 'hono';
import type { Database } from '../db';

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface PulseFrameRow {
  id: string;
  world_id: string;
  cycle_id: string | null;
  health_score: number;
  mode: string;
  stability: string;
  sub_scores: string;
  dominant_concerns: string;
  metrics: string;
  latest_applied_change_id: string | null;
  open_outcome_window_count: number;
  pending_proposal_count: number;
  version: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToResponse(row: PulseFrameRow): Record<string, unknown> {
  return {
    id: row.id,
    worldId: row.world_id,
    cycleId: row.cycle_id,
    healthScore: row.health_score,
    mode: row.mode,
    stability: row.stability,
    subScores: JSON.parse(row.sub_scores) as unknown,
    dominantConcerns: JSON.parse(row.dominant_concerns) as unknown,
    metrics: JSON.parse(row.metrics) as unknown,
    latestAppliedChangeId: row.latest_applied_change_id,
    openOutcomeWindowCount: row.open_outcome_window_count,
    pendingProposalCount: row.pending_proposal_count,
    version: row.version,
    timestamp: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function pulseRoutes(db: Database): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // §14.1 — Get Current Pulse
  // -----------------------------------------------------------------------
  app.get('/api/v1/worlds/:id/pulse', (c) => {
    const worldId = c.req.param('id');

    // Return latest persisted pulse frame for this world
    const row = db.prepare(
      'SELECT * FROM pulse_frames WHERE world_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(worldId) as PulseFrameRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No pulse data available for this world' } },
        404,
      );
    }

    return c.json({ ok: true, data: rowToResponse(row) });
  });

  return app;
}
