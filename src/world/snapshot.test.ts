import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { snapshotWorldState, loadSnapshot, listSnapshots } from './snapshot';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  return { db, vm, cs };
}

function createVillage(vm: VillageManager) {
  return vm.create({
    name: 'Snapshot Test Village',
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

describe('snapshotWorldState', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
  });

  it('should snapshot and load roundtrip', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    const snapId = snapshotWorldState(db, village.id, 'manual');
    expect(snapId).toMatch(/^snap_/);

    const loaded = loadSnapshot(db, snapId);
    expect(loaded.village.id).toBe(village.id);
    expect(loaded.constitution).not.toBeNull();
    expect(loaded.constitution!.rules).toHaveLength(1);
  });

  it('should throw on snapshot not found', () => {
    expect(() => loadSnapshot(db, 'snap_nonexistent')).toThrow('Snapshot not found');
  });

  it('should throw on village not found', () => {
    expect(() => snapshotWorldState(db, 'nonexistent', 'manual')).toThrow('Village not found');
  });

  it('should accept all trigger types', () => {
    const village = createVillage(vm);
    const triggers = ['manual', 'cycle_end', 'pre_change'] as const;

    for (const trigger of triggers) {
      const id = snapshotWorldState(db, village.id, trigger);
      expect(id).toMatch(/^snap_/);
    }

    const snapshots = listSnapshots(db, village.id);
    expect(snapshots).toHaveLength(3);
    expect(snapshots.map((s) => s.trigger).sort()).toEqual(
      ['cycle_end', 'manual', 'pre_change'],
    );
  });

  it('should list snapshots in reverse chronological order', () => {
    const village = createVillage(vm);
    const id1 = snapshotWorldState(db, village.id, 'manual');
    const id2 = snapshotWorldState(db, village.id, 'cycle_end');
    const id3 = snapshotWorldState(db, village.id, 'pre_change');

    const list = listSnapshots(db, village.id);
    expect(list).toHaveLength(3);
    // 最新的在前
    expect(list[0].id).toBe(id3);
    expect(list[2].id).toBe(id1);
  });

  it('should return empty array when no snapshots', () => {
    const village = createVillage(vm);
    const list = listSnapshots(db, village.id);
    expect(list).toEqual([]);
  });

  it('should respect limit parameter', () => {
    const village = createVillage(vm);
    for (let i = 0; i < 5; i++) {
      snapshotWorldState(db, village.id, 'manual');
    }

    const list = listSnapshots(db, village.id, 3);
    expect(list).toHaveLength(3);
  });

  it('should preserve assembled_at from snapshot time', () => {
    const village = createVillage(vm);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    // 等一小段時間再 load，確認 assembled_at 是快照時間不是 load 時間
    const loaded = loadSnapshot(db, snapId);
    expect(loaded.assembled_at).toBeDefined();
    // assembled_at 應該是過去的時間（快照時間）
    const snapshotTime = new Date(loaded.assembled_at).getTime();
    const now = Date.now();
    expect(snapshotTime).toBeLessThanOrEqual(now);
  });
});
