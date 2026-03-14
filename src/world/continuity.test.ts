import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { SkillRegistry } from '../skill-registry';
import { snapshotWorldState } from './snapshot';
import { verifyContinuity } from './continuity';

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  const sr = new SkillRegistry(db);
  const ce = new ChiefEngine(db, cs, sr);
  return { db, vm, cs, ce };
}

function createVillage(vm: VillageManager) {
  return vm.create({
    name: 'Continuity Test Village',
    target_repo: 'test/repo',
  }, 'test-actor');
}

function createConstitution(cs: ConstitutionStore, villageId: string) {
  return cs.create(villageId, {
    rules: [{ description: 'base rule', enforcement: 'hard' as const }],
    allowed_permissions: ['dispatch_task'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'test-actor');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyContinuity', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
    ce = s.ce;
  });

  it('should return empty report for village with no snapshots', () => {
    const village = createVillage(vm);

    const report = verifyContinuity(db, village.id);

    expect(report.village_id).toBe(village.id);
    expect(report.total_snapshots).toBe(0);
    expect(report.steps).toEqual([]);
    expect(report.all_consistent).toBe(true);
    expect(report.verified_at).toBeDefined();
  });

  it('should handle single snapshot with no diff', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const snapId = snapshotWorldState(db, village.id, 'manual');

    const report = verifyContinuity(db, village.id);

    expect(report.total_snapshots).toBe(1);
    expect(report.steps).toHaveLength(1);

    const step = report.steps[0];
    expect(step.from_snapshot_id).toBeNull();
    expect(step.to_snapshot_id).toBe(snapId);
    expect(step.diff).toBeNull();
    expect(step.consistent).toBe(true);
    expect(step.timestamp).toBeDefined();
  });

  it('should compute diffs between consecutive snapshots', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    // 第一張快照：只有 village + constitution
    const snap1 = snapshotWorldState(db, village.id, 'manual');

    // 新增一個 chief
    ce.create(village.id, {
      name: 'Chief A',
      role: 'developer',
      permissions: ['dispatch_task'],
    }, 'test-actor');

    // 第二張快照：多了一個 chief
    const snap2 = snapshotWorldState(db, village.id, 'cycle_end');

    const report = verifyContinuity(db, village.id);

    expect(report.total_snapshots).toBe(2);
    expect(report.steps).toHaveLength(2);

    // 第一步：無 diff
    expect(report.steps[0].from_snapshot_id).toBeNull();
    expect(report.steps[0].to_snapshot_id).toBe(snap1);
    expect(report.steps[0].diff).toBeNull();

    // 第二步：有 diff，顯示 chief 新增
    expect(report.steps[1].from_snapshot_id).toBe(snap1);
    expect(report.steps[1].to_snapshot_id).toBe(snap2);
    expect(report.steps[1].diff).not.toBeNull();
    expect(report.steps[1].diff!.has_changes).toBe(true);
    expect(report.steps[1].diff!.chiefs.added).toHaveLength(1);
  });

  it('should detect inconsistent state (chief permissions exceed constitution)', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    // 正常 chief，權限在 constitution 允許範圍內
    ce.create(village.id, {
      name: 'Good Chief',
      role: 'developer',
      permissions: ['dispatch_task'],
    }, 'test-actor');

    // 拍一張正常快照
    snapshotWorldState(db, village.id, 'manual');

    // 直接在 DB 插入一個權限超出 constitution 的 chief（模擬不一致）
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO chiefs (id, village_id, name, role, version, status, skills, permissions, personality, constraints, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 'active', '[]', ?, '{}', '[]', ?, ?)
    `).run(
      'chief-rogue',
      village.id,
      'Rogue Chief',
      'hacker',
      JSON.stringify(['deploy', 'merge_pr']),  // 不在 constitution 允許的 ['dispatch_task'] 中
      now,
      now,
    );

    // 拍不一致的快照
    snapshotWorldState(db, village.id, 'manual');

    const report = verifyContinuity(db, village.id);

    expect(report.total_snapshots).toBe(2);
    expect(report.all_consistent).toBe(false);

    // 第一步應一致，第二步不一致
    expect(report.steps[0].consistent).toBe(true);
    expect(report.steps[1].consistent).toBe(false);
  });

  it('should limit snapshots analyzed via cycleCount parameter', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    // 建立 5 個快照
    for (let i = 0; i < 5; i++) {
      snapshotWorldState(db, village.id, 'manual');
    }

    // 只分析最近 3 個
    const report = verifyContinuity(db, village.id, 3);

    expect(report.total_snapshots).toBe(3);
    expect(report.steps).toHaveLength(3);
  });

  it('should return steps in chronological order', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    const snap1 = snapshotWorldState(db, village.id, 'manual');
    const snap2 = snapshotWorldState(db, village.id, 'cycle_end');
    const snap3 = snapshotWorldState(db, village.id, 'pre_change');

    const report = verifyContinuity(db, village.id);

    expect(report.steps).toHaveLength(3);
    // 按時間正序
    expect(report.steps[0].to_snapshot_id).toBe(snap1);
    expect(report.steps[1].to_snapshot_id).toBe(snap2);
    expect(report.steps[2].to_snapshot_id).toBe(snap3);

    // from_snapshot_id 鏈接正確
    expect(report.steps[0].from_snapshot_id).toBeNull();
    expect(report.steps[1].from_snapshot_id).toBe(snap1);
    expect(report.steps[2].from_snapshot_id).toBe(snap2);
  });

  it('should mark village without constitution and without chiefs as consistent', () => {
    const village = createVillage(vm);

    // 無 constitution、無 chief → 初始狀態，應一致
    snapshotWorldState(db, village.id, 'manual');

    const report = verifyContinuity(db, village.id);

    expect(report.total_snapshots).toBe(1);
    expect(report.all_consistent).toBe(true);
    expect(report.steps[0].consistent).toBe(true);
  });

  it('should track evolution from founding to current state across multiple changes', () => {
    const village = createVillage(vm);

    // Step 1: 建村快照
    snapshotWorldState(db, village.id, 'manual');

    // Step 2: 建立 constitution
    createConstitution(cs, village.id);
    snapshotWorldState(db, village.id, 'pre_change');

    // Step 3: 任命 chief
    ce.create(village.id, {
      name: 'Builder',
      role: 'developer',
      permissions: ['dispatch_task'],
    }, 'test-actor');
    snapshotWorldState(db, village.id, 'cycle_end');

    const report = verifyContinuity(db, village.id);

    expect(report.total_snapshots).toBe(3);
    expect(report.all_consistent).toBe(true);

    // 第 1→2 步：constitution 新建
    expect(report.steps[1].diff!.constitution).not.toBeNull();
    expect(report.steps[1].diff!.constitution!.action).toBe('created');

    // 第 2→3 步：chief 新增
    expect(report.steps[2].diff!.chiefs.added).toHaveLength(1);
    expect(report.steps[2].diff!.chiefs.added[0].name).toBe('Builder');
  });
});
