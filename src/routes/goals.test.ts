import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { GoalStore } from '../goal-store';
import { goalRoutes } from './goals';

function setupApp() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('v1', 'Test Village', '', 'repo', 'active', '{}', 1, now, now);

  db.prepare(
    'INSERT INTO constitutions (id, village_id, version, status, created_at, created_by, rules, allowed_permissions, budget_limits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('const-1', 'v1', 1, 'active', now, 'human', '[]', '["dispatch_task"]', '{}');

  db.prepare(
    "INSERT INTO chiefs (id, village_id, name, role, version, status, skills, pipelines, permissions, personality, constraints, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run('chief-1', 'v1', 'Test Chief', 'economy', 1, 'active', '[]', '[]', '["dispatch_task"]', '{}', '[]', now, now);

  const goalStore = new GoalStore(db);
  const app = new Hono();
  app.route('', goalRoutes(goalStore));

  return { app, db, goalStore };
}

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patch(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Goal Routes', () => {
  let app: Hono;
  let goalStore: GoalStore;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
    goalStore = setup.goalStore;
  });

  describe('POST /api/villages/:id/goals', () => {
    it('creates a goal', async () => {
      const res = await post(app, '/api/villages/v1/goals', {
        level: 'world',
        title: 'Best market',
      });
      expect(res.status).toBe(201);
      const json = await res.json() as { ok: boolean; data: { id: string; title: string } };
      expect(json.ok).toBe(true);
      expect(json.data.title).toBe('Best market');
    });

    it('returns 400 for invalid input', async () => {
      const res = await post(app, '/api/villages/v1/goals', {
        level: 'invalid',
        title: 'Bad',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/villages/:id/goals', () => {
    it('lists goals', async () => {
      goalStore.create('v1', { village_id: 'v1', level: 'world', title: 'G1' }, 'human');
      goalStore.create('v1', { village_id: 'v1', level: 'team', title: 'G2' }, 'human');

      const res = await app.request('/api/villages/v1/goals');
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; data: unknown[] };
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(2);
    });

    it('filters by status', async () => {
      const g = goalStore.create('v1', { village_id: 'v1', level: 'world', title: 'G1' }, 'human');
      goalStore.update(g.id, { status: 'active' }, 'human');
      goalStore.create('v1', { village_id: 'v1', level: 'team', title: 'G2' }, 'human');

      const res = await app.request('/api/villages/v1/goals?status=active');
      const json = await res.json() as { data: unknown[] };
      expect(json.data).toHaveLength(1);
    });

    it('returns 400 for invalid status filter', async () => {
      const res = await app.request('/api/villages/v1/goals?status=bogus');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/goals/:id', () => {
    it('returns goal with ancestry', async () => {
      const world = goalStore.create('v1', { village_id: 'v1', level: 'world', title: 'World' }, 'human');
      const team = goalStore.create('v1', { village_id: 'v1', level: 'team', title: 'Team', parent_id: world.id }, 'human');

      const res = await app.request(`/api/goals/${team.id}`);
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; data: { goal: { id: string }; ancestry: unknown[] } };
      expect(json.data.goal.id).toBe(team.id);
      expect(json.data.ancestry).toHaveLength(2);
    });

    it('returns 404 for non-existent goal', async () => {
      const res = await app.request('/api/goals/goal-nope');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/goals/:id', () => {
    it('updates a goal', async () => {
      const goal = goalStore.create('v1', { village_id: 'v1', level: 'world', title: 'Original' }, 'human');

      const res = await patch(app, `/api/goals/${goal.id}`, { title: 'Updated', status: 'active' });
      expect(res.status).toBe(200);
      const json = await res.json() as { data: { title: string; status: string } };
      expect(json.data.title).toBe('Updated');
      expect(json.data.status).toBe('active');
    });

    it('returns 404 for non-existent goal', async () => {
      const res = await patch(app, '/api/goals/goal-nope', { title: 'Nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/chiefs/:id/goals', () => {
    it('returns chief goal ancestry', async () => {
      const world = goalStore.create('v1', { village_id: 'v1', level: 'world', title: 'World' }, 'human');
      goalStore.create('v1', {
        village_id: 'v1',
        level: 'chief',
        title: 'Chief Goal',
        parent_id: world.id,
        owner_chief_id: 'chief-1',
      }, 'human');

      const res = await app.request('/api/chiefs/chief-1/goals');
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; data: Array<{ goal: { title: string }; ancestry: unknown[] }> };
      expect(json.data).toHaveLength(1);
      expect(json.data[0].goal.title).toBe('Chief Goal');
      expect(json.data[0].ancestry).toHaveLength(2);
    });

    it('returns empty for chief with no goals', async () => {
      const res = await app.request('/api/chiefs/chief-none/goals');
      expect(res.status).toBe(200);
      const json = await res.json() as { data: unknown[] };
      expect(json.data).toEqual([]);
    });
  });
});
