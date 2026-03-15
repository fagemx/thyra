import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDb, initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { SkillRegistry } from '../skill-registry';
import { villageRoutes } from './villages';
import { constitutionRoutes } from './constitutions';
import { chiefRoutes } from './chiefs';

// Helper: build a full Hono app with in-memory DB and all managers
function buildApp() {
  const db = createDb(':memory:');
  initSchema(db);
  const villageMgr = new VillageManager(db);
  const skillRegistry = new SkillRegistry(db);
  const constitutionStore = new ConstitutionStore(db);
  const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);

  const app = new Hono();
  app.onError((err, c) => {
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });
  app.route('', villageRoutes(villageMgr, db));
  app.route('', constitutionRoutes(constitutionStore));
  app.route('', chiefRoutes(chiefEngine, skillRegistry));

  return { app, db, villageMgr, constitutionStore, chiefEngine, skillRegistry };
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function jsonPatch(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const VALID_VILLAGE = { name: 'TestVillage', target_repo: 'org/repo' };

const VALID_CONSTITUTION = {
  rules: [{ description: 'Must test everything', enforcement: 'hard' }],
  allowed_permissions: ['dispatch_task', 'propose_law'],
};

const VALID_CHIEF = {
  name: 'TestChief',
  role: 'Code review specialist',
  permissions: ['dispatch_task'],
};

// ─── Villages ────────────────────────────────────────────────────────────────

describe('Villages routes', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  it('POST /api/villages → 201 with { ok: true, data }', async () => {
    const res = await app.request('/api/villages', json(VALID_VILLAGE));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toMatch(/^village-/);
    expect(body.data.name).toBe('TestVillage');
    expect(body.data.target_repo).toBe('org/repo');
    expect(body.data.status).toBe('active');
    expect(body.data.version).toBe(1);
  });

  it('POST /api/villages with invalid body → 400', async () => {
    const res = await app.request('/api/villages', json({ name: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('GET /api/villages → 200 list', async () => {
    // Create two villages
    await app.request('/api/villages', json(VALID_VILLAGE));
    await app.request('/api/villages', json({ name: 'Second', target_repo: 'org/two' }));

    const res = await app.request('/api/villages');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
  });

  it('GET /api/villages/:id → 200', async () => {
    const createRes = await app.request('/api/villages', json(VALID_VILLAGE));
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/villages/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(created.id);
    expect(body.data.name).toBe('TestVillage');
  });

  it('GET /api/villages/:id with bad id → 404', async () => {
    const res = await app.request('/api/villages/nonexistent-id');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ─── Constitutions ───────────────────────────────────────────────────────────

describe('Constitutions routes', () => {
  let app: Hono;
  let villageId: string;

  beforeEach(async () => {
    ({ app } = buildApp());
    // Create a village first
    const res = await app.request('/api/villages', json(VALID_VILLAGE));
    const body = await res.json();
    villageId = body.data.id;
  });

  it('POST /api/villages/:vid/constitutions → 201', async () => {
    const res = await app.request(
      `/api/villages/${villageId}/constitutions`,
      json(VALID_CONSTITUTION),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toMatch(/^const-/);
    expect(body.data.village_id).toBe(villageId);
    expect(body.data.status).toBe('active');
    expect(body.data.version).toBe(1);
    expect(body.data.allowed_permissions).toContain('dispatch_task');
  });

  it('POST /api/villages/:vid/constitutions with invalid body → 400', async () => {
    const res = await app.request(
      `/api/villages/${villageId}/constitutions`,
      json({ rules: [] }), // min(1) rule violated
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('POST supersede → 201 (revokes old, creates new)', async () => {
    // Create original
    const createRes = await app.request(
      `/api/villages/${villageId}/constitutions`,
      json(VALID_CONSTITUTION),
    );
    const { data: original } = await createRes.json();

    // Supersede
    const newConstitution = {
      rules: [{ description: 'Updated rule', enforcement: 'soft' }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'query_edda'],
    };
    const supersedeRes = await app.request(
      `/api/constitutions/${original.id}/supersede`,
      json(newConstitution),
    );
    expect(supersedeRes.status).toBe(201);
    const supersedeBody = await supersedeRes.json();
    expect(supersedeBody.ok).toBe(true);
    expect(supersedeBody.data.version).toBe(2);
    expect(supersedeBody.data.status).toBe('active');

    // Verify old is superseded
    const oldRes = await app.request(`/api/constitutions/${original.id}`);
    const oldBody = await oldRes.json();
    expect(oldBody.data.status).toBe('superseded');
  });

  it('POST revoke → 200', async () => {
    // Create
    const createRes = await app.request(
      `/api/villages/${villageId}/constitutions`,
      json(VALID_CONSTITUTION),
    );
    const { data: created } = await createRes.json();

    // Revoke
    const revokeRes = await app.request(
      `/api/constitutions/${created.id}/revoke`,
      { method: 'POST' },
    );
    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json();
    expect(revokeBody.ok).toBe(true);

    // Verify revoked
    const getRes = await app.request(`/api/constitutions/${created.id}`);
    const getBody = await getRes.json();
    expect(getBody.data.status).toBe('revoked');
  });
});

// ─── Chiefs ──────────────────────────────────────────────────────────────────

describe('Chiefs routes', () => {
  let app: Hono;
  let villageId: string;

  beforeEach(async () => {
    ({ app } = buildApp());
    // Create village
    const vRes = await app.request('/api/villages', json(VALID_VILLAGE));
    villageId = (await vRes.json()).data.id;
    // Create constitution (required for chief creation)
    await app.request(
      `/api/villages/${villageId}/constitutions`,
      json(VALID_CONSTITUTION),
    );
  });

  it('POST /api/villages/:vid/chiefs → 201', async () => {
    const res = await app.request(
      `/api/villages/${villageId}/chiefs`,
      json(VALID_CHIEF),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toMatch(/^chief-/);
    expect(body.data.name).toBe('TestChief');
    expect(body.data.village_id).toBe(villageId);
    expect(body.data.status).toBe('active');
    expect(body.data.permissions).toContain('dispatch_task');
  });

  it('POST /api/villages/:vid/chiefs with invalid body → 400', async () => {
    const res = await app.request(
      `/api/villages/${villageId}/chiefs`,
      json({ name: '' }), // min(1) violated
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('PATCH /api/chiefs/:id update → 200', async () => {
    // Create chief
    const createRes = await app.request(
      `/api/villages/${villageId}/chiefs`,
      json(VALID_CHIEF),
    );
    const { data: chief } = await createRes.json();

    // Update
    const updateRes = await app.request(
      `/api/chiefs/${chief.id}`,
      jsonPatch({ name: 'UpdatedChief', role: 'New role' }),
    );
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    expect(updateBody.data.name).toBe('UpdatedChief');
    expect(updateBody.data.role).toBe('New role');
    expect(updateBody.data.version).toBe(2);
  });

  it('POST /api/villages/:vid/chiefs with permission exceeding constitution → 400 error', async () => {
    const res = await app.request(
      `/api/villages/${villageId}/chiefs`,
      json({
        name: 'BadChief',
        role: 'Deployer',
        permissions: ['deploy'], // not in constitution's allowed_permissions
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('PERMISSION_EXCEEDS_CONSTITUTION');
  });
});
