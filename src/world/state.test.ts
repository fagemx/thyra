import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from '../db';
import { assembleWorldState } from './state';

import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { SkillRegistry } from '../skill-registry';
import { TerritoryCoordinator } from '../territory';


describe('assembleWorldState', () => {
  let db: Database;
  let villageMgr: VillageManager;
  let constitutionStore: ConstitutionStore;
  let chiefEngine: ChiefEngine;
  let lawEngine: LawEngine;
  let skillRegistry: SkillRegistry;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    villageMgr = new VillageManager(db);
    constitutionStore = new ConstitutionStore(db);
    skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    lawEngine = new LawEngine(db, constitutionStore, chiefEngine);

  });

  // --- Helper: 建立最小 constitution ---
  function createConstitution(villageId: string) {
    return constitutionStore.create(villageId, {
      rules: [{ description: 'be good', enforcement: 'soft', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low', 'cross_village'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
  }

  // --- Helper: 直接插入 running cycle（避免 LoopRunner 啟動 async loop） ---
  function insertRunningCycle(villageId: string, chiefId: string): string {
    const id = `cycle-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, version,
        budget_remaining, cost_incurred, iterations, max_iterations, timeout_ms,
        actions, laws_proposed, laws_enacted, created_at, updated_at)
      VALUES (?, ?, ?, 'manual', 'running', 1, 50, 0, 0, 10, 300000, '[]', '[]', '[]', ?, ?)
    `).run(id, villageId, chiefId, now, now);
    return id;
  }

  // === Test 1: 空 village（只有 village，沒有其他實體） ===
  it('assembles empty village with nulls and empty arrays', () => {
    const village = villageMgr.create({ name: 'empty', target_repo: 'r' }, 'u');

    const state = assembleWorldState(db, village.id);

    expect(state.village.id).toBe(village.id);
    expect(state.village.name).toBe('empty');
    expect(state.constitution).toBeNull();
    expect(state.chiefs).toEqual([]);
    expect(state.active_laws).toEqual([]);
    expect(state.skills).toEqual([]);
    expect(state.running_cycles).toEqual([]);
    // assembled_at 是 valid ISO date
    expect(() => new Date(state.assembled_at)).not.toThrow();
    expect(new Date(state.assembled_at).toISOString()).toBe(state.assembled_at);
  });

  // === Test 2: Village 不存在 ===
  it('throws when village does not exist', () => {
    expect(() => assembleWorldState(db, 'nonexistent-id'))
      .toThrow('Village not found: nonexistent-id');
  });

  // === Test 3: 完整 village（有所有實體） ===
  it('assembles village with all entity types', () => {
    const village = villageMgr.create({ name: 'full', target_repo: 'r' }, 'u');
    const constitution = createConstitution(village.id);

    // 建立 verified skill
    const skill = skillRegistry.create({
      name: 'code-review',
      village_id: village.id,
      definition: { description: 'Review code', prompt_template: 'Review', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(skill.id, 'h');

    // 建立 chief（需要 enact_law_low 才能 auto-approve low risk law）
    const chief = chiefEngine.create(village.id, {
      name: 'TestChief',
      role: 'developer',
      permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      skills: [{ skill_id: skill.id, skill_version: 1 }],
    }, 'h');

    // 建立 active law（low risk + enact_law_low → auto approved as active）
    const law = lawEngine.propose(village.id, chief.id, {
      category: 'test-category',
      content: { description: 'test law', strategy: {} },
      evidence: { source: 'test', reasoning: 'testing' },
    });

    // 建立 running cycle
    insertRunningCycle(village.id, chief.id);

    const state = assembleWorldState(db, village.id);

    expect(state.village.id).toBe(village.id);
    expect(state.constitution).not.toBeNull();
    expect(state.constitution!.id).toBe(constitution.id);
    expect(state.chiefs).toHaveLength(1);
    expect(state.chiefs[0].id).toBe(chief.id);
    expect(state.chiefs[0].name).toBe('TestChief');
    expect(state.active_laws).toHaveLength(1);
    expect(state.active_laws[0].id).toBe(law.id);
    expect(state.skills).toHaveLength(1);
    expect(state.skills[0].id).toBe(skill.id);
    expect(state.running_cycles).toHaveLength(1);
    expect(state.running_cycles[0].village_id).toBe(village.id);
  });

  // === Test 4: 只包含 active 狀態 ===
  it('only includes active entities, filters out non-active', () => {
    const village = villageMgr.create({ name: 'mixed', target_repo: 'r' }, 'u');
    const c1 = createConstitution(village.id);

    // 建立 verified skill（給 chief 用）
    const skill = skillRegistry.create({
      name: 'sk1',
      village_id: village.id,
      definition: { description: 'd', prompt_template: 't', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(skill.id, 'h');

    // 2 chiefs: 1 active, 1 inactive
    const chief1 = chiefEngine.create(village.id, {
      name: 'ActiveChief', role: 'dev', permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
    }, 'h');
    const chief2 = chiefEngine.create(village.id, {
      name: 'InactiveChief', role: 'dev', permissions: ['dispatch_task'],
    }, 'h');
    chiefEngine.deactivate(chief2.id, 'h');

    // Active law + proposed law (not active)
    const activeLaw = lawEngine.propose(village.id, chief1.id, {
      category: 'cat-a',
      content: { description: 'active law', strategy: {} },
      evidence: { source: 's', reasoning: 'r' },
    });
    // proposed law (risk_level = high → stays proposed)
    lawEngine.propose(village.id, chief1.id, {
      category: 'cat-b',
      content: { description: 'deploy to production', strategy: {} },
      evidence: { source: 's', reasoning: 'r' },
    });

    // Supersede constitution → old becomes superseded
    const c2 = constitutionStore.supersede(c1.id, {
      rules: [{ description: 'new rule', enforcement: 'soft', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 20, max_cost_per_day: 200, max_cost_per_loop: 100 },
    }, 'human');

    // 1 running cycle + 1 completed cycle (insert directly)
    insertRunningCycle(village.id, chief1.id);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, version,
        budget_remaining, cost_incurred, iterations, max_iterations, timeout_ms,
        actions, laws_proposed, laws_enacted, created_at, updated_at)
      VALUES (?, ?, ?, 'manual', 'completed', 1, 40, 10, 3, 10, 300000, '[]', '[]', '[]', ?, ?)
    `).run('cycle-done', village.id, chief1.id, now, now);

    const state = assembleWorldState(db, village.id);

    // 只有 active constitution（新的 c2）
    expect(state.constitution).not.toBeNull();
    expect(state.constitution!.id).toBe(c2.id);

    // 只有 active chief
    expect(state.chiefs).toHaveLength(1);
    expect(state.chiefs[0].id).toBe(chief1.id);

    // 只有 active laws（不含 proposed 的 high-risk law）
    expect(state.active_laws).toHaveLength(1);
    expect(state.active_laws[0].id).toBe(activeLaw.id);

    // 只有 running cycles（不含 completed）
    expect(state.running_cycles).toHaveLength(1);
    expect(state.running_cycles[0].status).toBe('running');
  });

  // === Test 5: 包含 shared skills ===
  it('includes shared skills from other villages', () => {
    const vA = villageMgr.create({ name: 'Village A', target_repo: 'a' }, 'u');
    const vB = villageMgr.create({ name: 'Village B', target_repo: 'b' }, 'u');

    createConstitution(vA.id);
    createConstitution(vB.id);

    const coordinator = new TerritoryCoordinator(db, constitutionStore, skillRegistry);

    // 在 A 建立 verified skill
    const sharedSkill = skillRegistry.create({
      name: 'shared-analyzer',
      village_id: vA.id,
      definition: { description: 'Analyze', prompt_template: 'Analyze', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(sharedSkill.id, 'h');

    // B 自己的 verified skill
    const ownSkill = skillRegistry.create({
      name: 'own-skill',
      village_id: vB.id,
      definition: { description: 'Own', prompt_template: 'Own', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(ownSkill.id, 'h');

    // 建立 territory + agreement + share
    const territory = coordinator.create({ name: 'AB', village_ids: [vA.id, vB.id] }, 'h');
    const agreement = coordinator.createAgreement(territory.id, {
      type: 'resource_sharing',
      parties: [vA.id, vB.id],
    }, 'h');
    coordinator.approveAgreement(agreement.id, vA.id, 'h');
    coordinator.approveAgreement(agreement.id, vB.id, 'h');
    coordinator.shareSkill({ skill_id: sharedSkill.id, from_village_id: vA.id, to_village_id: vB.id }, 'h');

    const state = assembleWorldState(db, vB.id);

    // B 的 skills 應包含自己的 + shared 的
    const skillIds = state.skills.map((s) => s.id);
    expect(skillIds).toContain(ownSkill.id);
    expect(skillIds).toContain(sharedSkill.id);
  });

  // === Test 6: 多個 running cycles ===
  it('returns multiple running cycles', () => {
    const village = villageMgr.create({ name: 'multi-cycle', target_repo: 'r' }, 'u');
    createConstitution(village.id);

    const chief = chiefEngine.create(village.id, {
      name: 'Chief', role: 'dev', permissions: ['dispatch_task'],
    }, 'h');

    // 插入 2 個 running cycles
    const cycleId1 = insertRunningCycle(village.id, chief.id);
    const cycleId2 = insertRunningCycle(village.id, chief.id);

    const state = assembleWorldState(db, village.id);

    expect(state.running_cycles).toHaveLength(2);
    const ids = state.running_cycles.map((c) => c.id);
    expect(ids).toContain(cycleId1);
    expect(ids).toContain(cycleId2);
  });
});
