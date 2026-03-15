import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema, appendAudit } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry, validateSkillBindings } from './skill-registry';
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

  // === Skill Sharing — DB integration tests ===

  function setupSharingFixture() {
    const t = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
    const a = coordinator.createAgreement(t.id, {
      type: 'resource_sharing',
      parties: [villageA, villageB],
    }, 'h');
    coordinator.approveAgreement(a.id, villageA, 'h');
    coordinator.approveAgreement(a.id, villageB, 'h');

    const skill = skillRegistry.create({
      name: 'shared-skill',
      village_id: villageA,
      definition: { description: 'A shared skill', prompt_template: 'do it', input_schema: {}, output_schema: {} },
    }, 'h');
    skillRegistry.verify(skill.id, 'h');

    return { territory: t, agreement: a, skill };
  }

  it('shareSkill: shared skill appears in getAvailable for target village', () => {
    const { skill } = setupSharingFixture();

    // Before sharing, skill should NOT appear for village B
    const beforeShare = skillRegistry.getAvailable(villageB);
    expect(beforeShare.find((s) => s.id === skill.id)).toBeUndefined();

    coordinator.shareSkill({
      skill_id: skill.id,
      from_village_id: villageA,
      to_village_id: villageB,
    }, 'h');

    // After sharing, skill SHOULD appear for village B
    const afterShare = skillRegistry.getAvailable(villageB);
    expect(afterShare.find((s) => s.id === skill.id)).toBeDefined();
  });

  it('shareSkill: idempotent — sharing twice does not duplicate', () => {
    const { skill } = setupSharingFixture();

    coordinator.shareSkill({ skill_id: skill.id, from_village_id: villageA, to_village_id: villageB }, 'h');
    coordinator.shareSkill({ skill_id: skill.id, from_village_id: villageA, to_village_id: villageB }, 'h');

    // Should appear exactly once
    const available = skillRegistry.getAvailable(villageB);
    const matches = available.filter((s) => s.id === skill.id);
    expect(matches).toHaveLength(1);
  });

  it('shareSkill: dissolve territory revokes skill shares', () => {
    const { territory, skill } = setupSharingFixture();

    coordinator.shareSkill({ skill_id: skill.id, from_village_id: villageA, to_village_id: villageB }, 'h');
    expect(skillRegistry.getAvailable(villageB).find((s) => s.id === skill.id)).toBeDefined();

    coordinator.dissolve(territory.id, 'h');

    // After dissolve, shared skill should no longer appear
    expect(skillRegistry.getAvailable(villageB).find((s) => s.id === skill.id)).toBeUndefined();
  });

  it('shareSkill: shared skill can be bound by target village chief (validateSkillBindings)', () => {
    const { skill } = setupSharingFixture();

    coordinator.shareSkill({ skill_id: skill.id, from_village_id: villageA, to_village_id: villageB }, 'h');

    const result = validateSkillBindings(
      [{ skill_id: skill.id, skill_version: 1 }],
      villageB,
      skillRegistry,
      db,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('shareSkill: revoked share no longer appears in getAvailable', () => {
    const { territory, skill } = setupSharingFixture();

    coordinator.shareSkill({ skill_id: skill.id, from_village_id: villageA, to_village_id: villageB }, 'h');
    expect(skillRegistry.getAvailable(villageB).find((s) => s.id === skill.id)).toBeDefined();

    // Manually revoke the share
    db.prepare("UPDATE skill_shares SET status = 'revoked' WHERE territory_id = ? AND status = 'active'")
      .run(territory.id);

    expect(skillRegistry.getAvailable(villageB).find((s) => s.id === skill.id)).toBeUndefined();
  });

  // === Territory Policy ===

  describe('Territory Policy', () => {
    let territory: ReturnType<typeof coordinator.create>;

    beforeEach(() => {
      territory = coordinator.create({ name: 'Policy Territory', village_ids: [villageA, villageB] }, 'human');
    });

    it('createPolicy: creates active territory policy', () => {
      const policy = coordinator.createPolicy(territory.id, {
        name: 'Shared research rule',
        description: 'All villages must share research findings',
        enforcement: 'soft',
      }, 'human');

      expect(policy.id).toMatch(/^territory-policy-/);
      expect(policy.name).toBe('Shared research rule');
      expect(policy.enforcement).toBe('soft');
      expect(policy.status).toBe('active');
      expect(policy.scope).toEqual(['*']);
    });

    it('createPolicy: hard enforcement policy', () => {
      const policy = coordinator.createPolicy(territory.id, {
        name: 'Budget coordination',
        enforcement: 'hard',
        scope: [villageA],
      }, 'human');

      expect(policy.enforcement).toBe('hard');
      expect(policy.scope).toEqual([villageA]);
    });

    it('createPolicy: rejects on dissolved territory', () => {
      coordinator.dissolve(territory.id, 'human');
      expect(() => coordinator.createPolicy(territory.id, {
        name: 'too late',
      }, 'human')).toThrow('not active');
    });

    it('listPolicies: returns policies for territory', () => {
      coordinator.createPolicy(territory.id, { name: 'p1' }, 'h');
      coordinator.createPolicy(territory.id, { name: 'p2' }, 'h');
      expect(coordinator.listPolicies(territory.id)).toHaveLength(2);
    });

    it('listPolicies: filters by status', () => {
      const p = coordinator.createPolicy(territory.id, { name: 'p1' }, 'h');
      coordinator.revokePolicy(p.id, 'h');
      expect(coordinator.listPolicies(territory.id, { status: 'active' })).toHaveLength(0);
      expect(coordinator.listPolicies(territory.id, { status: 'revoked' })).toHaveLength(1);
    });

    it('revokePolicy: active → revoked', () => {
      const p = coordinator.createPolicy(territory.id, { name: 'p1' }, 'h');
      const revoked = coordinator.revokePolicy(p.id, 'human');
      expect(revoked.status).toBe('revoked');
    });

    it('revokePolicy: already revoked → error', () => {
      const p = coordinator.createPolicy(territory.id, { name: 'p1' }, 'h');
      coordinator.revokePolicy(p.id, 'h');
      expect(() => coordinator.revokePolicy(p.id, 'h')).toThrow('not active');
    });

    it('checkTerritoryPolicies: returns applicable policies for a village', () => {
      coordinator.createPolicy(territory.id, { name: 'global policy', scope: ['*'] }, 'h');
      coordinator.createPolicy(territory.id, { name: 'village A only', scope: [villageA] }, 'h');

      const policiesA = coordinator.checkTerritoryPolicies(villageA);
      expect(policiesA).toHaveLength(2);

      const policiesB = coordinator.checkTerritoryPolicies(villageB);
      expect(policiesB).toHaveLength(1); // 只有 global policy
      expect(policiesB[0].name).toBe('global policy');
    });

    it('checkTerritoryPolicies: no policies for village not in territory', () => {
      coordinator.createPolicy(territory.id, { name: 'test' }, 'h');
      expect(coordinator.checkTerritoryPolicies(villageNoCV)).toHaveLength(0);
    });

    it('dissolve: also revokes policies', () => {
      coordinator.createPolicy(territory.id, { name: 'p1' }, 'h');
      coordinator.dissolve(territory.id, 'human');
      expect(coordinator.listPolicies(territory.id, { status: 'active' })).toHaveLength(0);
      expect(coordinator.listPolicies(territory.id, { status: 'revoked' })).toHaveLength(1);
    });
  });

  // === Add/Remove Village ===

  describe('Add/Remove Village', () => {
    let territory: ReturnType<typeof coordinator.create>;
    let constitutionStore: ConstitutionStore;
    let villageMgr: VillageManager;

    beforeEach(() => {
      territory = coordinator.create({ name: 'Growing Territory', village_ids: [villageA, villageB] }, 'human');
      constitutionStore = new ConstitutionStore(db);
      villageMgr = new VillageManager(db);
    });

    it('addVillage: adds new village to territory', () => {
      const villageC = villageMgr.create({ name: 'Village C', target_repo: 'repoC' }, 'u').id;
      constitutionStore.create(villageC, {
        rules: [{ description: 'ok', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['cross_village'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      const updated = coordinator.addVillage(territory.id, { village_id: villageC }, 'human');
      expect(updated.village_ids).toHaveLength(3);
      expect(updated.village_ids).toContain(villageC);
      expect(updated.version).toBe(2);
    });

    it('addVillage: rejects duplicate', () => {
      expect(() => coordinator.addVillage(territory.id, { village_id: villageA }, 'human'))
        .toThrow('already a member');
    });

    it('addVillage: SI-7 rejects without cross_village', () => {
      expect(() => coordinator.addVillage(territory.id, { village_id: villageNoCV }, 'human'))
        .toThrow('CONSTITUTION_FORBIDS_CROSS_VILLAGE');
    });

    it('removeVillage: removes village and revokes its shares', () => {
      // Need 3 villages to remove one
      const villageC = villageMgr.create({ name: 'Village C', target_repo: 'repoC' }, 'u').id;
      constitutionStore.create(villageC, {
        rules: [{ description: 'ok', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['cross_village'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');
      coordinator.addVillage(territory.id, { village_id: villageC }, 'human');

      const updated = coordinator.removeVillage(territory.id, villageB, 'human');
      expect(updated.village_ids).toHaveLength(2);
      expect(updated.village_ids).not.toContain(villageB);
    });

    it('removeVillage: rejects if village not member', () => {
      expect(() => coordinator.removeVillage(territory.id, 'nonexistent', 'h'))
        .toThrow('not a member');
    });

    it('removeVillage: rejects if would leave < 2 villages', () => {
      expect(() => coordinator.removeVillage(territory.id, villageA, 'h'))
        .toThrow('at least 2 villages');
    });
  });

  // === Cross-Village Metrics ===

  describe('Cross-Village Metrics', () => {
    it('getCrossVillageMetrics: aggregates across villages', () => {
      const territory = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');

      // Insert some loop cycles
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, version, budget_remaining, cost_incurred, iterations, max_iterations, timeout_ms, actions, laws_proposed, laws_enacted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('cycle-1', villageA, 'chief-1', 'manual', 'completed', 1, 90, 10, 1, 10, 300000,
        JSON.stringify([{ status: 'executed' }, { status: 'blocked' }]),
        JSON.stringify(['law-1']), JSON.stringify(['law-1']), now, now);

      db.prepare(`
        INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, version, budget_remaining, cost_incurred, iterations, max_iterations, timeout_ms, actions, laws_proposed, laws_enacted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('cycle-2', villageB, 'chief-2', 'manual', 'completed', 1, 80, 20, 1, 10, 300000,
        JSON.stringify([{ status: 'executed' }]),
        JSON.stringify([]), JSON.stringify([]), now, now);

      const metrics = coordinator.getCrossVillageMetrics(territory.id);
      expect(metrics.territory_id).toBe(territory.id);
      expect(metrics.village_count).toBe(2);
      expect(metrics.total_cycles).toBe(2);
      expect(metrics.total_actions_executed).toBe(2);
      expect(metrics.total_actions_blocked).toBe(1);
      expect(metrics.total_laws_proposed).toBe(1);
      expect(metrics.total_laws_enacted).toBe(1);
      expect(metrics.total_cost_incurred).toBe(30);
      expect(metrics.per_village).toHaveLength(2);
    });

    it('getCrossVillageMetrics: empty territory returns zeros', () => {
      const territory = coordinator.create({ name: 'empty', village_ids: [villageA, villageB] }, 'h');
      const metrics = coordinator.getCrossVillageMetrics(territory.id);
      expect(metrics.total_cycles).toBe(0);
      expect(metrics.total_cost_incurred).toBe(0);
    });

    it('getCrossVillageMetrics: non-existent territory → error', () => {
      expect(() => coordinator.getCrossVillageMetrics('nonexistent')).toThrow('not found');
    });
  });

  // === Cross-Village Audit ===

  describe('Cross-Village Audit', () => {
    it('queryTerritoryAudit: returns audit events across territory', () => {
      const territory = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');

      // territory create already logged an event; add more
      appendAudit(db, 'village', villageA, 'update', { test: true }, 'human');
      appendAudit(db, 'village', villageB, 'update', { test: true }, 'admin');

      const result = coordinator.queryTerritoryAudit(territory.id, { limit: 50, offset: 0 });
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.events.length).toBeGreaterThanOrEqual(3);
    });

    it('queryTerritoryAudit: filters by action', () => {
      const territory = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
      appendAudit(db, 'village', villageA, 'custom_action', {}, 'h');

      const result = coordinator.queryTerritoryAudit(territory.id, { action: 'custom_action', limit: 50, offset: 0 });
      expect(result.events.every((e) => e.action === 'custom_action')).toBe(true);
    });

    it('queryTerritoryAudit: non-existent territory → error', () => {
      expect(() => coordinator.queryTerritoryAudit('x', { limit: 50, offset: 0 })).toThrow('not found');
    });
  });

  // === Shared Precedent Pool ===

  describe('Shared Precedent Pool', () => {
    it('getSharedPrecedents: returns laws across territory villages', () => {
      const territory = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
      // Need an active agreement for precedents to be returned
      const agreement = coordinator.createAgreement(territory.id, {
        type: 'law_template',
        parties: [villageA, villageB],
      }, 'h');
      coordinator.approveAgreement(agreement.id, villageA, 'h');
      coordinator.approveAgreement(agreement.id, villageB, 'h');

      // Insert laws into both villages
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO laws (id, village_id, proposed_by, approved_by, version, status, category, content, risk_level, evidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('law-a1', villageA, 'chief-a', 'human', 1, 'active', 'content',
        JSON.stringify({ description: 'Blog posting rule' }), 'low', '{}', now, now);
      db.prepare(`
        INSERT INTO laws (id, village_id, proposed_by, approved_by, version, status, category, content, risk_level, evidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('law-b1', villageB, 'chief-b', 'human', 1, 'active', 'newsletter',
        JSON.stringify({ description: 'Newsletter schedule' }), 'medium', '{}', now, now);

      const precedents = coordinator.getSharedPrecedents(territory.id);
      expect(precedents).toHaveLength(2);
      expect(precedents.map((p) => p.law_id).sort()).toEqual(['law-a1', 'law-b1']);
    });

    it('getSharedPrecedents: filters by category', () => {
      const territory = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
      const agreement = coordinator.createAgreement(territory.id, {
        type: 'resource_sharing',
        parties: [villageA, villageB],
      }, 'h');
      coordinator.approveAgreement(agreement.id, villageA, 'h');
      coordinator.approveAgreement(agreement.id, villageB, 'h');

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO laws (id, village_id, proposed_by, approved_by, version, status, category, content, risk_level, evidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('law-x', villageA, 'c', 'h', 1, 'active', 'content',
        JSON.stringify({ description: 'content law' }), 'low', '{}', now, now);
      db.prepare(`
        INSERT INTO laws (id, village_id, proposed_by, approved_by, version, status, category, content, risk_level, evidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('law-y', villageB, 'c', 'h', 1, 'active', 'seo',
        JSON.stringify({ description: 'seo law' }), 'low', '{}', now, now);

      const contentOnly = coordinator.getSharedPrecedents(territory.id, { category: 'content' });
      expect(contentOnly).toHaveLength(1);
      expect(contentOnly[0].category).toBe('content');
    });

    it('getSharedPrecedents: no agreements → empty', () => {
      const territory = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
      expect(coordinator.getSharedPrecedents(territory.id)).toHaveLength(0);
    });

    it('getSharedPrecedents: includes rolled_back laws as precedents', () => {
      const territory = coordinator.create({ name: 'test', village_ids: [villageA, villageB] }, 'h');
      const agreement = coordinator.createAgreement(territory.id, {
        type: 'law_template',
        parties: [villageA, villageB],
      }, 'h');
      coordinator.approveAgreement(agreement.id, villageA, 'h');
      coordinator.approveAgreement(agreement.id, villageB, 'h');

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO laws (id, village_id, proposed_by, approved_by, version, status, category, content, risk_level, evidence, effectiveness, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('law-rb', villageA, 'c', 'h', 1, 'rolled_back', 'content',
        JSON.stringify({ description: 'failed experiment' }), 'high', '{}',
        JSON.stringify({ verdict: 'harmful' }), now, now);

      const precedents = coordinator.getSharedPrecedents(territory.id);
      expect(precedents).toHaveLength(1);
      expect(precedents[0].effectiveness_verdict).toBe('harmful');
    });
  });
});
