import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDb, initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { SkillRegistry } from '../skill-registry';
import { TerritoryCoordinator } from '../territory';
import { territoryRoutes } from './territories';

function setupApp() {
  const db = createDb(':memory:');
  initSchema(db);

  const villageMgr = new VillageManager(db);
  const villageA = villageMgr.create({ name: 'Village A', target_repo: 'repoA' }, 'human').id;
  const villageB = villageMgr.create({ name: 'Village B', target_repo: 'repoB' }, 'human').id;

  const constitutionStore = new ConstitutionStore(db);
  constitutionStore.create(villageA, {
    rules: [{ description: 'be good', enforcement: 'soft', scope: ['*'] }],
    allowed_permissions: ['dispatch_task', 'cross_village'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'human');
  constitutionStore.create(villageB, {
    rules: [{ description: 'be good', enforcement: 'soft', scope: ['*'] }],
    allowed_permissions: ['dispatch_task', 'cross_village'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'human');

  const skillRegistry = new SkillRegistry(db);
  const coordinator = new TerritoryCoordinator(db, constitutionStore, skillRegistry);

  const app = new Hono();
  app.onError((err, c) => {
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });
  app.route('', territoryRoutes(coordinator));

  return { app, db, villageA, villageB, coordinator };
}

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Territory Routes', () => {
  let app: Hono;
  let villageA: string;
  let villageB: string;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
    villageA = setup.villageA;
    villageB = setup.villageB;
  });

  describe('POST /api/territories', () => {
    it('creates a territory', async () => {
      const res = await post(app, '/api/territories', {
        name: 'Trade Zone',
        village_ids: [villageA, villageB],
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { ok: boolean; data: { id: string; name: string } };
      expect(body.ok).toBe(true);
      expect(body.data.name).toBe('Trade Zone');
      expect(body.data.id).toBeDefined();
    });

    it('returns 400 for invalid input', async () => {
      const res = await post(app, '/api/territories', {
        village_ids: [villageA],
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('VALIDATION');
    });
  });

  describe('GET /api/territories', () => {
    it('lists territories', async () => {
      await post(app, '/api/territories', {
        name: 'Zone 1',
        village_ids: [villageA, villageB],
      });

      const res = await app.request('/api/territories');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/territories/:id', () => {
    it('returns a territory by ID', async () => {
      const createRes = await post(app, '/api/territories', {
        name: 'Zone 1',
        village_ids: [villageA, villageB],
      });
      const { data: created } = await createRes.json() as { data: { id: string } };

      const res = await app.request(`/api/territories/${created.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { id: string; name: string } };
      expect(body.ok).toBe(true);
      expect(body.data.name).toBe('Zone 1');
    });

    it('returns 404 for non-existent territory', async () => {
      const res = await app.request('/api/territories/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/territories/:id/dissolve', () => {
    it('dissolves a territory', async () => {
      const createRes = await post(app, '/api/territories', {
        name: 'Zone 1',
        village_ids: [villageA, villageB],
      });
      const { data: created } = await createRes.json() as { data: { id: string } };

      const res = await app.request(`/api/territories/${created.id}/dissolve`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { status: string } };
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe('dissolved');
    });
  });

  describe('Agreements', () => {
    it('creates and lists agreements', async () => {
      const createRes = await post(app, '/api/territories', {
        name: 'Zone 1',
        village_ids: [villageA, villageB],
      });
      const { data: territory } = await createRes.json() as { data: { id: string } };

      const agreeRes = await post(app, `/api/territories/${territory.id}/agreements`, {
        type: 'resource_sharing',
        parties: [villageA, villageB],
        terms: { description: 'Share resources' },
      });
      expect(agreeRes.status).toBe(201);
      const agreeBody = await agreeRes.json() as { ok: boolean; data: { id: string; type: string } };
      expect(agreeBody.ok).toBe(true);
      expect(agreeBody.data.type).toBe('resource_sharing');

      const listRes = await app.request(`/api/territories/${territory.id}/agreements`);
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json() as { ok: boolean; data: unknown[] };
      expect(listBody.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Policies', () => {
    it('creates and lists policies', async () => {
      const createRes = await post(app, '/api/territories', {
        name: 'Zone 1',
        village_ids: [villageA, villageB],
      });
      const { data: territory } = await createRes.json() as { data: { id: string } };

      const policyRes = await post(app, `/api/territories/${territory.id}/policies`, {
        name: 'Shared linting',
        type: 'shared_standard',
        content: { description: 'All villages must lint' },
      });
      expect(policyRes.status).toBe(201);
      const policyBody = await policyRes.json() as { ok: boolean; data: { id: string; name: string } };
      expect(policyBody.ok).toBe(true);
      expect(policyBody.data.name).toBe('Shared linting');

      const listRes = await app.request(`/api/territories/${territory.id}/policies`);
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json() as { ok: boolean; data: unknown[] };
      expect(listBody.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/territories/:id/audit', () => {
    it('returns territory audit trail', async () => {
      const createRes = await post(app, '/api/territories', {
        name: 'Zone 1',
        village_ids: [villageA, villageB],
      });
      const { data: territory } = await createRes.json() as { data: { id: string } };

      const res = await app.request(`/api/territories/${territory.id}/audit`);
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: unknown };
      expect(body.ok).toBe(true);
    });
  });
});
