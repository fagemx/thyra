import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { pulseRoutes } from './pulse';

function setupApp() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const app = new Hono();
  app.route('', pulseRoutes(db));

  return { app, db };
}

function insertPulseFrame(db: Database, overrides: Partial<{
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
}> = {}) {
  const defaults = {
    id: `pulse-${Date.now()}`,
    world_id: 'world-1',
    cycle_id: null,
    health_score: 85.0,
    mode: 'normal',
    stability: 'stable',
    sub_scores: '{"economy": 90, "social": 80}',
    dominant_concerns: '["none"]',
    metrics: '{"population": 100}',
    latest_applied_change_id: null,
    open_outcome_window_count: 0,
    pending_proposal_count: 0,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO pulse_frames (id, world_id, cycle_id, health_score, mode, stability,
      sub_scores, dominant_concerns, metrics, latest_applied_change_id,
      open_outcome_window_count, pending_proposal_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.world_id, row.cycle_id, row.health_score, row.mode, row.stability,
    row.sub_scores, row.dominant_concerns, row.metrics, row.latest_applied_change_id,
    row.open_outcome_window_count, row.pending_proposal_count,
  );
  return row;
}

describe('Pulse Routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
    db = setup.db;
  });

  describe('GET /api/v1/worlds/:id/pulse', () => {
    it('returns latest pulse frame for a world', async () => {
      insertPulseFrame(db, { id: 'pulse-1', world_id: 'world-1', health_score: 85.0 });

      const res = await app.request('/api/v1/worlds/world-1/pulse');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { healthScore: number; mode: string; stability: string } };
      expect(body.ok).toBe(true);
      expect(body.data.healthScore).toBe(85.0);
      expect(body.data.mode).toBe('normal');
      expect(body.data.stability).toBe('stable');
    });

    it('returns 404 when no pulse data exists', async () => {
      const res = await app.request('/api/v1/worlds/nonexistent/pulse');
      expect(res.status).toBe(404);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns the most recent pulse frame', async () => {
      insertPulseFrame(db, { id: 'pulse-old', world_id: 'world-1', health_score: 50.0 });
      // Insert a newer one with explicit created_at to guarantee ordering
      db.prepare(`
        INSERT INTO pulse_frames (id, world_id, health_score, mode, stability,
          sub_scores, dominant_concerns, metrics, open_outcome_window_count, pending_proposal_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('pulse-new', 'world-1', 95.0, 'growth', 'stable', '{}', '[]', '{}', 0, 0, '2099-01-01T00:00:00.000Z');

      const res = await app.request('/api/v1/worlds/world-1/pulse');
      const body = await res.json() as { ok: boolean; data: { healthScore: number; mode: string } };
      expect(body.data.healthScore).toBe(95.0);
      expect(body.data.mode).toBe('growth');
    });
  });
});
