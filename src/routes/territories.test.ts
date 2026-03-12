import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDb, initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { SkillRegistry } from '../skill-registry';
import { TerritoryCoordinator } from '../territory';
import { territoryRoutes } from './territories';
import type { Database } from 'bun:sqlite';

describe('territory routes — Zod validation', () => {
  let app: Hono;
  let villageA: string;
  let villageB: string;
  let territoryId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    villageA = villageMgr.create({ name: 'Village A', target_repo: 'repoA' }, 'u').id;
    villageB = villageMgr.create({ name: 'Village B', target_repo: 'repoB' }, 'u').id;

    const constitutionStore = new ConstitutionStore(db);
    constitutionStore.create(villageA, {
      rules: [{ description: 'ok', enforcement: 'soft', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'cross_village'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
    constitutionStore.create(villageB, {
      rules: [{ description: 'ok', enforcement: 'soft', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'cross_village'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    const skillRegistry = new SkillRegistry(db);
    const coordinator = new TerritoryCoordinator(db, constitutionStore, skillRegistry);

    // 預建一個 territory 供後續測試用
    const t = coordinator.create({ name: 'AB', village_ids: [villageA, villageB] }, 'human');
    territoryId = t.id;

    app = new Hono();
    app.route('/', territoryRoutes(coordinator));
  });

  // === POST /api/territories ===

  it('POST /api/territories — empty body returns 400 VALIDATION', async () => {
    const res = await app.request('/api/territories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('POST /api/territories — missing village_ids returns 400', async () => {
    const res = await app.request('/api/territories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('POST /api/territories — village_ids with < 2 items returns 400', async () => {
    const res = await app.request('/api/territories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', village_ids: ['one'] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION');
  });

  it('POST /api/territories — valid body returns 201', async () => {
    const res = await app.request('/api/territories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New', village_ids: [villageA, villageB] }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  // === POST /api/territories/:id/agreements ===

  it('POST agreements — empty body returns 400 VALIDATION', async () => {
    const res = await app.request(`/api/territories/${territoryId}/agreements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION');
  });

  it('POST agreements — invalid type returns 400 VALIDATION', async () => {
    const res = await app.request(`/api/territories/${territoryId}/agreements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid_type', parties: [villageA, villageB], terms: {} }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION');
  });

  it('POST agreements — valid body returns 201', async () => {
    const res = await app.request(`/api/territories/${territoryId}/agreements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'resource_sharing', parties: [villageA, villageB], terms: {} }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  // === POST /api/agreements/:id/approve ===

  it('POST approve — missing village_id returns 400 VALIDATION', async () => {
    const res = await app.request('/api/agreements/fake-id/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION');
  });

  it('POST approve — empty village_id returns 400 VALIDATION', async () => {
    const res = await app.request('/api/agreements/fake-id/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ village_id: '' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION');
  });

  // === POST /api/territories/share-skill ===

  it('POST share-skill — empty body returns 400 VALIDATION', async () => {
    const res = await app.request('/api/territories/share-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION');
  });

  it('POST share-skill — missing fields returns 400 VALIDATION', async () => {
    const res = await app.request('/api/territories/share-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: 'sk1' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION');
  });
});
