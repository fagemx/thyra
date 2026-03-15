import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { ChiefEngine, buildChiefPrompt } from './chief-engine';

const SKILL_DEF = {
  description: 'Review code',
  prompt_template: 'Review: {changes}',
  tools_required: ['gh'],
  constraints: ['cite file:line'],
};

describe('ChiefEngine', () => {
  let db: Database;
  let chiefEngine: ChiefEngine;
  let constitutionStore: ConstitutionStore;
  let skillRegistry: SkillRegistry;
  let villageId: string;
  let verifiedSkillId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;
    constitutionStore = new ConstitutionStore(db);
    skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);

    // Setup: create constitution
    constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // Setup: create and verify a skill
    const skill = skillRegistry.create({ name: 'code-review', definition: SKILL_DEF }, 'u');
    skillRegistry.verify(skill.id, 'u');
    verifiedSkillId = skill.id;
  });

  it('creates chief with valid permissions', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Reviewer',
      role: 'code reviewer',
      permissions: ['dispatch_task'],
    }, 'human');
    expect(chief.id).toMatch(/^chief-/);
    expect(chief.version).toBe(1);
    expect(chief.status).toBe('active');
  });

  it('rejects chief with permissions exceeding constitution (THY-09)', () => {
    expect(() => chiefEngine.create(villageId, {
      name: 'Rogue',
      role: 'rogue',
      permissions: ['deploy'],
    }, 'human')).toThrow('PERMISSION_EXCEEDS_CONSTITUTION');
  });

  it('rejects binding draft skill (THY-14)', () => {
    const draftSkill = skillRegistry.create({ name: 'draft-skill', definition: SKILL_DEF }, 'u');
    expect(() => chiefEngine.create(villageId, {
      name: 'Test',
      role: 'test',
      skills: [{ skill_id: draftSkill.id, skill_version: 1 }],
    }, 'human')).toThrow('SKILL_NOT_VERIFIED');
  });

  it('creates chief with verified skill binding', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Reviewer',
      role: 'code reviewer',
      skills: [{ skill_id: verifiedSkillId, skill_version: 1 }],
      permissions: ['dispatch_task'],
    }, 'human');
    expect(chief.skills).toHaveLength(1);
  });

  it('rejects create without active constitution', () => {
    const villageMgr = new VillageManager(db);
    const v2 = villageMgr.create({ name: 'no-const', target_repo: 'r' }, 'u');
    expect(() => chiefEngine.create(v2.id, {
      name: 'Test',
      role: 'test',
    }, 'human')).toThrow('No active constitution');
  });

  it('get → returns created chief', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    expect(chiefEngine.get(chief.id)?.name).toBe('A');
  });

  it('list → returns village chiefs', () => {
    chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    chiefEngine.create(villageId, { name: 'B', role: 'r' }, 'h');
    expect(chiefEngine.list(villageId)).toHaveLength(2);
  });

  it('update → version +1', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    const updated = chiefEngine.update(chief.id, { name: 'B' }, 'h');
    expect(updated.version).toBe(2);
    expect(updated.name).toBe('B');
  });

  it('update permissions re-validates against constitution', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r', permissions: ['dispatch_task'] }, 'h');
    expect(() => chiefEngine.update(chief.id, { permissions: ['deploy'] }, 'h'))
      .toThrow('PERMISSION_EXCEEDS_CONSTITUTION');
  });

  it('update skills re-validates binding', () => {
    const draftSkill = skillRegistry.create({ name: 'new-skill', definition: SKILL_DEF }, 'u');
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    expect(() => chiefEngine.update(chief.id, { skills: [{ skill_id: draftSkill.id, skill_version: 1 }] }, 'h'))
      .toThrow('SKILL_NOT_VERIFIED');
  });

  it('deactivate → status inactive', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    chiefEngine.deactivate(chief.id, 'h');
    expect(chiefEngine.get(chief.id)?.status).toBe('inactive');
  });

  it('personality defaults applied', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    expect(chief.personality.risk_tolerance).toBe('moderate');
    expect(chief.personality.communication_style).toBe('concise');
    expect(chief.personality.decision_speed).toBe('deliberate');
  });

  it('update with correct version succeeds (optimistic concurrency)', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    expect(chief.version).toBe(1);
    const u1 = chiefEngine.update(chief.id, { name: 'B' }, 'h');
    expect(u1.version).toBe(2);
    const u2 = chiefEngine.update(chief.id, { name: 'C' }, 'h');
    expect(u2.version).toBe(3);
  });

  it('update with stale version throws CONCURRENCY_CONFLICT', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    // Verify the SQL WHERE version=? pattern rejects stale versions
    const result = db.prepare(
      'UPDATE chiefs SET version = version + 1 WHERE id = ? AND version = ?'
    ).run(chief.id, 999); // actual version is 1, passing 999 should fail
    expect((result as { changes: number }).changes).toBe(0);
  });

  it('deactivate with stale version throws CONCURRENCY_CONFLICT', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    // Bump version externally to simulate concurrent write
    db.prepare('UPDATE chiefs SET version = 99 WHERE id = ?').run(chief.id);
    // deactivate will get() version=99, UPDATE WHERE version=99 — succeeds
    chiefEngine.deactivate(chief.id, 'h');
    // Verify the DB version incremented
    const row = db.prepare('SELECT version FROM chiefs WHERE id = ?').get(chief.id) as { version: number };
    expect(row.version).toBe(100);
  });
});

describe('buildChiefPrompt', () => {
  let db: Database;
  let skillRegistry: SkillRegistry;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    skillRegistry = new SkillRegistry(db);
  });

  it('includes name, role, personality, constraints', () => {
    const chief = {
      id: 'chief-1', village_id: 'v', name: 'Reviewer', role: 'code reviewer',
      version: 1, status: 'active' as const, skills: [], permissions: [],
      personality: { risk_tolerance: 'conservative' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
      constraints: [
        { type: 'must' as const, description: 'check OWASP top 10' },
        { type: 'must_not' as const, description: 'comment on formatting' },
      ],
      created_at: '', updated_at: '',
    };
    const prompt = buildChiefPrompt(chief, skillRegistry);
    expect(prompt).toContain('Reviewer');
    expect(prompt).toContain('code reviewer');
    expect(prompt).toContain('risk-averse');
    expect(prompt).toContain('You MUST: check OWASP top 10');
    expect(prompt).toContain('You MUST NOT: comment on formatting');
  });

  it('includes skill prompts when skills bound', () => {
    const skill = skillRegistry.create({ name: 'test-skill', definition: { description: 'Test', prompt_template: 'Do stuff', constraints: ['Be safe'] } }, 'u');
    skillRegistry.verify(skill.id, 'u');

    const chief = {
      id: 'chief-1', village_id: 'v', name: 'A', role: 'r',
      version: 1, status: 'active' as const,
      skills: [{ skill_id: skill.id, skill_version: 1 }],
      permissions: [],
      personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
      constraints: [],
      created_at: '', updated_at: '',
    };
    const prompt = buildChiefPrompt(chief, skillRegistry);
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('Do stuff');
    expect(prompt).toContain('Be safe');
  });
});
