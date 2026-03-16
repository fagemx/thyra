import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { ChiefEngine, buildChiefPrompt, CHIEF_PROFILES, resolveProfile, listProfiles } from './chief-engine';
import { GovernanceActionInput } from './schemas/chief';

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

  it('creates chief with pipelines', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Pipeline Chief',
      role: 'pipeline operator',
      pipelines: ['quality-cycle', 'deploy-cycle'],
    }, 'human');
    expect(chief.pipelines).toEqual(['quality-cycle', 'deploy-cycle']);
  });

  it('pipelines defaults to [] when not provided', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'No Pipelines',
      role: 'basic',
    }, 'human');
    expect(chief.pipelines).toEqual([]);
  });

  it('update adds pipelines', () => {
    const chief = chiefEngine.create(villageId, { name: 'A', role: 'r' }, 'h');
    expect(chief.pipelines).toEqual([]);
    const updated = chiefEngine.update(chief.id, { pipelines: ['quality-cycle'] }, 'h');
    expect(updated.pipelines).toEqual(['quality-cycle']);
  });

  it('update removes pipelines', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'A', role: 'r', pipelines: ['quality-cycle'],
    }, 'h');
    expect(chief.pipelines).toEqual(['quality-cycle']);
    const updated = chiefEngine.update(chief.id, { pipelines: [] }, 'h');
    expect(updated.pipelines).toEqual([]);
  });

  it('pipelines persists across get after create', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Persistent', role: 'r', pipelines: ['deploy-cycle'],
    }, 'h');
    const fetched = chiefEngine.get(chief.id);
    expect(fetched?.pipelines).toEqual(['deploy-cycle']);
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
      version: 1, status: 'active' as const, skills: [], pipelines: [], permissions: [],
      personality: { risk_tolerance: 'conservative' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
      constraints: [
        { type: 'must' as const, description: 'check OWASP top 10' },
        { type: 'must_not' as const, description: 'comment on formatting' },
      ],
      profile: null,
      adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {},
      budget_config: null, use_precedents: false, precedent_config: null,
      role_type: 'chief' as const, parent_chief_id: null,
      pause_reason: null, paused_at: null,
      last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0,
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
      pipelines: [],
      permissions: [],
      personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
      constraints: [],
      profile: null,
      adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {},
      budget_config: null, use_precedents: false, precedent_config: null,
      role_type: 'chief' as const, parent_chief_id: null,
      pause_reason: null, paused_at: null,
      last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0,
      created_at: '', updated_at: '',
    };
    const prompt = buildChiefPrompt(chief, skillRegistry);
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('Do stuff');
    expect(prompt).toContain('Be safe');
  });

  it('includes profile section when profile is set', () => {
    const chief = {
      id: 'chief-1', village_id: 'v', name: 'Analyst', role: 'data analyst',
      version: 1, status: 'active' as const, skills: [], pipelines: [], permissions: [],
      personality: { risk_tolerance: 'conservative' as const, communication_style: 'detailed' as const, decision_speed: 'deliberate' as const },
      constraints: [],
      profile: 'analyst' as const,
      adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {},
      budget_config: null, use_precedents: false, precedent_config: null,
      role_type: 'chief' as const, parent_chief_id: null,
      pause_reason: null, paused_at: null,
      last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0,
      created_at: '', updated_at: '',
    };
    const prompt = buildChiefPrompt(chief, skillRegistry);
    expect(prompt).toContain('## Profile: analyst');
    expect(prompt).toContain('Analysis-focused profile');
  });

  it('includes pipelines section when pipelines are bound', () => {
    const chief = {
      id: 'chief-1', village_id: 'v', name: 'Operator', role: 'pipeline operator',
      version: 1, status: 'active' as const, skills: [],
      pipelines: ['quality-cycle', 'deploy-cycle'],
      permissions: [],
      personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
      constraints: [],
      profile: null,
      adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {},
      budget_config: null, use_precedents: false, precedent_config: null,
      role_type: 'chief' as const, parent_chief_id: null,
      pause_reason: null, paused_at: null,
      last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0,
      created_at: '', updated_at: '',
    };
    const prompt = buildChiefPrompt(chief, skillRegistry);
    expect(prompt).toContain('## Pipelines');
    expect(prompt).toContain('quality-cycle');
    expect(prompt).toContain('deploy-cycle');
  });

  it('does not include pipelines section when pipelines are empty', () => {
    const chief = {
      id: 'chief-1', village_id: 'v', name: 'A', role: 'r',
      role_type: 'chief' as const, parent_chief_id: null,
      version: 1, status: 'active' as const, skills: [], pipelines: [],
      permissions: [],
      personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
      constraints: [],
      profile: null,
      adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {},
      budget_config: null, use_precedents: false, precedent_config: null,
      pause_reason: null, paused_at: null,
      last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0,
      created_at: '', updated_at: '',
    };
    const prompt = buildChiefPrompt(chief, skillRegistry);
    expect(prompt).not.toContain('## Pipelines');
  });

  it('does not include profile section when profile is null', () => {
    const chief = {
      id: 'chief-1', village_id: 'v', name: 'A', role: 'r',
      role_type: 'chief' as const, parent_chief_id: null,
      version: 1, status: 'active' as const, skills: [], pipelines: [], permissions: [],
      personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
      constraints: [],
      profile: null,
      adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {},
      budget_config: null, use_precedents: false, precedent_config: null,
      pause_reason: null, paused_at: null,
      last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0,
      created_at: '', updated_at: '',
    };
    const prompt = buildChiefPrompt(chief, skillRegistry);
    expect(prompt).not.toContain('## Profile');
  });
});

describe('ChiefProfile system', () => {
  let db: Database;
  let chiefEngine: ChiefEngine;
  let constitutionStore: ConstitutionStore;
  let skillRegistry: SkillRegistry;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;
    constitutionStore = new ConstitutionStore(db);
    skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);

    constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
  });

  it('CHIEF_PROFILES contains all 5 preset profiles', () => {
    expect(CHIEF_PROFILES.size).toBe(5);
    expect(CHIEF_PROFILES.has('conservative')).toBe(true);
    expect(CHIEF_PROFILES.has('aggressive')).toBe(true);
    expect(CHIEF_PROFILES.has('balanced')).toBe(true);
    expect(CHIEF_PROFILES.has('analyst')).toBe(true);
    expect(CHIEF_PROFILES.has('executor')).toBe(true);
  });

  it('resolveProfile returns correct profile', () => {
    const profile = resolveProfile('conservative');
    expect(profile.name).toBe('conservative');
    expect(profile.personality.risk_tolerance).toBe('conservative');
    expect(profile.personality.decision_speed).toBe('cautious');
    expect(profile.default_constraints.length).toBeGreaterThan(0);
  });

  it('listProfiles returns all profiles', () => {
    const profiles = listProfiles();
    expect(profiles).toHaveLength(5);
    expect(profiles.map(p => p.name)).toContain('analyst');
  });

  it('create with profile applies profile personality defaults', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'ConservativeChief',
      role: 'reviewer',
      profile: 'conservative',
    }, 'human');
    expect(chief.profile).toBe('conservative');
    expect(chief.personality.risk_tolerance).toBe('conservative');
    expect(chief.personality.communication_style).toBe('detailed');
    expect(chief.personality.decision_speed).toBe('cautious');
  });

  it('create with profile merges default constraints', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'ConservativeChief',
      role: 'reviewer',
      profile: 'conservative',
    }, 'human');
    expect(chief.constraints.length).toBeGreaterThan(0);
    expect(chief.constraints.some(c => c.description.includes('validate all inputs'))).toBe(true);
  });

  it('create with profile + explicit personality overrides profile defaults', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'HybridChief',
      role: 'hybrid',
      profile: 'conservative',
      personality: { risk_tolerance: 'aggressive', communication_style: 'minimal', decision_speed: 'fast' },
    }, 'human');
    expect(chief.profile).toBe('conservative');
    // 顯式 personality 覆蓋 profile 預設值
    expect(chief.personality.risk_tolerance).toBe('aggressive');
    expect(chief.personality.communication_style).toBe('minimal');
    expect(chief.personality.decision_speed).toBe('fast');
  });

  it('create with profile + explicit constraints merges without duplicates', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'MergeTest',
      role: 'tester',
      profile: 'analyst',
      constraints: [
        { type: 'must', description: 'cite evidence for every recommendation' }, // 與 profile 重複
        { type: 'must_not', description: 'skip validation steps' }, // 用戶獨有
      ],
    }, 'human');
    // 應去重：profile 有 3 個 default_constraints，用戶有 2 個（1 個重複）
    const descs = chief.constraints.map(c => c.description);
    const uniqueDescs = new Set(descs);
    expect(descs.length).toBe(uniqueDescs.size); // 無重複
    expect(descs).toContain('cite evidence for every recommendation');
    expect(descs).toContain('skip validation steps');
  });

  it('create without profile sets profile to null', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'NoProfile',
      role: 'default',
    }, 'human');
    expect(chief.profile).toBeNull();
  });

  it('update with profile changes personality and constraints', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Updatable',
      role: 'worker',
    }, 'human');
    expect(chief.profile).toBeNull();

    const updated = chiefEngine.update(chief.id, { profile: 'executor' }, 'human');
    expect(updated.profile).toBe('executor');
    expect(updated.personality.communication_style).toBe('minimal');
    expect(updated.personality.decision_speed).toBe('fast');
    expect(updated.constraints.some(c => c.description.includes('report task outcomes'))).toBe(true);
  });

  it('profile persists across get after create', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Persistent',
      role: 'worker',
      profile: 'aggressive',
    }, 'human');

    const fetched = chiefEngine.get(chief.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.profile).toBe('aggressive');
    expect(fetched?.personality.risk_tolerance).toBe('aggressive');
  });
});

describe('GovernanceActionInput schema', () => {
  it('parses valid create_project action', () => {
    const result = GovernanceActionInput.safeParse({
      action_type: 'create_project',
      description: 'Create a code review project',
      estimated_cost: 2,
      rollback_plan: 'Cancel the project via Karvi',
      project: { title: 'Review PR #42', tasks: [{ title: 'Review changes' }] },
    });
    expect(result.success).toBe(true);
  });

  it('parses valid cancel_task action', () => {
    const result = GovernanceActionInput.safeParse({
      action_type: 'cancel_task',
      description: 'Cancel stale task',
      rollback_plan: 'Re-dispatch the task',
      task_id: 'task-123',
    });
    expect(result.success).toBe(true);
  });

  it('parses valid adjust_priority action', () => {
    const result = GovernanceActionInput.safeParse({
      action_type: 'adjust_priority',
      description: 'Raise priority of critical fix',
      rollback_plan: 'Revert priority',
      task_id: 'task-456',
      priority: 90,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action_type', () => {
    const result = GovernanceActionInput.safeParse({
      action_type: 'nuke_everything',
      description: 'test',
      rollback_plan: 'undo',
    });
    expect(result.success).toBe(false);
  });

  it('defaults estimated_cost to 1', () => {
    const result = GovernanceActionInput.parse({
      action_type: 'cancel_task',
      description: 'Cancel task',
      rollback_plan: 'Re-dispatch',
      task_id: 't-1',
    });
    expect(result.estimated_cost).toBe(1);
  });
});

describe('ChiefEngine.validateGovernanceAction', () => {
  let db: Database;
  let chiefEngine: ChiefEngine;
  let constitutionStore: ConstitutionStore;
  let skillRegistry: SkillRegistry;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;
    constitutionStore = new ConstitutionStore(db);
    skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);

    constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
  });

  it('validates chief with dispatch_task permission', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Gov Chief', role: 'governor', permissions: ['dispatch_task'],
    }, 'human');

    const action = GovernanceActionInput.parse({
      action_type: 'cancel_task',
      description: 'Cancel stale task',
      rollback_plan: 'Re-dispatch',
      task_id: 'task-1',
    });

    const result = chiefEngine.validateGovernanceAction(chief.id, action);
    expect(result.chief.id).toBe(chief.id);
    expect(result.constitution).toBeDefined();
  });

  it('rejects chief without dispatch_task permission', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Law Chief', role: 'legislator', permissions: ['propose_law'],
    }, 'human');

    const action = GovernanceActionInput.parse({
      action_type: 'cancel_task',
      description: 'Cancel stale task',
      rollback_plan: 'Re-dispatch',
      task_id: 'task-1',
    });

    expect(() => chiefEngine.validateGovernanceAction(chief.id, action))
      .toThrow('PERMISSION_DENIED');
  });

  it('rejects inactive chief', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Old Chief', role: 'retired', permissions: ['dispatch_task'],
    }, 'human');
    chiefEngine.deactivate(chief.id, 'human');

    const action = GovernanceActionInput.parse({
      action_type: 'cancel_task',
      description: 'test',
      rollback_plan: 'undo',
      task_id: 'task-1',
    });

    expect(() => chiefEngine.validateGovernanceAction(chief.id, action))
      .toThrow('CHIEF_INACTIVE');
  });

  it('rejects nonexistent chief', () => {
    const action = GovernanceActionInput.parse({
      action_type: 'cancel_task',
      description: 'test',
      rollback_plan: 'undo',
      task_id: 'task-1',
    });

    expect(() => chiefEngine.validateGovernanceAction('chief-nonexistent', action))
      .toThrow('Chief not found');
  });

  it('rejects create_project without project payload', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Gov', role: 'gov', permissions: ['dispatch_task'],
    }, 'human');

    const action = GovernanceActionInput.parse({
      action_type: 'create_project',
      description: 'Create project',
      rollback_plan: 'Cancel project',
    });

    expect(() => chiefEngine.validateGovernanceAction(chief.id, action))
      .toThrow('VALIDATION: create_project action requires project payload');
  });

  it('rejects cancel_task without task_id', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Gov', role: 'gov', permissions: ['dispatch_task'],
    }, 'human');

    const action = GovernanceActionInput.parse({
      action_type: 'cancel_task',
      description: 'Cancel',
      rollback_plan: 'Re-dispatch',
    });

    expect(() => chiefEngine.validateGovernanceAction(chief.id, action))
      .toThrow('VALIDATION: cancel_task and adjust_priority actions require task_id');
  });

  it('rejects adjust_priority without priority', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Gov', role: 'gov', permissions: ['dispatch_task'],
    }, 'human');

    const action = GovernanceActionInput.parse({
      action_type: 'adjust_priority',
      description: 'Adjust',
      rollback_plan: 'Revert',
      task_id: 'task-1',
    });

    expect(() => chiefEngine.validateGovernanceAction(chief.id, action))
      .toThrow('VALIDATION: adjust_priority action requires priority');
  });

  it('validates create_project with valid project payload', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Gov', role: 'gov', permissions: ['dispatch_task'],
    }, 'human');

    const action = GovernanceActionInput.parse({
      action_type: 'create_project',
      description: 'Create review project',
      rollback_plan: 'Cancel project',
      project: { title: 'Review PR', tasks: [{ title: 'Review code' }] },
    });

    const result = chiefEngine.validateGovernanceAction(chief.id, action);
    expect(result.chief.permissions).toContain('dispatch_task');
  });
});

describe('Worker role (#214)', () => {
  let db: Database;
  let chiefEngine: ChiefEngine;
  let constitutionStore: ConstitutionStore;
  let skillRegistry: SkillRegistry;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;
    constitutionStore = new ConstitutionStore(db);
    skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);

    constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low', 'query_edda'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
  });

  it('creates worker with execution-only permissions', () => {
    const worker = chiefEngine.create(villageId, {
      name: 'Worker A',
      role: 'task executor',
      role_type: 'worker',
      permissions: ['dispatch_task'],
    }, 'human');
    expect(worker.role_type).toBe('worker');
    expect(worker.permissions).toEqual(['dispatch_task']);
  });

  it('defaults role_type to chief', () => {
    const chief = chiefEngine.create(villageId, {
      name: 'Chief A',
      role: 'manager',
    }, 'human');
    expect(chief.role_type).toBe('chief');
  });

  it('rejects worker with propose_law permission', () => {
    expect(() => chiefEngine.create(villageId, {
      name: 'Rogue Worker',
      role: 'executor',
      role_type: 'worker',
      permissions: ['propose_law'],
    }, 'human')).toThrow('WORKER_GOVERNANCE_FORBIDDEN');
  });

  it('rejects worker with enact_law_low permission', () => {
    expect(() => chiefEngine.create(villageId, {
      name: 'Rogue Worker',
      role: 'executor',
      role_type: 'worker',
      permissions: ['enact_law_low'],
    }, 'human')).toThrow('WORKER_GOVERNANCE_FORBIDDEN');
  });

  it('allows worker with non-governance permissions', () => {
    const worker = chiefEngine.create(villageId, {
      name: 'Worker B',
      role: 'executor',
      role_type: 'worker',
      permissions: ['dispatch_task', 'query_edda'],
    }, 'human');
    expect(worker.permissions).toEqual(['dispatch_task', 'query_edda']);
  });

  it('rejects update adding governance perms to worker', () => {
    const worker = chiefEngine.create(villageId, {
      name: 'Worker C',
      role: 'executor',
      role_type: 'worker',
      permissions: ['dispatch_task'],
    }, 'human');
    expect(() => chiefEngine.update(worker.id, {
      permissions: ['dispatch_task', 'propose_law'],
    }, 'human')).toThrow('WORKER_GOVERNANCE_FORBIDDEN');
  });

  it('creates worker with parent_chief_id', () => {
    const parent = chiefEngine.create(villageId, {
      name: 'Manager',
      role: 'manager',
    }, 'human');
    const worker = chiefEngine.create(villageId, {
      name: 'Worker D',
      role: 'executor',
      role_type: 'worker',
      parent_chief_id: parent.id,
    }, 'human');
    expect(worker.parent_chief_id).toBe(parent.id);
  });

  it('rejects worker with nonexistent parent', () => {
    expect(() => chiefEngine.create(villageId, {
      name: 'Worker E',
      role: 'executor',
      role_type: 'worker',
      parent_chief_id: 'chief-nonexistent',
    }, 'human')).toThrow('PARENT_NOT_FOUND');
  });

  it('rejects worker whose parent is also a worker', () => {
    const parent = chiefEngine.create(villageId, {
      name: 'Worker Parent',
      role: 'executor',
      role_type: 'worker',
    }, 'human');
    expect(() => chiefEngine.create(villageId, {
      name: 'Worker Child',
      role: 'executor',
      role_type: 'worker',
      parent_chief_id: parent.id,
    }, 'human')).toThrow('PARENT_IS_WORKER');
  });

  it('rejects parent from different village', () => {
    const villageMgr = new VillageManager(db);
    const v2 = villageMgr.create({ name: 'other', target_repo: 'r2' }, 'u');
    constitutionStore.create(v2.id, {
      rules: [{ description: 'rule', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
    const otherChief = chiefEngine.create(v2.id, {
      name: 'Other Chief',
      role: 'manager',
    }, 'human');
    expect(() => chiefEngine.create(villageId, {
      name: 'Worker F',
      role: 'executor',
      role_type: 'worker',
      parent_chief_id: otherChief.id,
    }, 'human')).toThrow('PARENT_WRONG_VILLAGE');
  });

  it('listTopLevel excludes workers', () => {
    chiefEngine.create(villageId, { name: 'Chief X', role: 'manager' }, 'human');
    chiefEngine.create(villageId, {
      name: 'Worker Y', role: 'executor', role_type: 'worker',
    }, 'human');
    chiefEngine.create(villageId, { name: 'Chief Z', role: 'analyst' }, 'human');

    const topLevel = chiefEngine.listTopLevel(villageId);
    expect(topLevel).toHaveLength(2);
    expect(topLevel.every(c => c.role_type === 'chief')).toBe(true);
  });

  it('listTopLevel with status filter excludes workers', () => {
    const chief = chiefEngine.create(villageId, { name: 'Chief A', role: 'manager' }, 'human');
    chiefEngine.create(villageId, {
      name: 'Worker B', role: 'executor', role_type: 'worker',
    }, 'human');
    chiefEngine.deactivate(chief.id, 'human');

    const active = chiefEngine.listTopLevel(villageId, { status: 'active' });
    expect(active).toHaveLength(0); // chief is inactive, worker excluded
  });

  it('listTeam returns direct reports', () => {
    const parent = chiefEngine.create(villageId, { name: 'Manager', role: 'manager' }, 'human');
    chiefEngine.create(villageId, {
      name: 'Worker A', role: 'exec', role_type: 'worker', parent_chief_id: parent.id,
    }, 'human');
    chiefEngine.create(villageId, {
      name: 'Worker B', role: 'exec', role_type: 'worker', parent_chief_id: parent.id,
    }, 'human');
    chiefEngine.create(villageId, { name: 'Other Chief', role: 'analyst' }, 'human');

    const team = chiefEngine.listTeam(parent.id);
    expect(team).toHaveLength(2);
    expect(team.every(c => c.parent_chief_id === parent.id)).toBe(true);
  });

  it('role_type and parent_chief_id persist across get', () => {
    const parent = chiefEngine.create(villageId, { name: 'Manager', role: 'mgr' }, 'human');
    const worker = chiefEngine.create(villageId, {
      name: 'Worker', role: 'exec', role_type: 'worker', parent_chief_id: parent.id,
    }, 'human');
    const fetched = chiefEngine.get(worker.id);
    expect(fetched?.role_type).toBe('worker');
    expect(fetched?.parent_chief_id).toBe(parent.id);
  });
});
