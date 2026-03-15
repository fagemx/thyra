import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { WorldManager } from './world-manager';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { SkillRegistry } from './skill-registry';
import type { WorldChange } from './schemas/world-change';
import type { Village } from './village-manager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  const sr = new SkillRegistry(db);
  const ce = new ChiefEngine(db, cs, sr);
  const wm = new WorldManager(db);
  return { db, vm, cs, ce, wm };
}

function createVillage(vm: VillageManager): Village {
  return vm.create({
    name: 'World Test Village',
    target_repo: 'test/repo',
  }, 'test-actor');
}

function createConstitution(cs: ConstitutionStore, villageId: string) {
  return cs.create(villageId, {
    rules: [{ id: 'r1', description: 'test rule', enforcement: 'hard' as const }],
    allowed_permissions: ['dispatch_task', 'enact_law_low'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'test-actor');
}

function makeConstitutionChange(): WorldChange {
  return {
    type: 'constitution.supersede',
    rules: [{ description: 'new rule', enforcement: 'hard' as const, scope: ['*'] }],
    allowed_permissions: ['dispatch_task', 'enact_law_low'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    actor: 'test-actor',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorldManager', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let _ce: ChiefEngine;
  let wm: WorldManager;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
    _ce = s.ce;
    wm = s.wm;
  });

  // -------------------------------------------------------------------------
  // getState
  // -------------------------------------------------------------------------

  describe('getState', () => {
    it('should return WorldState for a village', () => {
      const village = createVillage(vm);
      const state = wm.getState(village.id);
      expect(state.village.id).toBe(village.id);
      expect(state.constitution).toBeNull();
      expect(state.chiefs).toHaveLength(0);
    });

    it('should throw for non-existent village', () => {
      expect(() => wm.getState('nonexistent')).toThrow('Village not found');
    });
  });

  // -------------------------------------------------------------------------
  // propose (dry-run judge)
  // -------------------------------------------------------------------------

  describe('propose', () => {
    it('should allow valid constitution.supersede', () => {
      const village = createVillage(vm);
      const result = wm.propose(village.id, makeConstitutionChange());
      expect(result.allowed).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('should reject chief.appoint without constitution', () => {
      const village = createVillage(vm);
      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'TestChief',
        role: 'operator',
        permissions: ['dispatch_task'],
        skills: [],
      };
      const result = wm.propose(village.id, change);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('SI-1'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // apply — normal flow
  // -------------------------------------------------------------------------

  describe('apply', () => {
    it('should apply constitution.supersede and return ApplyResult', () => {
      const village = createVillage(vm);
      const result = wm.apply(village.id, makeConstitutionChange(), 'initial constitution');

      expect(result.applied).toBe(true);
      expect(result.judge_result.allowed).toBe(true);
      expect(result.snapshot_before).toMatch(/^snap_/);
      expect(result.diff).not.toBeNull();
      expect(result.diff?.constitution?.action).toBe('created');
      expect(result.state_after).not.toBeNull();
      expect(result.state_after?.constitution).not.toBeNull();
    });

    it('should write audit_log on successful apply', () => {
      const village = createVillage(vm);
      wm.apply(village.id, makeConstitutionChange());

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'world' AND action = 'change_applied'"
      ).all() as { payload: string }[];
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const payload = JSON.parse(logs[0].payload);
      expect(payload.change_type).toBe('constitution.supersede');
    });

    it('should apply chief.appoint after constitution exists', () => {
      const village = createVillage(vm);
      createConstitution(cs, village.id);

      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'TestChief',
        role: 'operator',
        permissions: ['dispatch_task'],
        skills: [],
      };
      const result = wm.apply(village.id, change);
      expect(result.applied).toBe(true);
      expect(result.state_after?.chiefs).toHaveLength(1);
    });

    it('should apply village.update change', () => {
      const village = createVillage(vm);
      const change: WorldChange = {
        type: 'village.update',
        name: 'Updated Village',
        description: 'new desc',
      };
      const result = wm.apply(village.id, change);
      expect(result.applied).toBe(true);
      expect(result.state_after?.village.name).toBe('Updated Village');
    });
  });

  // -------------------------------------------------------------------------
  // apply — judge rejection path
  // -------------------------------------------------------------------------

  describe('apply (rejection)', () => {
    it('should reject and not apply when judge denies', () => {
      const village = createVillage(vm);
      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'BadChief',
        role: 'rogue',
        permissions: ['dispatch_task'],
        skills: [],
      };
      const result = wm.apply(village.id, change);
      expect(result.applied).toBe(false);
      expect(result.judge_result.allowed).toBe(false);
      expect(result.snapshot_before).toMatch(/^snap_/);
      expect(result.diff).toBeNull();
      expect(result.state_after).toBeNull();
    });

    it('should write audit_log on rejection', () => {
      const village = createVillage(vm);
      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'BadChief',
        role: 'rogue',
        permissions: ['dispatch_task'],
        skills: [],
      };
      wm.apply(village.id, change);

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'world' AND action = 'change_rejected'"
      ).all() as { payload: string }[];
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const payload = JSON.parse(logs[0].payload);
      expect(payload.change_type).toBe('chief.appoint');
      expect(payload.reasons.length).toBeGreaterThan(0);
    });

    it('should reject chief with unauthorized permissions', () => {
      const village = createVillage(vm);
      createConstitution(cs, village.id);

      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'OverpoweredChief',
        role: 'admin',
        permissions: ['dispatch_task', 'deploy'],
        skills: [],
      };
      const result = wm.apply(village.id, change);
      expect(result.applied).toBe(false);
      expect(result.judge_result.legality_check).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // rollback
  // -------------------------------------------------------------------------

  describe('rollback', () => {
    it('should rollback to a previous snapshot', () => {
      const village = createVillage(vm);
      createConstitution(cs, village.id);

      // 拍攝初始 snapshot
      const snapId = wm.snapshot(village.id, 'manual');

      // 任命 chief（直接寫 DB）
      _ce.create(village.id, {
        name: 'Chief1',
        role: 'operator',
        permissions: ['dispatch_task'],
        skills: [],
      }, 'test-actor');

      // rollback
      const result = wm.rollback(village.id, snapId, 'testing rollback');
      expect(result.success).toBe(true);
      expect(result.snapshot_id).toBe(snapId);
      expect(result.rollback_snapshot_id).toMatch(/^snap_/);
      expect(result.reason).toBe('testing rollback');
    });

    it('should throw for non-existent snapshot', () => {
      const village = createVillage(vm);
      expect(() => wm.rollback(village.id, 'snap_nonexistent', 'test'))
        .toThrow('Snapshot not found');
    });

    it('should throw for mismatched village', () => {
      const v1 = createVillage(vm);
      const v2 = vm.create({ name: 'Other Village', target_repo: 'test/other' }, 'test-actor');
      const snapId = wm.snapshot(v1.id, 'manual');

      expect(() => wm.rollback(v2.id, snapId, 'wrong village'))
        .toThrow(/belongs to village/);
    });
  });

  // -------------------------------------------------------------------------
  // snapshot
  // -------------------------------------------------------------------------

  describe('snapshot', () => {
    it('should create a snapshot and return ID', () => {
      const village = createVillage(vm);
      const snapId = wm.snapshot(village.id, 'manual');
      expect(snapId).toMatch(/^snap_/);
    });

    it('should create multiple snapshots with different triggers', () => {
      const village = createVillage(vm);
      const snap1 = wm.snapshot(village.id, 'manual');
      const snap2 = wm.snapshot(village.id, 'pre_change');
      const snap3 = wm.snapshot(village.id, 'cycle_end');

      expect(snap1).not.toBe(snap2);
      expect(snap2).not.toBe(snap3);

      // 驗證 DB 有 3 筆
      const count = db.prepare(
        'SELECT COUNT(*) as cnt FROM world_snapshots WHERE village_id = ?'
      ).get(village.id) as { cnt: number };
      expect(count.cnt).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // verifyContinuity
  // -------------------------------------------------------------------------

  describe('verifyContinuity', () => {
    it('should return empty report for village with no snapshots', () => {
      const village = createVillage(vm);
      const report = wm.verifyContinuity(village.id);
      expect(report.village_id).toBe(village.id);
      expect(report.total_snapshots).toBe(0);
      expect(report.all_consistent).toBe(true);
      expect(report.steps).toHaveLength(0);
    });

    it('should verify continuity across multiple snapshots', () => {
      const village = createVillage(vm);
      createConstitution(cs, village.id);

      wm.snapshot(village.id, 'manual');

      // 任命 chief → 拍第二個 snapshot
      _ce.create(village.id, {
        name: 'Chief1',
        role: 'operator',
        permissions: ['dispatch_task'],
        skills: [],
      }, 'test-actor');
      wm.snapshot(village.id, 'manual');

      const report = wm.verifyContinuity(village.id);
      expect(report.village_id).toBe(village.id);
      expect(report.total_snapshots).toBe(2);
      expect(report.steps).toHaveLength(2);
      expect(report.all_consistent).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // listPendingChanges
  // -------------------------------------------------------------------------

  describe('listPendingChanges', () => {
    it('should return empty array (Phase 2 placeholder)', () => {
      const village = createVillage(vm);
      const pending = wm.listPendingChanges(village.id);
      expect(pending).toEqual([]);
    });
  });
});
