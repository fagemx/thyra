import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore, checkPermission, checkBudget, checkRules, detectRuleViolation } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { SkillRegistry } from './skill-registry';
import type { KarviBridge } from './karvi-bridge';

const RULES = [{ description: 'must review', enforcement: 'hard' as const, scope: ['*'] }];
const PERMS: ['dispatch_task', 'propose_law'] = ['dispatch_task', 'propose_law'];

describe('ConstitutionStore', () => {
  let db: Database;
  let store: ConstitutionStore;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    const mgr = new VillageManager(db);
    villageId = mgr.create({ name: 'test', target_repo: 'r' }, 'u').id;
    store = new ConstitutionStore(db);
  });

  it('creates constitution for village', () => {
    const c = store.create(villageId, {
      rules: RULES,
      allowed_permissions: PERMS,
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
    expect(c.id).toMatch(/^const-/);
    expect(c.version).toBe(1);
    expect(c.status).toBe('active');
    expect(c.rules[0].id).toBe('rule-1');
  });

  it('rejects create when active constitution exists', () => {
    store.create(villageId, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    expect(() => store.create(villageId, { rules: RULES, allowed_permissions: ['deploy'] }, 'h'))
      .toThrow('already has');
  });

  it('get → returns created constitution', () => {
    const c = store.create(villageId, { rules: RULES, allowed_permissions: PERMS }, 'h');
    expect(store.get(c.id)?.version).toBe(1);
  });

  it('getActive → returns active constitution', () => {
    store.create(villageId, { rules: RULES, allowed_permissions: PERMS }, 'h');
    expect(store.getActive(villageId)?.status).toBe('active');
  });

  it('supersede: old superseded, new active, version +1', () => {
    const v1 = store.create(villageId, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    const v2 = store.supersede(v1.id, { rules: [{ description: 'r2', enforcement: 'soft' }], allowed_permissions: ['dispatch_task', 'deploy'] }, 'h');
    expect(v2.version).toBe(2);
    expect(store.get(v1.id)?.status).toBe('superseded');
    expect(store.getActive(villageId)?.id).toBe(v2.id);
  });

  it('supersede chain v1→v2→v3', () => {
    const v1 = store.create(villageId, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    const v2 = store.supersede(v1.id, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    const v3 = store.supersede(v2.id, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    expect(v3.version).toBe(3);
    expect(store.list(villageId)).toHaveLength(3);
  });

  it('revoke: status → revoked', () => {
    const c = store.create(villageId, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    store.revoke(c.id, 'h');
    expect(store.get(c.id)?.status).toBe('revoked');
    expect(store.getActive(villageId)).toBeNull();
  });

  it('list returns all versions descending', () => {
    const v1 = store.create(villageId, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    store.supersede(v1.id, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    const list = store.list(villageId);
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(2);
    expect(list[1].version).toBe(1);
  });

  it('cannot supersede non-active constitution', () => {
    const c = store.create(villageId, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h');
    store.revoke(c.id, 'h');
    expect(() => store.supersede(c.id, { rules: RULES, allowed_permissions: ['dispatch_task'] }, 'h')).toThrow();
  });
});

describe('ConstitutionStore — Karvi budget sync', () => {
  let db: Database;
  let villageId: string;
  let mockSyncBudget: ReturnType<typeof vi.fn>;
  let store: ConstitutionStore;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    villageId = new VillageManager(db).create({ name: 'sync-test', target_repo: 'r' }, 'u').id;
    mockSyncBudget = vi.fn().mockResolvedValue(true);
    const mockBridge = { syncBudgetControls: mockSyncBudget } as unknown as KarviBridge;
    store = new ConstitutionStore(db, mockBridge);
  });

  it('create triggers syncBudgetControls', () => {
    store.create(villageId, {
      rules: RULES,
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');

    expect(mockSyncBudget).toHaveBeenCalledWith(villageId, {
      max_cost_per_action: 10,
      max_cost_per_day: 100,
      max_cost_per_loop: 50,
      max_cost_per_month: 0,
    });
  });

  it('supersede triggers syncBudgetControls with new budget', () => {
    const v1 = store.create(villageId, {
      rules: RULES,
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    mockSyncBudget.mockClear();

    store.supersede(v1.id, {
      rules: RULES,
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 20, max_cost_per_day: 200, max_cost_per_loop: 100 },
    }, 'h');

    expect(mockSyncBudget).toHaveBeenCalledWith(villageId, {
      max_cost_per_action: 20,
      max_cost_per_day: 200,
      max_cost_per_loop: 100,
      max_cost_per_month: 0,
    });
  });

  it('Karvi failure does not break constitution create', () => {
    mockSyncBudget.mockRejectedValue(new Error('connection refused'));

    const c = store.create(villageId, {
      rules: RULES,
      allowed_permissions: ['dispatch_task'],
    }, 'h');

    expect(c.status).toBe('active');
  });

  it('no bridge → no sync (graceful)', () => {
    const noBridgeStore = new ConstitutionStore(db);
    const mgr = new VillageManager(db);
    const v2 = mgr.create({ name: 'v2', target_repo: 'r2' }, 'u').id;

    // Should not throw
    const c = noBridgeStore.create(v2, {
      rules: RULES,
      allowed_permissions: ['dispatch_task'],
    }, 'h');
    expect(c.status).toBe('active');
  });
});

describe('checkPermission', () => {
  let store: ConstitutionStore;
  let villageId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    initSchema(db);
    villageId = new VillageManager(db).create({ name: 't', target_repo: 'r' }, 'u').id;
    store = new ConstitutionStore(db);
  });

  it('returns true for allowed permission', () => {
    const c = store.create(villageId, { rules: [{ description: 'r', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    expect(checkPermission(c, 'dispatch_task')).toBe(true);
  });

  it('returns false for disallowed permission', () => {
    const c = store.create(villageId, { rules: [{ description: 'r', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    expect(checkPermission(c, 'deploy')).toBe(false);
  });
});

describe('checkBudget', () => {
  let store: ConstitutionStore;
  let villageId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    initSchema(db);
    villageId = new VillageManager(db).create({ name: 't', target_repo: 'r' }, 'u').id;
    store = new ConstitutionStore(db);
  });

  it('within limit → true', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 3, 'per_action')).toBe(true);
  });

  it('over limit → false', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 10, 'per_action')).toBe(false);
  });

  it('per_day: within daily limit → true', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 30, 'per_day')).toBe(true);
  });

  it('per_day: accumulated cost exceeds daily limit → false', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 51, 'per_day')).toBe(false);
  });

  it('per_day: exactly at daily limit boundary → true', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 50, 'per_day')).toBe(true);
  });

  it('per_loop: within loop limit → true', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 20, 'per_loop')).toBe(true);
  });

  it('per_loop: accumulated cost exceeds loop limit → false', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 26, 'per_loop')).toBe(false);
  });
});

describe('checkRules', () => {
  let db: Database;
  let store: ConstitutionStore;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    store = new ConstitutionStore(db);
    villageId = new VillageManager(db).create({ name: 'rules-test', target_repo: 'r' }, 'u').id;
  });

  it('returns violated rules when actionText matches negation rule', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'must not skip review', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'skip review for hotfix');
    expect(result.allowed).toBe(false);
    expect(result.violated).toHaveLength(1);
    expect(result.violated[0].id).toBe('R1');
  });

  it('returns allowed when no violation detected', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'must review all PRs', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'add linting step');
    expect(result.allowed).toBe(true);
    expect(result.violated).toHaveLength(0);
  });

  it('skips out-of-scope rules', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'never auto-deploy', enforcement: 'hard', scope: ['chief-2'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'auto-deploy to production');
    expect(result.allowed).toBe(true);
    expect(result.violated).toHaveLength(0);
  });

  it('without actionText returns allowed (backward compatible)', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'never auto-deploy', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1');
    expect(result.allowed).toBe(true);
    expect(result.violated).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('hard rule violation blocks action', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'must not delete production data', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'delete production data');
    expect(result.allowed).toBe(false);
    expect(result.violated).toHaveLength(1);
    expect(result.violated[0].id).toBe('R1');
    expect(result.violated[0].enforcement).toBe('hard');
    expect(result.warnings).toHaveLength(0);
  });

  it('soft rule violation warns but allows action', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'must not skip tests', enforcement: 'soft', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'skip tests for hotfix');
    expect(result.allowed).toBe(true);
    expect(result.violated).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].id).toBe('R1');
    expect(result.warnings[0].enforcement).toBe('soft');
  });

  it('mixed hard and soft: hard blocks, soft warns', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'never skip review', enforcement: 'hard', scope: ['*'] },
        { id: 'R2', description: 'must not skip tests', enforcement: 'soft', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'skip review and skip tests');
    expect(result.allowed).toBe(false);
    expect(result.violated).toHaveLength(1);
    expect(result.violated[0].id).toBe('R1');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].id).toBe('R2');
  });

  it('scope filtering: only checks rules matching chiefId or wildcard', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'never delete files', enforcement: 'hard', scope: ['chief-1'] },
        { id: 'R2', description: 'never delete files', enforcement: 'hard', scope: ['chief-2'] },
        { id: 'R3', description: 'never delete files', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'delete files from disk');
    expect(result.allowed).toBe(false);
    // R1 (chief-1 scope) and R3 (wildcard) should be violated, R2 (chief-2) skipped
    expect(result.violated).toHaveLength(2);
    const ids = result.violated.map((r) => r.id);
    expect(ids).toContain('R1');
    expect(ids).toContain('R3');
    expect(ids).not.toContain('R2');
  });

  it('no rules violated passes with empty violations and warnings', () => {
    const c = store.create(villageId, {
      rules: [
        { id: 'R1', description: 'must not delete data', enforcement: 'hard', scope: ['*'] },
        { id: 'R2', description: 'must not skip review', enforcement: 'soft', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    const result = checkRules(c, 'chief-1', 'add linting step');
    expect(result.allowed).toBe(true);
    expect(result.violated).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('detectRuleViolation', () => {
  it('detects "may not" negation', () => {
    expect(detectRuleViolation('may not deploy to production', 'deploy to production')).toBe(true);
  });

  it('detects "will not" negation', () => {
    expect(detectRuleViolation('will not bypass approval', 'bypass approval process')).toBe(true);
  });

  it('detects "shall not" negation', () => {
    expect(detectRuleViolation('shall not modify config', 'modify config files')).toBe(true);
  });

  it('detects "cannot" negation', () => {
    expect(detectRuleViolation('cannot delete records', 'delete old records')).toBe(true);
  });

  it('uses word boundaries to avoid false positives', () => {
    // "data" should not match "database"
    expect(detectRuleViolation('must not delete data', 'update database schema')).toBe(false);
  });

  it('word boundary matches exact words', () => {
    expect(detectRuleViolation('must not delete data', 'delete user data')).toBe(true);
  });

  it('positive rule: skip triggers violation', () => {
    expect(detectRuleViolation('must review all PRs', 'skip review for hotfix')).toBe(true);
  });

  it('positive rule: without triggers violation', () => {
    expect(detectRuleViolation('must review all PRs', 'merge without review')).toBe(true);
  });

  it('positive rule: unrelated action does not violate', () => {
    expect(detectRuleViolation('must review all PRs', 'add linting step')).toBe(false);
  });

  it('no matching pattern returns false', () => {
    expect(detectRuleViolation('prefer short functions', 'wrote a long function')).toBe(false);
  });
});

describe('supersede → chief permission cascade (THY-09)', () => {
  let db: Database;
  let constitutionStore: ConstitutionStore;
  let chiefEngine: ChiefEngine;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    const mgr = new VillageManager(db);
    villageId = mgr.create({ name: 'cascade-test', target_repo: 'r' }, 'u').id;
    constitutionStore = new ConstitutionStore(db);
    const skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
  });

  it('narrowed constitution rejects new chief with removed permission', () => {
    // 1. Constitution with permissions [dispatch_task, propose_law, deploy]
    const v1 = constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'deploy'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // 2. Create chief with permissions [dispatch_task, propose_law]
    chiefEngine.create(villageId, {
      name: 'Worker-A',
      role: 'deployer',
      permissions: ['dispatch_task', 'propose_law'],
    }, 'human');

    // 3. Supersede constitution with only [dispatch_task]
    constitutionStore.supersede(v1.id, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // 4. Creating a new chief with propose_law should be rejected
    expect(() => chiefEngine.create(villageId, {
      name: 'Worker-B',
      role: 'reviewer',
      permissions: ['propose_law'],
    }, 'human')).toThrow('PERMISSION_EXCEEDS_CONSTITUTION');
  });

  it('narrowed constitution rejects chief update adding removed permission', () => {
    // 1. Constitution with permissions [dispatch_task, propose_law, deploy]
    const v1 = constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'deploy'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // 2. Create chief with permissions [dispatch_task, propose_law]
    const chief = chiefEngine.create(villageId, {
      name: 'Worker-A',
      role: 'deployer',
      permissions: ['dispatch_task', 'propose_law'],
    }, 'human');

    // 3. Supersede constitution with only [dispatch_task]
    constitutionStore.supersede(v1.id, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // 4. Updating existing chief to add propose_law should be rejected
    expect(() => chiefEngine.update(chief.id, {
      permissions: ['dispatch_task', 'propose_law'],
    }, 'human')).toThrow('PERMISSION_EXCEEDS_CONSTITUTION');
  });

  it('narrowed constitution still allows chief create with remaining permission', () => {
    const v1 = constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'deploy'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    constitutionStore.supersede(v1.id, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // Creating chief with only dispatch_task (still allowed) should succeed
    const chief = chiefEngine.create(villageId, {
      name: 'Worker-C',
      role: 'runner',
      permissions: ['dispatch_task'],
    }, 'human');
    expect(chief.status).toBe('active');
    expect(chief.permissions).toEqual(['dispatch_task']);
  });

  it('narrowed constitution rejects deploy after it was removed', () => {
    const v1 = constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'deploy'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // Chief created with deploy under original constitution
    const chief = chiefEngine.create(villageId, {
      name: 'Deployer',
      role: 'deployer',
      permissions: ['dispatch_task', 'deploy'],
    }, 'human');
    expect(chief.permissions).toContain('deploy');

    // Supersede: remove deploy
    constitutionStore.supersede(v1.id, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    // New chief requesting deploy should fail
    expect(() => chiefEngine.create(villageId, {
      name: 'Deployer-2',
      role: 'deployer',
      permissions: ['deploy'],
    }, 'human')).toThrow('PERMISSION_EXCEEDS_CONSTITUTION');

    // Updating existing chief to keep deploy should also fail
    expect(() => chiefEngine.update(chief.id, {
      permissions: ['dispatch_task', 'deploy'],
    }, 'human')).toThrow('PERMISSION_EXCEEDS_CONSTITUTION');
  });
});
