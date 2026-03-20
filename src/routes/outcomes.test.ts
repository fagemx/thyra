import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { outcomeRoutes } from './outcomes';

function setupApp() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const app = new Hono();
  app.route('', outcomeRoutes(db));

  return { app, db };
}

function insertOutcomeWindow(db: Database, overrides: Partial<{
  id: string;
  world_id: string;
  applied_change_id: string;
  proposal_id: string;
  cycle_id: string;
  status: string;
  baseline_snapshot: string;
  opened_at: string;
}> = {}) {
  const defaults = {
    id: `ow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    world_id: 'world-1',
    applied_change_id: 'change-1',
    proposal_id: 'prop-1',
    cycle_id: 'cycle-1',
    status: 'open',
    baseline_snapshot: '{"revenue": 100, "customers": 50}',
    opened_at: new Date().toISOString(),
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO outcome_windows (id, world_id, applied_change_id, proposal_id, cycle_id, status, baseline_snapshot, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.world_id, row.applied_change_id, row.proposal_id, row.cycle_id, row.status, row.baseline_snapshot, row.opened_at);
  return row;
}

function insertOutcomeReport(db: Database, overrides: Partial<{
  id: string;
  outcome_window_id: string;
  applied_change_id: string;
  primary_objective_met: number;
  expected_effects: string;
  side_effects: string;
  verdict: string;
  recommendation: string;
  notes: string;
}> = {}) {
  const defaults = {
    id: `report-${Date.now()}`,
    outcome_window_id: 'ow-1',
    applied_change_id: 'change-1',
    primary_objective_met: 1,
    expected_effects: '[]',
    side_effects: '[]',
    verdict: 'beneficial',
    recommendation: 'reinforce',
    notes: '[]',
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO outcome_reports (id, outcome_window_id, applied_change_id, primary_objective_met,
      expected_effects, side_effects, verdict, recommendation, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.outcome_window_id, row.applied_change_id, row.primary_objective_met,
    row.expected_effects, row.side_effects, row.verdict, row.recommendation, row.notes);
  return row;
}

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Outcome Routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
    db = setup.db;
  });

  describe('GET /api/v1/outcome-windows/:id', () => {
    it('returns an outcome window by ID', async () => {
      insertOutcomeWindow(db, { id: 'ow-1', world_id: 'world-1' });

      const res = await app.request('/api/v1/outcome-windows/ow-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { id: string; worldId: string; status: string } };
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe('ow-1');
      expect(body.data.worldId).toBe('world-1');
      expect(body.data.status).toBe('open');
    });

    it('returns 404 for non-existent window', async () => {
      const res = await app.request('/api/v1/outcome-windows/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/outcome-windows/:id/evaluate', () => {
    it('evaluates an open outcome window', async () => {
      insertOutcomeWindow(db, { id: 'ow-1', status: 'open', baseline_snapshot: '{"revenue": 100}' });

      const res = await post(app, '/api/v1/outcome-windows/ow-1/evaluate', {
        currentSnapshot: { revenue: 120 },
        expectedEffects: [{ metric: 'revenue', expectedDirection: 'up' }],
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { verdict: string; recommendation: string; primaryObjectiveMet: boolean } };
      expect(body.ok).toBe(true);
      expect(body.data.verdict).toBeDefined();
      expect(body.data.recommendation).toBeDefined();
      expect(typeof body.data.primaryObjectiveMet).toBe('boolean');
    });

    it('returns 404 for non-existent window', async () => {
      const res = await post(app, '/api/v1/outcome-windows/nonexistent/evaluate', {
        currentSnapshot: { revenue: 120 },
        expectedEffects: [{ metric: 'revenue', expectedDirection: 'up' }],
      });
      expect(res.status).toBe(404);
    });

    it('returns 409 for already closed window', async () => {
      insertOutcomeWindow(db, { id: 'ow-closed', status: 'closed' });

      const res = await post(app, '/api/v1/outcome-windows/ow-closed/evaluate', {
        currentSnapshot: { revenue: 120 },
        expectedEffects: [{ metric: 'revenue', expectedDirection: 'up' }],
      });
      expect(res.status).toBe(409);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_STATE');
    });

    it('returns 400 for invalid input', async () => {
      insertOutcomeWindow(db, { id: 'ow-1', status: 'open' });

      const res = await post(app, '/api/v1/outcome-windows/ow-1/evaluate', {
        expectedEffects: [{ metric: 'revenue', expectedDirection: 'up' }],
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('VALIDATION');
    });
  });

  describe('GET /api/v1/outcome-reports/:id', () => {
    it('returns an outcome report by ID', async () => {
      insertOutcomeReport(db, { id: 'report-1', verdict: 'beneficial' });

      const res = await app.request('/api/v1/outcome-reports/report-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { id: string; verdict: string } };
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe('report-1');
      expect(body.data.verdict).toBe('beneficial');
    });

    it('returns 404 for non-existent report', async () => {
      const res = await app.request('/api/v1/outcome-reports/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/worlds/:id/outcome-windows', () => {
    it('returns outcome windows for a world', async () => {
      insertOutcomeWindow(db, { id: 'ow-1', world_id: 'world-1' });
      insertOutcomeWindow(db, { id: 'ow-2', world_id: 'world-1' });
      insertOutcomeWindow(db, { id: 'ow-3', world_id: 'world-2' });

      const res = await app.request('/api/v1/worlds/world-1/outcome-windows');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('filters by status', async () => {
      insertOutcomeWindow(db, { id: 'ow-open', world_id: 'world-1', status: 'open' });
      insertOutcomeWindow(db, { id: 'ow-closed', world_id: 'world-1', status: 'closed' });

      const res = await app.request('/api/v1/worlds/world-1/outcome-windows?status=open');
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('filters by proposalId', async () => {
      insertOutcomeWindow(db, { id: 'ow-1', world_id: 'world-1', proposal_id: 'prop-A' });
      insertOutcomeWindow(db, { id: 'ow-2', world_id: 'world-1', proposal_id: 'prop-B' });

      const res = await app.request('/api/v1/worlds/world-1/outcome-windows?proposalId=prop-A');
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns empty array for world with no windows', async () => {
      const res = await app.request('/api/v1/worlds/nonexistent/outcome-windows');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });
});
