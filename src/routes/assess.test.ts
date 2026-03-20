import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { RiskAssessor } from '../risk-assessor';
import { assessRoutes } from './assess';

function setupApp() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const villageMgr = new VillageManager(db);
  const villageId = villageMgr.create({ name: 'Test Village', target_repo: 'repo' }, 'human').id;

  const constitutionStore = new ConstitutionStore(db);
  constitutionStore.create(villageId, {
    rules: [{ description: 'be safe', enforcement: 'hard', scope: ['*'] }],
    allowed_permissions: ['dispatch_task', 'propose_law'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'human');

  const riskAssessor = new RiskAssessor(db);

  const app = new Hono();
  app.onError((err, c) => {
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });
  app.route('', assessRoutes(riskAssessor, constitutionStore));

  return { app, db, villageId };
}

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Assess Routes', () => {
  let app: Hono;
  let villageId: string;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
    villageId = setup.villageId;
  });

  describe('POST /api/assess', () => {
    it('assesses an action and returns risk level', async () => {
      const res = await post(app, '/api/assess', {
        type: 'dispatch_task',
        description: 'Run linter',
        initiated_by: 'chief-1',
        village_id: villageId,
        estimated_cost: 1,
        reason: 'Code quality check',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { level: string } };
      expect(body.ok).toBe(true);
      expect(body.data.level).toBeDefined();
    });

    it('returns 400 for invalid input', async () => {
      const res = await post(app, '/api/assess', {
        type: 'dispatch_task',
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('VALIDATION');
    });

    it('returns 200 with elevated risk when village has no constitution', async () => {
      const res = await post(app, '/api/assess', {
        type: 'dispatch_task',
        description: 'Run linter',
        initiated_by: 'chief-1',
        village_id: 'nonexistent-village',
        estimated_cost: 1,
        reason: 'Code quality check',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { level: string } };
      expect(body.ok).toBe(true);
      expect(body.data.level).toBeDefined();
    });
  });

  describe('GET /api/villages/:vid/budget', () => {
    it('returns budget info for a village with constitution', async () => {
      const res = await app.request(`/api/villages/${villageId}/budget`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        ok: boolean;
        data: {
          limits: { max_cost_per_action: number; max_cost_per_day: number };
          spent_today: number;
          remaining_today: number;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.data.limits).toBeDefined();
      expect(body.data.limits.max_cost_per_day).toBe(100);
      expect(body.data.spent_today).toBe(0);
      expect(body.data.remaining_today).toBe(100);
    });

    it('returns null limits for village without constitution', async () => {
      const res = await app.request('/api/villages/nonexistent/budget');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { limits: null; spent_today: number } };
      expect(body.ok).toBe(true);
      expect(body.data.limits).toBeNull();
    });
  });
});
