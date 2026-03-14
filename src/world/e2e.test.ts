/**
 * 最小世界 e2e 測試 — 證明：世界能存在、能改、能被判、能回去、能延續。
 *
 * 10 步 demo flow：
 *   1. Founding — 建村 + 立憲 + 任命 chief
 *   2. assembleWorldState() — 驗證狀態完整
 *   3. Legal change — 合法 law.propose
 *   4. judgeChange → allowed — 判官放行
 *   5. applyChange — 應用變更、驗證新法
 *   6. Bad change — 違規 chief.appoint（權限超出 constitution）
 *   7. judgeChange → blocked — 判官阻擋
 *   8. snapshotWorldState — 拍快照
 *   9. rollbackChange — 回滾並驗證 diff
 *  10. verifyContinuity — 連續性驗證
 *
 * @see GitHub issue #126
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { SkillRegistry } from '../skill-registry';
import { assembleWorldState } from './state';
import { applyChange } from './change';
import { judgeChange } from './judge';
import { snapshotWorldState, loadSnapshot } from './snapshot';
import { rollbackChange } from './rollback';
import { verifyContinuity } from './continuity';
import type { WorldChange } from '../schemas/world-change';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';

describe('最小世界 e2e demo', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let sr: SkillRegistry;
  let ce: ChiefEngine;

  // 共用實體（跨步驟）
  let village: Village;
  let constitution: Constitution;
  let chief: Chief;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    vm = new VillageManager(db);
    cs = new ConstitutionStore(db);
    sr = new SkillRegistry(db);
    ce = new ChiefEngine(db, cs, sr);
  });

  it('founding → state → change → judge → rollback → continuity', () => {
    // =========================================================================
    // Step 1: Founding — 建村 + 立憲 + 任命 chief
    // =========================================================================
    village = vm.create(
      { name: '最小世界', target_repo: 'https://github.com/example/min-world' },
      'human',
    );
    expect(village.id).toMatch(/^village-/);
    expect(village.status).toBe('active');

    constitution = cs.create(village.id, {
      rules: [
        { description: '所有變更需經治理層審查', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
    expect(constitution.status).toBe('active');
    expect(constitution.version).toBe(1);

    chief = ce.create(village.id, {
      name: 'Alpha',
      role: 'executor',
      permissions: ['dispatch_task', 'propose_law'],
      skills: [],
      personality: {
        risk_tolerance: 'moderate',
        communication_style: 'concise',
        decision_speed: 'deliberate',
      },
      constraints: [],
    }, 'human');
    expect(chief.status).toBe('active');

    // =========================================================================
    // Step 2: assembleWorldState() — 驗證狀態完整
    // =========================================================================
    const state = assembleWorldState(db, village.id);
    expect(state.village.id).toBe(village.id);
    expect(state.constitution).not.toBeNull();
    expect(state.constitution!.id).toBe(constitution.id);
    expect(state.chiefs).toHaveLength(1);
    expect(state.chiefs[0].id).toBe(chief.id);
    expect(state.active_laws).toHaveLength(0);
    expect(state.running_cycles).toHaveLength(0);

    // =========================================================================
    // Step 3: Legal change — 合法 law.propose
    // =========================================================================
    const legalChange: WorldChange = {
      type: 'law.propose',
      proposed_by: chief.id,
      category: 'naming',
      content: { rule: '所有 commit 必須遵循 conventional commit 格式' },
      risk_level: 'low',
    };

    // =========================================================================
    // Step 4: judgeChange → allowed
    // =========================================================================
    const judgeOk = judgeChange(state, legalChange);
    expect(judgeOk.allowed).toBe(true);
    expect(judgeOk.safety_check).toBe(true);
    expect(judgeOk.legality_check).toBe(true);
    expect(judgeOk.boundary_check).toBe(true);
    expect(judgeOk.consistency_check).toBe(true);
    expect(judgeOk.reasons).toHaveLength(0);

    // =========================================================================
    // Step 5: applyChange — 應用變更、驗證新法
    // =========================================================================
    const stateAfterLaw = applyChange(state, legalChange);
    expect(stateAfterLaw.active_laws).toHaveLength(1);
    expect(stateAfterLaw.active_laws[0].category).toBe('naming');
    expect(stateAfterLaw.active_laws[0].status).toBe('proposed');
    expect(stateAfterLaw.active_laws[0].proposed_by).toBe(chief.id);
    // 原始 state 不受影響（immutable）
    expect(state.active_laws).toHaveLength(0);

    // =========================================================================
    // Step 6: Bad change — 違規 chief.appoint（權限超出 constitution）
    // =========================================================================
    const badChange: WorldChange = {
      type: 'chief.appoint',
      name: 'Rogue',
      role: 'hacker',
      permissions: ['deploy'],  // 'deploy' 不在 constitution.allowed_permissions 內
      skills: [],
    };

    // =========================================================================
    // Step 7: judgeChange → blocked
    // =========================================================================
    const judgeNo = judgeChange(state, badChange);
    expect(judgeNo.allowed).toBe(false);
    expect(judgeNo.legality_check).toBe(false);
    // reasons 應提及 'deploy' 權限超出範圍
    expect(judgeNo.reasons.some((r) => r.includes('deploy'))).toBe(true);

    // =========================================================================
    // Step 8: snapshotWorldState — 拍快照
    // =========================================================================
    const snapId = snapshotWorldState(db, village.id, 'pre_change');
    expect(snapId).toMatch(/^snap_/);

    // 驗證 snapshot 內容可以被 load 回來
    const loadedState = loadSnapshot(db, snapId);
    expect(loadedState.village.id).toBe(village.id);
    expect(loadedState.constitution!.id).toBe(constitution.id);
    expect(loadedState.chiefs).toHaveLength(1);

    // =========================================================================
    // Step 9: rollbackChange — 回滾並驗證 diff
    // =========================================================================
    // 先做一個真正的 DB 變更（用 law engine 直接寫 DB，模擬 state 變化）
    // 在此場景下，rollback 比較的是「snapshot 時的 state」vs「當前 DB state」
    // 因為沒有實際寫入新 law 到 DB，兩邊 state 相同，diff.has_changes = false
    const rollbackResult = rollbackChange(db, village.id, snapId, '測試回滾');
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.snapshot_id).toBe(snapId);
    expect(rollbackResult.rollback_snapshot_id).toMatch(/^snap_/);
    expect(rollbackResult.reason).toBe('測試回滾');
    // diff 存在（即使 has_changes 可能 false，結構完整）
    expect(rollbackResult.diff).toBeDefined();
    expect(rollbackResult.diff.village_id).toBe(village.id);

    // =========================================================================
    // Step 10: verifyContinuity — 連續性驗證
    // =========================================================================
    // 此時有 2 個 snapshot（step 8 的 pre_change + step 9 rollback 產生的 manual）
    const report = verifyContinuity(db, village.id);
    expect(report.village_id).toBe(village.id);
    expect(report.total_snapshots).toBeGreaterThanOrEqual(2);
    expect(report.steps.length).toBeGreaterThanOrEqual(2);
    expect(report.all_consistent).toBe(true);

    // 驗證步驟結構
    const firstStep = report.steps[0];
    expect(firstStep.from_snapshot_id).toBeNull(); // 第一步沒有前一個
    expect(firstStep.to_snapshot_id).toMatch(/^snap_/);
    expect(firstStep.consistent).toBe(true);

    const secondStep = report.steps[1];
    expect(secondStep.from_snapshot_id).not.toBeNull();
    expect(secondStep.diff).not.toBeNull();
    expect(secondStep.consistent).toBe(true);
  });
});
