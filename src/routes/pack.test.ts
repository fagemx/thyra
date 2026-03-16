import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { SkillRegistry } from '../skill-registry';
import { packRoutes } from './pack';

// ── Setup ────────────────────────────────────────────────────

function setup() {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);

  const villageMgr = new VillageManager(db);
  const constitutionStore = new ConstitutionStore(db);
  const skillRegistry = new SkillRegistry(db);
  const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
  const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);

  const app = new Hono();
  app.onError((err, c) => {
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });
  app.route('', packRoutes({ db, villageMgr, constitutionStore, chiefEngine, lawEngine, skillRegistry }));

  return { app, db, villageMgr, skillRegistry };
}

/** 建立已驗證 skill 供測試用 */
function createVerifiedSkill(registry: SkillRegistry, name: string, villageId?: string): string {
  const skill = registry.create(
    {
      name,
      village_id: villageId,
      definition: {
        description: `${name} skill`,
        prompt_template: `Do ${name}`,
        tools_required: [],
        constraints: [],
        examples: [],
      },
    },
    'test',
  );
  registry.verify(skill.id, 'test');
  return skill.id;
}

/** 有效的 Village Pack YAML */
const VALID_YAML = `
pack_version: "0.1"
village:
  name: test-village
  description: A test village
  target_repo: org/repo
constitution:
  rules:
    - description: Must review code
      enforcement: hard
  allowed_permissions:
    - dispatch_task
    - propose_law
    - enact_law_low
  budget:
    max_cost_per_action: 10
    max_cost_per_day: 100
    max_cost_per_loop: 50
chief:
  name: test-chief
  role: code reviewer
  personality:
    risk_tolerance: moderate
    communication_style: concise
    decision_speed: deliberate
  constraints:
    - type: must
      description: always run tests
  permissions:
    - dispatch_task
    - propose_law
    - enact_law_low
skills:
  - code-review
laws:
  - category: testing
    content:
      description: All PRs need tests
      strategy:
        min_coverage: 80
    evidence:
      source: team
      reasoning: quality
`;

// ── Tests ────────────────────────────────────────────────────

describe('POST /api/villages/pack/apply', () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  it('creates village + constitution + chief atomically from valid YAML', async () => {
    createVerifiedSkill(env.skillRegistry, 'code-review');

    const res = await env.app.request('/api/villages/pack/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: VALID_YAML }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.village_id).toBeTruthy();
    expect(body.data.constitution_id).toBeTruthy();
    expect(body.data.chief_id).toBeTruthy();
    expect(body.data.skills).toHaveLength(1);
    expect(body.data.skills[0].name).toBe('code-review');

    // 驗證資料確實寫入 DB
    const village = env.villageMgr.get(body.data.village_id);
    expect(village).toBeTruthy();
    expect(village?.name).toBe('test-village');
  });

  it('returns 400 on invalid YAML syntax', async () => {
    const res = await env.app.request('/api/villages/pack/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: '{{invalid yaml: [' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('YAML_PARSE_ERROR');
  });

  it('returns 400 on schema validation failure (missing required fields)', async () => {
    const invalidYaml = `
pack_version: "0.1"
village:
  name: test
`;
    const res = await env.app.request('/api/villages/pack/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: invalidYaml }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('returns 400 when body has no yaml field', async () => {
    const res = await env.app.request('/api/villages/pack/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'something' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('rolls back on skill resolve failure (unverified skill)', async () => {
    // 不建立 skill，讓 compile 在 Phase 3 失敗
    const res = await env.app.request('/api/villages/pack/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: VALID_YAML }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('COMPILE_ERROR');
    expect(body.error.message).toContain('code-review');

    // 驗證 rollback：village 不應該存在
    const villages = env.villageMgr.list();
    expect(villages).toHaveLength(0);
  });

  it('rolls back on chief permission violation', async () => {
    createVerifiedSkill(env.skillRegistry, 'code-review');

    // chief permissions 超出 constitution allowed_permissions → VP-07 驗證失敗
    const yamlExceedPerms = `
pack_version: "0.1"
village:
  name: perm-test
  description: test
  target_repo: org/repo
constitution:
  rules:
    - description: Rule A
      enforcement: hard
  allowed_permissions:
    - dispatch_task
    - propose_law
  budget:
    max_cost_per_action: 10
    max_cost_per_day: 100
    max_cost_per_loop: 50
chief:
  name: bad-chief
  role: tester
  personality:
    risk_tolerance: moderate
    communication_style: concise
    decision_speed: deliberate
  permissions:
    - dispatch_task
    - propose_law
    - enact_law_low
skills:
  - code-review
laws: []
`;

    const res = await env.app.request('/api/villages/pack/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: yamlExceedPerms }),
    });

    // VP-07 schema validation catches chief permission not in constitution
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);

    // Should be caught at validation level
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toContain('enact_law_low');
  });

  it('returns 400 with empty yaml string', async () => {
    const res = await env.app.request('/api/villages/pack/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
  });
});
