import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { TerritoryCoordinator } from './territory';

describe('TerritoryCoordinator', () => {
  let db: Database;
  let coordinator: TerritoryCoordinator;
  let skillRegistry: SkillRegistry;
  let villageA: string;
  let villageB: string;
  let villageNoCV: string; // village without cross_village permission

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    villageA = villageMgr.create({ name: 'Village A', target_repo: 'repoA' }, 'u').id;
    villageB = villageMgr.create({ name: 'Village B', target_repo: 'repoB' }, 'u').id;
    villageNoCV = villageMgr.create({ name: 'Isolationist', target_repo: 'repoC' }, 'u').id;

    const constitutionStore = new ConstitutionStore(db);
    // A and B allow cross_village
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
    // villageNoCV does NOT allow cross_village
    constitutionStore.create(villageNoCV, {
      rules: [{ description: 'isolate', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    skillRegistry = new SkillRegistry(db);
    coordinator = new TerritoryCoordinator(db, constitutionStore, skillRegistry);
  });

  // === Territory CRUD ===

  it('create: creates territory between two villages', () => {
    const t = coordinator.create({ name: 'AB Alliance', village_ids: [villageA, villageB] }, 'human');
    expect(t.id).toMatch(/^territory-/);
    expect(t.name).toBe('AB Alliance');
    expect(t.village_ids).toEqual([villageA, villageB]);
    expect(t.status).toBe('active');
  });

  it('create: SI-7 rejects when constitution forbids cross_village', () => {
    expect(() => coordinator.create({
      name: 'Bad Alliance',
      village_ids: [villageA, villageNoCV],
    }, 'human')).toThrow('CONSTITUTION_FORBIDS_CROSS_VILLAGE');
  });

  it('create: rejects when village has no constitution', () => {
    const villageMgr = new VillageManager(db);
    const v = villageMgr.create({ name: 'naked', target_repo: 'r' }, 'u');
    expect(() => coordinator.create({
      name: 'test',
      village_ids: [villageA, v.id],
    }, 'human')).toThrow('no active constitution');
  });

  it('get: returns territory by id', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    expect(coordinator.get(t.id)?.name).toBe('test');
  });

  it('get: non-existent → null', () => {
    expect(coordinator.get('xxx')).toBeNull();
  });

  it('list: returns all territories', () => {
    coordinator.create({ name: 't1', village_ids: [villageA, villageB] }, 'h');
    expect(coordinator.list()).toHaveLength(1);
  });

  it('list: filters by status', () => {
    const t = coordinator.create({ name: 't1', village_ids: [villageA, villageB] }, 'h');
    coordinator.dissolve(t.id, 'h');
    expect(coordinator.list({ status: 'active' })).toHaveLength(0);
    expect(coordinator.list({ status: 'dissolved' })).toHaveLength(1);
  });

  it('dissolve: active → dissolved', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const dissolved = coordinator.dissolve(t.id, 'human');
    expect(dissolved.status).toBe('dissolved');
  });

  it('dissolve: revokes all agreements', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');
    coordinator.dissolve(t.id, 'human');
    const agreements = coordinator.listAgreements(t.id);
    expect(agreements[0].status).toBe('revoked');
  });

  // === Agreements ===

  it('createAgreement: creates pending agreement', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');
    expect(a.id).toMatch(/^agreement-/);
    expect(a.status).toBe('pending');
    expect(a.type).toBe('resource_sharing');
  });

  it('createAgreement: rejects non-member village', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    expect(() => coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageNoCV],
    }, 'h')).toThrow('not a member');
  });

  it('approveAgreement: all parties approve → active', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');

    coordinator.approveAgreement(a.id, villageA, 'humanA');
    const approved = coordinator.approveAgreement(a.id, villageB, 'humanB');
    expect(approved.status).toBe('active');
    expect(approved.approved_by[villageA]).toBe('humanA');
    expect(approved.approved_by[villageB]).toBe('humanB');
  });

  it('approveAgreement: partial approval → still pending', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'law_template',
      parties: [villageA, villageB],
    }, 'h');

    const partial = coordinator.approveAgreement(a.id, villageA, 'humanA');
    expect(partial.status).toBe('pending');
  });

  it('approveAgreement: non-party village → error', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');

    expect(() => coordinator.approveAgreement(a.id, villageNoCV, 'h'))
      .toThrow('not a party');
  });

  it('listAgreements: filters by status', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');
    coordinator.approveAgreement(a.id, villageA, 'h');
    coordinator.approveAgreement(a.id, villageB, 'h');

    expect(coordinator.listAgreements(t.id, { status: 'active' })).toHaveLength(1);
    expect(coordinator.listAgreements(t.id, { status: 'pending' })).toHaveLength(0);
  });

  // === Skill Sharing ===

  it('shareSkill: shares verified skill between territories', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');
    coordinator.approveAgreement(a.id, villageA, 'h');
    coordinator.approveAgreement(a.id, villageB, 'h');

    // Create and verify a skill in village A
    const skill = skillRegistry.create({
      name: 'code-review',
      village_id: villageA,
      definition: { description: 'Review code', prompt_template: 'Review this code', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(skill.id, 'h');

    const result = coordinator.shareSkill({
      skill_id: skill.id,
      from_village_id: villageA,
      to_village_id: villageB,
    }, 'h');

    expect(result.shared).toBe(true);
  });

  it('shareSkill: no territory → error', () => {
    const skill = skillRegistry.create({
      name: 'test-skill',
      village_id: villageA,
      definition: { description: 'test', prompt_template: 'test', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(skill.id, 'h');

    expect(() => coordinator.shareSkill({
      skill_id: skill.id,
      from_village_id: villageA,
      to_village_id: villageNoCV,
    }, 'h')).toThrow('No active territory');
  });

  it('shareSkill: no active agreement → error', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    // Agreement created but not approved
    coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');

    const skill = skillRegistry.create({
      name: 'test-skill',
      village_id: villageA,
      definition: { description: 'test', prompt_template: 'test', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(skill.id, 'h');

    expect(() => coordinator.shareSkill({
      skill_id: skill.id,
      from_village_id: villageA,
      to_village_id: villageB,
    }, 'h')).toThrow('No active resource_sharing agreement');
  });

  it('shareSkill: unverified skill → error', () => {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');
    coordinator.approveAgreement(a.id, villageA, 'h');
    coordinator.approveAgreement(a.id, villageB, 'h');

    const skill = skillRegistry.create({
      name: 'draft-skill',
      village_id: villageA,
      definition: { description: 'not verified', prompt_template: 'nv', input_schema: {}, output_schema: {} },
    }, 'h');

    expect(() => coordinator.shareSkill({
      skill_id: skill.id,
      from_village_id: villageA,
      to_village_id: villageB,
    }, 'h')).toThrow('verified');
  });
});
