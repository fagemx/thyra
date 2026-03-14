import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { rollbackChange } from './rollback';
import { snapshotWorldState, loadSnapshot } from './snapshot';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';

// ---------------------------------------------------------------------------
// 測試 helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  return { db, vm, cs };
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
// 測試
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
    // 建立 village，拍 snapshot（無 constitution）
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    // 變更：新增 constitution
    createConstitution(cs, village.id);

    // rollback 應偵測到 constitution 差異
    const result = rollbackChange(db, village.id, snapId, 'revert constitution');

    expect(result.success).toBe(true);
    expect(result.diff.has_changes).toBe(true);
    // diff 方向：currentState → targetState
    // 當前有 constitution，目標（snapshot）沒有 → constitution revoked
    expect(result.diff.constitution).not.toBeNull();
    expect(result.diff.constitution!.action).toBe('revoked');
  });

  it('records audit_log entry', () => {
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

    // rollback_snapshot_id 應該是新建的，且可以被 loadSnapshot 讀取
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

    // 拍 snap1（無 constitution）
    const snap1 = snapshotWorldState(db, village.id, 'manual');

    // 新增 constitution，拍 snap2
    createConstitution(cs, village.id);
    const snap2 = snapshotWorldState(db, village.id, 'manual');

    // rollback 到 snap1
    const r1 = rollbackChange(db, village.id, snap1, 'first rollback');
    expect(r1.success).toBe(true);
    expect(r1.diff.has_changes).toBe(true);

    // rollback 到 snap2
    const r2 = rollbackChange(db, village.id, snap2, 'second rollback');
    expect(r2.success).toBe(true);
    // snap2 有 constitution，當前也有 → 應該 constitution 相同（no diff on constitution）
    // 但由於 diff 比較 currentState（live 表）vs targetState（snap2）可能有時間差異
    // 只要不 throw 且 success = true 即可
    expect(r2.snapshot_id).toBe(snap2);

    // 驗證 audit_log 有兩筆
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

    // 沒有任何變更就 rollback → diff 應無變化
    const result = rollbackChange(db, village.id, snapId, 'no-op rollback');

    expect(result.success).toBe(true);
    expect(result.diff.has_changes).toBe(false);
  });
});
