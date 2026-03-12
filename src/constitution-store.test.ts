import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore, checkPermission, checkBudget, checkRules } from './constitution-store';
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
  });
});
