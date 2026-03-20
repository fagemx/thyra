import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { proposalRoutes } from './proposals';

function setupApp() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const now = new Date().toISOString();
  // Insert a village
  db.prepare(
    'INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('v1', 'Test Village', '', 'repo', 'active', '{}', 1, now, now);

  // Insert a constitution for the village
  db.prepare(
    'INSERT INTO constitutions (id, village_id, version, status, created_at, created_by, rules, allowed_permissions, budget_limits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('const-1', 'v1', 1, 'active', now, 'human', '[]', '["dispatch_task","propose_law"]', '{"max_cost_per_action":10,"max_cost_per_day":100,"max_cost_per_loop":50}');

  // Insert a chief
  db.prepare(
    "INSERT INTO chiefs (id, village_id, name, role, version, status, skills, pipelines, permissions, personality, constraints, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run('chief-1', 'v1', 'Test Chief', 'lawmaker', 1, 'active', '[]', '[]', '["propose_law"]', '{}', '[]', now, now);

  const app = new Hono();
  app.route('', proposalRoutes(db));

  return { app, db };
}

describe('Proposal Routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
    db = setup.db;
  });

  describe('GET /api/villages/:id/pending-changes', () => {
    it('returns empty list when no pending changes', async () => {
      const res = await app.request('/api/villages/v1/pending-changes');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(0);
    });

    it('returns 404 for non-existent village', async () => {
      const res = await app.request('/api/villages/nonexistent/pending-changes');
      expect(res.status).toBe(404);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns proposed laws as pending changes', async () => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO laws (id, village_id, proposed_by, category, content, evidence, risk_level, status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('law-1', 'v1', 'chief-1', 'review', '{"description":"2 approvals required"}', '{"source":"init"}', 'low', 'proposed', 1, now, now);

      const res = await app.request('/api/villages/v1/pending-changes');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: Array<{ change_type: string; source_id: string }> };
      expect(body.ok).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.some((c) => c.change_type === 'law.propose')).toBe(true);
    });
  });
});
