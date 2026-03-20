import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { precedentRoutes } from './precedents';

function setupApp() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const app = new Hono();
  app.route('', precedentRoutes(db));

  return { app, db };
}

function insertPrecedent(db: Database, overrides: Partial<{
  id: string;
  world_id: string;
  world_type: string;
  proposal_id: string;
  outcome_report_id: string;
  change_kind: string;
  cycle_id: string;
  context: string;
  decision: string;
  outcome: string;
  recommendation: string;
  lessons_learned: string;
  context_tags: string;
}> = {}) {
  const defaults = {
    id: `prec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    world_id: 'world-1',
    world_type: 'market',
    proposal_id: 'prop-1',
    outcome_report_id: 'report-1',
    change_kind: 'pricing',
    cycle_id: 'cycle-1',
    context: 'Test context',
    decision: 'Test decision',
    outcome: 'beneficial',
    recommendation: 'reinforce',
    lessons_learned: '["lesson 1"]',
    context_tags: '["economy","pricing"]',
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO precedent_records (id, world_id, world_type, proposal_id, outcome_report_id,
      change_kind, cycle_id, context, decision, outcome, recommendation, lessons_learned, context_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.world_id, row.world_type, row.proposal_id, row.outcome_report_id,
    row.change_kind, row.cycle_id, row.context, row.decision, row.outcome,
    row.recommendation, row.lessons_learned, row.context_tags,
  );
  return row;
}

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Precedent Routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
    db = setup.db;
  });

  describe('GET /api/v1/worlds/:id/precedents', () => {
    it('returns precedents for a world', async () => {
      insertPrecedent(db, { id: 'prec-1', world_id: 'world-1' });
      insertPrecedent(db, { id: 'prec-2', world_id: 'world-1', change_kind: 'staffing' });

      const res = await app.request('/api/v1/worlds/world-1/precedents');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: Array<{ id: string }> };
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('returns empty array for world with no precedents', async () => {
      const res = await app.request('/api/v1/worlds/nonexistent/precedents');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(0);
    });

    it('filters by kind', async () => {
      insertPrecedent(db, { id: 'prec-1', world_id: 'world-1', change_kind: 'pricing' });
      insertPrecedent(db, { id: 'prec-2', world_id: 'world-1', change_kind: 'staffing' });

      const res = await app.request('/api/v1/worlds/world-1/precedents?kind=pricing');
      const body = await res.json() as { ok: boolean; data: Array<{ changeKind: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].changeKind).toBe('pricing');
    });

    it('filters by verdict', async () => {
      insertPrecedent(db, { id: 'prec-1', world_id: 'world-1', outcome: 'beneficial' });
      insertPrecedent(db, { id: 'prec-2', world_id: 'world-1', outcome: 'harmful' });

      const res = await app.request('/api/v1/worlds/world-1/precedents?verdict=harmful');
      const body = await res.json() as { ok: boolean; data: Array<{ outcome: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].outcome).toBe('harmful');
    });

    it('filters by contextTag', async () => {
      insertPrecedent(db, { id: 'prec-1', world_id: 'world-1', context_tags: '["economy","pricing"]' });
      insertPrecedent(db, { id: 'prec-2', world_id: 'world-1', context_tags: '["social"]' });

      const res = await app.request('/api/v1/worlds/world-1/precedents?contextTag=economy');
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.data).toHaveLength(1);
    });
  });

  describe('GET /api/v1/precedents/:id', () => {
    it('returns a precedent by ID', async () => {
      insertPrecedent(db, { id: 'prec-1', world_id: 'world-1' });

      const res = await app.request('/api/v1/precedents/prec-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { id: string; worldId: string } };
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe('prec-1');
      expect(body.data.worldId).toBe('world-1');
    });

    it('returns 404 for non-existent precedent', async () => {
      const res = await app.request('/api/v1/precedents/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/precedents/search', () => {
    it('searches by worldType', async () => {
      insertPrecedent(db, { id: 'prec-1', world_type: 'market' });
      insertPrecedent(db, { id: 'prec-2', world_type: 'colony' });

      const res = await post(app, '/api/v1/precedents/search', { worldType: 'market' });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: Array<{ worldType: string }> };
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].worldType).toBe('market');
    });

    it('searches by proposalKind', async () => {
      insertPrecedent(db, { id: 'prec-1', change_kind: 'pricing' });
      insertPrecedent(db, { id: 'prec-2', change_kind: 'staffing' });

      const res = await post(app, '/api/v1/precedents/search', { proposalKind: 'staffing' });
      const body = await res.json() as { ok: boolean; data: Array<{ changeKind: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].changeKind).toBe('staffing');
    });

    it('searches by contextTags', async () => {
      insertPrecedent(db, { id: 'prec-1', context_tags: '["economy"]' });
      insertPrecedent(db, { id: 'prec-2', context_tags: '["social"]' });

      const res = await post(app, '/api/v1/precedents/search', { contextTags: ['economy'] });
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns all precedents with empty search', async () => {
      insertPrecedent(db, { id: 'prec-1' });
      insertPrecedent(db, { id: 'prec-2' });

      const res = await post(app, '/api/v1/precedents/search', {});
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.data).toHaveLength(2);
    });
  });
});
