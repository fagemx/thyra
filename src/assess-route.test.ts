import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { RiskAssessor } from './risk-assessor';
import { assessRoutes } from './routes/assess';

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'propose_law',
    description: 'Test action',
    initiated_by: 'chief-1',
    village_id: 'village-1',
    estimated_cost: 1,
    reason: 'testing',
    rollback_plan: 'revert',
    ...overrides,
  };
}

describe('POST /api/assess — Zod validation', () => {
  let app: Hono;
  let villageId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    initSchema(db);
    const constitutionStore = new ConstitutionStore(db);
    const assessor = new RiskAssessor(db);
    villageId = new VillageManager(db).create({ name: 't', target_repo: 'r' }, 'u').id;
    constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');

    app = new Hono();
    app.route('', assessRoutes(assessor, constitutionStore));
  });

  async function post(body: unknown) {
    const res = await app.request('/api/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  it('happy path: valid action returns 200 with assessment', async () => {
    const { status, json } = await post(makeBody({ village_id: villageId }));
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.level).toBeDefined();
    expect(json.data.budget_check).toBeDefined();
  });

  it('optional fields omitted: only required fields → 200', async () => {
    const body = {
      type: 'propose_law',
      description: 'Test',
      initiated_by: 'chief-1',
      village_id: villageId,
      estimated_cost: 0,
      reason: 'testing',
    };
    const { status, json } = await post(body);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('missing type → 400 VALIDATION', async () => {
    const body = makeBody({ village_id: villageId });
    delete (body as Record<string, unknown>).type;
    const { status, json } = await post(body);
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('missing village_id → 400 VALIDATION', async () => {
    const body = makeBody();
    delete (body as Record<string, unknown>).village_id;
    const { status, json } = await post(body);
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('negative estimated_cost → 400 VALIDATION', async () => {
    const { status, json } = await post(makeBody({ village_id: villageId, estimated_cost: -5 }));
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('empty body → 400 VALIDATION', async () => {
    const { status, json } = await post({});
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('invalid grants_permission value → 400 VALIDATION', async () => {
    const { status, json } = await post(makeBody({
      village_id: villageId,
      grants_permission: ['not_a_real_permission'],
    }));
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('empty string type → 400 VALIDATION', async () => {
    const { status, json } = await post(makeBody({ village_id: villageId, type: '' }));
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('estimated_cost as string → 400 VALIDATION', async () => {
    const { status, json } = await post(makeBody({ village_id: villageId, estimated_cost: 'five' }));
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('VALIDATION');
  });
});
