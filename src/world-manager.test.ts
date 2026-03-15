import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { WorldManager } from './world-manager';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { SkillRegistry } from './skill-registry';
import type { WorldChange } from './schemas/world-change';
import type { Village } from './village-manager';
import type { EddaBridge } from './edda-bridge';
import type { KarviBridge } from './karvi-bridge';

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

  // -------------------------------------------------------------------------
  // EddaBridge integration (#185)
  // -------------------------------------------------------------------------

  describe('EddaBridge integration', () => {
    function createMockEddaBridge(): EddaBridge {
      return {
        recordDecision: vi.fn().mockResolvedValue({ event_id: 'evt-mock' }),
      } as unknown as EddaBridge;
    }

    it('apply() should call recordDecision on EddaBridge', () => {
      const mockEdda = createMockEddaBridge();
      const wmWithEdda = new WorldManager(db, mockEdda);
      const village = createVillage(vm);

      wmWithEdda.apply(village.id, makeConstitutionChange(), 'test reason');

      expect(mockEdda.recordDecision).toHaveBeenCalledTimes(1);
      const call = (mockEdda.recordDecision as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(call.domain).toBe('world');
      expect((call.aspect as string)).toContain('.change');
      expect(call.value).toBe('constitution.supersede');
    });

    it('apply() without EddaBridge still works', () => {
      const wmNoEdda = new WorldManager(db);
      const village = createVillage(vm);

      const result = wmNoEdda.apply(village.id, makeConstitutionChange());
      expect(result.applied).toBe(true);
    });

    it('rollback() should call recordDecision on EddaBridge', () => {
      const mockEdda = createMockEddaBridge();
      const wmWithEdda = new WorldManager(db, mockEdda);
      const village = createVillage(vm);
      createConstitution(cs, village.id);

      const snapId = wmWithEdda.snapshot(village.id, 'manual');
      wmWithEdda.rollback(village.id, snapId, 'test rollback');

      expect(mockEdda.recordDecision).toHaveBeenCalledTimes(1);
      const call = (mockEdda.recordDecision as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(call.domain).toBe('world');
      expect((call.aspect as string)).toContain('.rollback');
      expect(call.value).toBe(snapId);
    });

    it('EddaBridge failure should not crash apply (THY-06)', () => {
      const mockEdda = createMockEddaBridge();
      (mockEdda.recordDecision as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Edda offline'));
      const wmWithEdda = new WorldManager(db, mockEdda);
      const village = createVillage(vm);

      // apply 應正常完成，不被 Edda 錯誤影響
      const result = wmWithEdda.apply(village.id, makeConstitutionChange());
      expect(result.applied).toBe(true);
      expect(mockEdda.recordDecision).toHaveBeenCalledTimes(1);
    });

    it('EddaBridge failure should not crash rollback (THY-06)', () => {
      const mockEdda = createMockEddaBridge();
      (mockEdda.recordDecision as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Edda offline'));
      const wmWithEdda = new WorldManager(db, mockEdda);
      const village = createVillage(vm);
      createConstitution(cs, village.id);

      const snapId = wmWithEdda.snapshot(village.id, 'manual');
      const result = wmWithEdda.rollback(village.id, snapId, 'test rollback');
      expect(result.success).toBe(true);
      expect(mockEdda.recordDecision).toHaveBeenCalledTimes(1);
    });

    it('apply() rejection should not call recordDecision', () => {
      const mockEdda = createMockEddaBridge();
      const wmWithEdda = new WorldManager(db, mockEdda);
      const village = createVillage(vm);

      // chief.appoint without constitution → rejected
      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'BadChief',
        role: 'rogue',
        permissions: ['dispatch_task'],
        skills: [],
      };
      const result = wmWithEdda.apply(village.id, change);
      expect(result.applied).toBe(false);
      expect(mockEdda.recordDecision).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Karvi dispatch integration (#186)
  // -------------------------------------------------------------------------

  describe('Karvi dispatch', () => {
    /** 等待 microtask queue flush（fire-and-forget 完成） */
    const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 10));

    function makeMockKarviBridge(): KarviBridge {
      return {
        dispatchSingleTask: vi.fn().mockResolvedValue({ dispatched: true, planId: 'plan-1' }),
      } as unknown as KarviBridge;
    }

    function createChiefForVillage(villageId: string) {
      const sr2 = new SkillRegistry(db);
      const ce2 = new ChiefEngine(db, cs, sr2);
      return ce2.create(villageId, {
        name: 'TestChief',
        role: 'operator',
        permissions: ['dispatch_task'],
        skills: [],
      }, 'test-actor');
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should dispatch law.propose to Karvi after successful apply', async () => {
      const mockBridge = makeMockKarviBridge();
      const wmWithKarvi = new WorldManager(db, undefined, mockBridge);
      const village = createVillage(vm);
      createConstitution(cs, village.id);
      const chief = createChiefForVillage(village.id);

      const change: WorldChange = {
        type: 'law.propose',
        proposed_by: chief.id,
        category: 'operational',
        content: { rule: 'test' },
        risk_level: 'low',
      };

      const result = wmWithKarvi.apply(village.id, change);
      expect(result.applied).toBe(true);

      await flushMicrotasks();
      expect(mockBridge.dispatchSingleTask).toHaveBeenCalledTimes(1);

      const call = (mockBridge.dispatchSingleTask as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('law.propose');
    });

    it('should dispatch cycle.start to Karvi after successful apply', async () => {
      const mockBridge = makeMockKarviBridge();
      const wmWithKarvi = new WorldManager(db, undefined, mockBridge);
      const village = createVillage(vm);
      createConstitution(cs, village.id);
      const chief = createChiefForVillage(village.id);

      const change: WorldChange = {
        type: 'cycle.start',
        chief_id: chief.id,
        trigger: 'manual',
        max_iterations: 5,
        timeout_ms: 10000,
      };

      const result = wmWithKarvi.apply(village.id, change);
      expect(result.applied).toBe(true);

      await flushMicrotasks();
      expect(mockBridge.dispatchSingleTask).toHaveBeenCalledTimes(1);

      const call = (mockBridge.dispatchSingleTask as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('cycle.start');
    });

    it('should NOT dispatch for non-executable change types', () => {
      const mockBridge = makeMockKarviBridge();
      const wmWithKarvi = new WorldManager(db, undefined, mockBridge);
      const village = createVillage(vm);

      // constitution.supersede 不需要 Karvi 執行
      wmWithKarvi.apply(village.id, makeConstitutionChange());
      expect(mockBridge.dispatchSingleTask).not.toHaveBeenCalled();
    });

    it('should work without KarviBridge (no dispatch)', () => {
      const wmNoKarvi = new WorldManager(db);
      const village = createVillage(vm);
      createConstitution(cs, village.id);
      const chief = createChiefForVillage(village.id);

      const change: WorldChange = {
        type: 'law.propose',
        proposed_by: chief.id,
        category: 'operational',
        content: { rule: 'test' },
        risk_level: 'low',
      };

      // 沒有 KarviBridge，不應 crash
      const result = wmNoKarvi.apply(village.id, change);
      expect(result.applied).toBe(true);
    });

    it('should not crash when Karvi dispatch fails (THY-06 graceful degradation)', async () => {
      const failingBridge = {
        dispatchSingleTask: vi.fn().mockRejectedValue(new Error('Karvi unreachable')),
      } as unknown as KarviBridge;
      const wmFailing = new WorldManager(db, undefined, failingBridge);
      const village = createVillage(vm);
      createConstitution(cs, village.id);
      const chief = createChiefForVillage(village.id);

      const change: WorldChange = {
        type: 'law.propose',
        proposed_by: chief.id,
        category: 'operational',
        content: { rule: 'test' },
        risk_level: 'low',
      };

      // apply 不應 throw
      const result = wmFailing.apply(village.id, change);
      expect(result.applied).toBe(true);

      // 等 fire-and-forget 完成
      await flushMicrotasks();
      expect(failingBridge.dispatchSingleTask).toHaveBeenCalledTimes(1);

      // 應寫入 karvi_dispatch_failed audit log
      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'world' AND action = 'karvi_dispatch_failed'"
      ).all() as { payload: string }[];
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const payload = JSON.parse(logs[0].payload);
      expect(payload.change_type).toBe('law.propose');
      expect(payload.error).toBe('Karvi unreachable');
    });
  });
});
