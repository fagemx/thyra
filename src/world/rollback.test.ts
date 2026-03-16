import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { rollbackChange, applyToDb } from './rollback';
import { snapshotWorldState, loadSnapshot } from './snapshot';
import { assembleWorldState } from './state';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { SkillRegistry } from '../skill-registry';
import { RiskAssessor } from '../risk-assessor';

// ---------------------------------------------------------------------------
// 測試 helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  const sr = new SkillRegistry(db);
  const ce = new ChiefEngine(db, cs, sr);
  const ra = new RiskAssessor(db);
  const le = new LawEngine(db, cs, ce);
  return { db, vm, cs, ce, le, sr, ra };
}

function createVillage(vm: VillageManager) {
  return vm.create({
    name: 'Rollback Test Village',
    target_repo: 'test/repo',
  }, 'test-actor');
}

function createConstitution(cs: ConstitutionStore, villageId: string) {
  return cs.create(villageId, {
    rules: [{ id: 'r1', description: 'test rule', enforcement: 'hard' as const }],
    allowed_permissions: ['dispatch_task'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'test-actor');
}

// ---------------------------------------------------------------------------
// 既有測試（v1 intent-only 行為，升級到 Phase 2）
// ---------------------------------------------------------------------------

describe('rollbackChange', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
  });

  it('produces correct diff between current and snapshot state', () => {
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    createConstitution(cs, village.id);

    const result = rollbackChange(db, village.id, snapId, 'revert constitution');

    expect(result.success).toBe(true);
    expect(result.diff.has_changes).toBe(true);
    expect(result.diff.constitution).not.toBeNull();
    const constDiff = result.diff.constitution;
    if (constDiff) {
      expect(constDiff.action).toBe('revoked');
    }
  });

  it('records audit_log entry with restored flag', () => {
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    rollbackChange(db, village.id, snapId, 'audit test');

    const rows = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'world' AND action = 'rollback'"
    ).all() as Array<Record<string, unknown>>;

    expect(rows.length).toBe(1);
    const payload = JSON.parse(rows[0].payload as string);
    expect(payload.snapshot_id).toBe(snapId);
    expect(payload.reason).toBe('audit test');
    expect(payload.restored).toBe(true);
  });

  it('throws on invalid snapshot ID', () => {
    const village = createVillage(vm);

    expect(() =>
      rollbackChange(db, village.id, 'nonexistent-snap', 'bad id')
    ).toThrow('Snapshot not found: nonexistent-snap');
  });

  it('creates a new backup snapshot', () => {
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    const result = rollbackChange(db, village.id, snapId, 'backup test');

    expect(result.rollback_snapshot_id).toBeTruthy();
    expect(result.rollback_snapshot_id).not.toBe(snapId);

    const backupState = loadSnapshot(db, result.rollback_snapshot_id);
    expect(backupState.village.id).toBe(village.id);
  });

  it('result contains reason', () => {
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    const result = rollbackChange(db, village.id, snapId, 'my rollback reason');

    expect(result.reason).toBe('my rollback reason');
    expect(result.snapshot_id).toBe(snapId);
  });

  it('multiple rollbacks in sequence work', () => {
    const village = createVillage(vm);

    const snap1 = snapshotWorldState(db, village.id, 'manual');

    createConstitution(cs, village.id);
    const snap2 = snapshotWorldState(db, village.id, 'manual');

    // rollback 到 snap1（無 constitution）
    const r1 = rollbackChange(db, village.id, snap1, 'first rollback');
    expect(r1.success).toBe(true);
    expect(r1.diff.has_changes).toBe(true);

    // 驗證 DB 已還原 — 無 constitution
    const stateAfterR1 = assembleWorldState(db, village.id);
    expect(stateAfterR1.constitution).toBeNull();

    // rollback 到 snap2（有 constitution）
    const r2 = rollbackChange(db, village.id, snap2, 'second rollback');
    expect(r2.success).toBe(true);
    expect(r2.snapshot_id).toBe(snap2);

    // 驗證 DB 已還原 — 有 constitution
    const stateAfterR2 = assembleWorldState(db, village.id);
    expect(stateAfterR2.constitution).not.toBeNull();

    const rows = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'world' AND action = 'rollback'"
    ).all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
  });

  it('throws when snapshot belongs to different village', () => {
    const v1 = createVillage(vm);
    const v2 = vm.create({ name: 'Other Village', target_repo: 'other/repo' }, 'test-actor');
    const snapV2 = snapshotWorldState(db, v2.id, 'manual');

    expect(() =>
      rollbackChange(db, v1.id, snapV2, 'wrong village')
    ).toThrow(`Snapshot ${snapV2} belongs to village ${v2.id}, not ${v1.id}`);
  });

  it('reports no changes when state matches snapshot', () => {
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    const result = rollbackChange(db, village.id, snapId, 'no-op rollback');

    expect(result.success).toBe(true);
    expect(result.diff.has_changes).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: applyToDb + DB restoration 測試
// ---------------------------------------------------------------------------

describe('applyToDb (Phase 2 DB restoration)', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;
  let le: LawEngine;
  let sr: SkillRegistry;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
    ce = s.ce;
    le = s.le;
    sr = s.sr;
  });

  it('restores village metadata from snapshot', () => {
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    // 修改 village
    vm.update(village.id, { name: 'Modified Name', description: 'new desc' }, 'test-actor');

    // 驗證已修改
    const modified = assembleWorldState(db, village.id);
    expect(modified.village.name).toBe('Modified Name');

    // 還原
    const targetState = loadSnapshot(db, snapId);
    applyToDb(db, village.id, targetState);

    // 驗證已還原
    const restored = assembleWorldState(db, village.id);
    expect(restored.village.name).toBe('Rollback Test Village');
    expect(restored.village.description).toBe('');
  });

  it('restores constitution from snapshot', () => {
    const village = createVillage(vm);
    const constitution = createConstitution(cs, village.id);

    // 拍照（有 constitution）
    const snapId = snapshotWorldState(db, village.id, 'manual');
    const targetState = loadSnapshot(db, snapId);

    // 用 supersede 建立新 constitution（參數是舊 constitution 的 ID）
    cs.supersede(constitution.id, {
      rules: [{ id: 'r2', description: 'new rule', enforcement: 'soft' as const }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 20, max_cost_per_day: 200, max_cost_per_loop: 100 },
    }, 'test-actor');

    // 驗證已修改
    const modified = assembleWorldState(db, village.id);
    expect(modified.constitution).not.toBeNull();
    if (modified.constitution) {
      expect(modified.constitution.rules[0].id).toBe('r2');
    }

    // 還原
    applyToDb(db, village.id, targetState);

    // 驗證 constitution 已還原
    const restored = assembleWorldState(db, village.id);
    expect(restored.constitution).not.toBeNull();
    if (restored.constitution) {
      expect(restored.constitution.rules[0].id).toBe('r1');
      expect(restored.constitution.id).toBe(targetState.constitution?.id);
    }
  });

  it('restores chiefs from snapshot', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    // 建立 chief
    const chief = ce.create(village.id, {
      name: 'Chief Alpha',
      role: 'developer',
      permissions: ['dispatch_task'],
    }, 'test-actor');

    // 拍照（有 chief）
    const snapId = snapshotWorldState(db, village.id, 'manual');
    const targetState = loadSnapshot(db, snapId);

    // deactivate chief
    ce.deactivate(chief.id, 'test-actor');

    // 新增第二個 chief
    ce.create(village.id, {
      name: 'Chief Beta',
      role: 'reviewer',
      permissions: ['dispatch_task'],
    }, 'test-actor');

    // 驗證當前狀態
    const modified = assembleWorldState(db, village.id);
    // Beta is active, Alpha is inactive -> only Beta in active chiefs
    expect(modified.chiefs.length).toBe(1);
    expect(modified.chiefs[0].name).toBe('Chief Beta');

    // 還原
    applyToDb(db, village.id, targetState);

    // 驗證 chiefs 已還原 — 只有 Alpha (active)
    const restored = assembleWorldState(db, village.id);
    expect(restored.chiefs.length).toBe(1);
    expect(restored.chiefs[0].name).toBe('Chief Alpha');
    expect(restored.chiefs[0].id).toBe(chief.id);
  });

  it('restores laws from snapshot', () => {
    const village = createVillage(vm);
    cs.create(village.id, {
      rules: [{ id: 'r1', description: 'test rule', enforcement: 'hard' as const }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'test-actor');
    const chief = ce.create(village.id, {
      name: 'Law Chief',
      role: 'legislator',
      permissions: ['dispatch_task', 'propose_law'],
    }, 'test-actor');

    // 建立 law 並 approve
    const law = le.propose(village.id, chief.id, {
      category: 'coding_standards',
      content: { description: 'use strict mode', strategy: {} },
      evidence: { source: 'test', reasoning: 'needed' },
    });
    le.approve(law.id, 'human-reviewer');

    // 拍照（有 active law）
    const snapId = snapshotWorldState(db, village.id, 'manual');
    const targetState = loadSnapshot(db, snapId);

    // 撤銷 law
    le.revoke(law.id, 'test-actor');

    // 驗證已撤銷
    const modified = assembleWorldState(db, village.id);
    expect(modified.active_laws.length).toBe(0);

    // 還原
    applyToDb(db, village.id, targetState);

    // 驗證 law 已還原為 active
    const restored = assembleWorldState(db, village.id);
    expect(restored.active_laws.length).toBe(1);
    expect(restored.active_laws[0].id).toBe(law.id);
  });

  it('restores skills from snapshot', () => {
    const village = createVillage(vm);

    // 建立 skill
    const skill = sr.create({
      name: 'test-skill',
      village_id: village.id,
      definition: {
        description: 'A test skill',
        prompt_template: 'Do something',
      },
    }, 'test-actor');

    // verify skill
    sr.verify(skill.id, 'test-verifier');

    // 拍照
    const snapId = snapshotWorldState(db, village.id, 'manual');
    const targetState = loadSnapshot(db, snapId);

    // 棄用 skill
    sr.deprecate(skill.id, 'test-actor');

    // 驗證已棄用
    const modified = assembleWorldState(db, village.id);
    const modSkill = modified.skills.find(s => s.id === skill.id);
    expect(modSkill).toBeUndefined(); // deprecated 不出現在 verified skills

    // 還原
    applyToDb(db, village.id, targetState);

    // 驗證 skill 已還原
    const restored = assembleWorldState(db, village.id);
    const restoredSkill = restored.skills.find(s => s.id === skill.id);
    expect(restoredSkill).toBeDefined();
    if (restoredSkill) {
      expect(restoredSkill.status).toBe('verified');
    }
  });

  it('rollbackChange restores DB state via assembleWorldState', () => {
    // 完整 end-to-end: apply -> rollback -> verify
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    ce.create(village.id, {
      name: 'E2E Chief',
      role: 'operator',
      permissions: ['dispatch_task'],
    }, 'test-actor');

    // 拍照
    const snapId = snapshotWorldState(db, village.id, 'manual');

    // 做一些變更
    ce.create(village.id, {
      name: 'Extra Chief',
      role: 'support',
      permissions: ['dispatch_task'],
    }, 'test-actor');

    // 執行 rollback
    const result = rollbackChange(db, village.id, snapId, 'e2e rollback');
    expect(result.success).toBe(true);

    // 驗證 DB state 已還原
    const restoredState = assembleWorldState(db, village.id);
    const targetState = loadSnapshot(db, snapId);

    // 比較關鍵欄位
    expect(restoredState.village.name).toBe(targetState.village.name);
    expect(restoredState.constitution?.id).toBe(targetState.constitution?.id);
    expect(restoredState.chiefs.length).toBe(targetState.chiefs.length);
    expect(restoredState.chiefs.map(c => c.id).sort())
      .toEqual(targetState.chiefs.map(c => c.id).sort());
    expect(restoredState.active_laws.length).toBe(targetState.active_laws.length);
  });

  it('rollback removes constitution when snapshot had none', () => {
    const village = createVillage(vm);

    // 拍照（無 constitution）
    const snapId = snapshotWorldState(db, village.id, 'manual');

    // 新增 constitution
    createConstitution(cs, village.id);

    // 驗證已新增
    const modified = assembleWorldState(db, village.id);
    expect(modified.constitution).not.toBeNull();

    // rollback
    rollbackChange(db, village.id, snapId, 'remove constitution');

    // 驗證 constitution 已移除
    const restored = assembleWorldState(db, village.id);
    expect(restored.constitution).toBeNull();
  });

  it('transaction atomicity: partial failure rolls back all changes', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    ce.create(village.id, {
      name: 'Atomic Chief',
      role: 'tester',
      permissions: ['dispatch_task'],
    }, 'test-actor');

    // 記錄當前狀態
    const stateBefore = assembleWorldState(db, village.id);

    // 建構一個會失敗的 targetState：放入一個 law 的 village_id 指向不存在的 village
    // FK constraint violation 會導致 transaction rollback
    const badTargetState = {
      ...stateBefore,
      active_laws: [{
        id: 'bad-law',
        village_id: 'nonexistent-village-id',
        proposed_by: 'nobody',
        approved_by: null,
        version: 1,
        status: 'active' as const,
        category: 'test',
        content: { description: 'bad', strategy: {} },
        risk_level: 'low' as const,
        evidence: { source: 'test', reasoning: 'test' },
        effectiveness: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    };

    // applyToDb 應該因為 FK 違反而失敗
    expect(() => applyToDb(db, village.id, badTargetState)).toThrow();

    // 驗證原始資料未受影響（transaction 已 rollback）
    const stateAfter = assembleWorldState(db, village.id);
    expect(stateAfter.constitution?.id).toBe(stateBefore.constitution?.id);
    expect(stateAfter.chiefs.length).toBe(stateBefore.chiefs.length);
    expect(stateAfter.chiefs[0].name).toBe('Atomic Chief');
  });
});
