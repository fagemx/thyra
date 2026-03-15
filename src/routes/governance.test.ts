import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { RiskAssessor } from '../risk-assessor';
import { SkillRegistry } from '../skill-registry';
import { governanceRoutes } from './governance';
import type { GovernanceDeps } from '../village-governance';

describe('governance routes', () => {
  let app: ReturnType<typeof governanceRoutes>;
  let villageId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    const constitutionStore = new ConstitutionStore(db);
    const skillRegistry = new SkillRegistry(db);
    const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
    const riskAssessor = new RiskAssessor(db);

    const deps: GovernanceDeps = { db, villageMgr, constitutionStore, chiefEngine, lawEngine, riskAssessor };

    app = governanceRoutes(deps);

    const village = villageMgr.create({ name: 'RouteTest', target_repo: 'fagemx/rt' }, 'human');
    villageId = village.id;

    // 建立 constitution 以便測試
    constitutionStore.create(villageId, {
      rules: [{ description: 'must follow guidelines', enforcement: 'soft', scope: ['*'] }],
      allowed_permissions: ['propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
  });

  // ---- POST /api/villages/:id/brief ----

  describe('POST /api/villages/:id/brief', () => {
    it('200 — returns brief', async () => {
      const res = await app.request(`/api/villages/${villageId}/brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.village).toBeDefined();
      expect(data.constitution).toBeDefined();
      expect(data.chiefs).toBeDefined();
      expect(data.laws).toBeDefined();
    });

    it('404 — village not found', async () => {
      const res = await app.request('/api/villages/village-xxx/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it('400 — invalid depth', async () => {
      const res = await app.request(`/api/villages/${villageId}/brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth: 'invalid' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ---- POST /api/villages/:id/ask ----

  describe('POST /api/villages/:id/ask', () => {
    it('200 — returns answer', async () => {
      const res = await app.request(`/api/villages/${villageId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'What is the budget?' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.topic).toBe('budget');
      expect(data.answer).toBeDefined();
    });

    it('400 — missing question', async () => {
      const res = await app.request(`/api/villages/${villageId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('404 — village not found', async () => {
      const res = await app.request('/api/villages/village-xxx/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hello' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /api/villages/:id/command ----

  describe('POST /api/villages/:id/command', () => {
    it('200 — low risk command approved', async () => {
      const res = await app.request(`/api/villages/${villageId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run_tests',
          description: 'Run test suite',
          estimated_cost: 1,
          reason: 'CI check',
          rollback_plan: 'No side effects',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.approved).toBe(true);
    });

    it('200 — blocked command returns blocked', async () => {
      const res = await app.request(`/api/villages/${villageId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'expensive',
          description: 'Very expensive operation',
          estimated_cost: 999,
          reason: 'Need compute',
          rollback_plan: 'Revert',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.approved).toBe(false);
      const assessment = data.assessment as Record<string, unknown>;
      expect(assessment.blocked).toBe(true);
    });

    it('400 — missing required fields', async () => {
      const res = await app.request(`/api/villages/${villageId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      });
      expect(res.status).toBe(400);
    });

    it('404 — village not found', async () => {
      const res = await app.request('/api/villages/village-xxx/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          description: 'test',
          estimated_cost: 0,
          reason: 'test',
          rollback_plan: 'none',
        }),
      });
      expect(res.status).toBe(404);
    });
  });
});
