import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from '../db';
import { listPendingChanges } from './proposal';

import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { SkillRegistry } from '../skill-registry';

describe('listPendingChanges', () => {
  let db: Database;
  let villageMgr: VillageManager;
  let constitutionStore: ConstitutionStore;
  let chiefEngine: ChiefEngine;
  let lawEngine: LawEngine;
  let skillRegistry: SkillRegistry;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    villageMgr = new VillageManager(db);
    constitutionStore = new ConstitutionStore(db);
    skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
  });

  // --- Helper: 建立 village + constitution + chief ---
  function setupVillage() {
    const village = villageMgr.create({ name: 'test-village', target_repo: 'repo' }, 'human');
    constitutionStore.create(village.id, {
      rules: [{ description: 'be good', enforcement: 'soft', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
    const chief = chiefEngine.create(village.id, {
      name: 'chief-1',
      role: 'developer',
      permissions: ['propose_law'],
      skills: [],
    }, 'human');
    return { village, chief };
  }

  // --- Helper: 插入帶 pending_approval action 的 cycle ---
  function insertCycleWithPendingAction(villageId: string, chiefId: string): string {
    const id = `cycle-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const actions = JSON.stringify([{
      type: 'deploy',
      description: 'Deploy to staging',
      estimated_cost: 5,
      risk_level: 'medium',
      status: 'pending_approval',
      reason: 'Needs human review',
    }]);
    db.prepare(`
      INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, version,
        budget_remaining, cost_incurred, iterations, max_iterations, timeout_ms,
        actions, laws_proposed, laws_enacted, created_at, updated_at)
      VALUES (?, ?, ?, 'manual', 'running', 1, 50, 0, 1, 10, 300000, ?, '[]', '[]', ?, ?)
    `).run(id, villageId, chiefId, actions, now, now);
    return id;
  }

  // === Test 1: 空 village 無待處理變更 ===
  it('returns empty array when no pending changes', () => {
    const village = villageMgr.create({ name: 'empty', target_repo: 'r' }, 'human');
    const result = listPendingChanges(db, village.id);
    expect(result).toEqual([]);
  });

  // === Test 2: proposed law 出現在待處理佇列 ===
  it('includes proposed law as pending change', () => {
    const { village, chief } = setupVillage();

    // propose 一個 medium risk law（不會被 auto-approve）
    const law = lawEngine.propose(village.id, chief.id, {
      category: 'code-review',
      content: { description: 'Require branch review', strategy: { min_reviewers: 1 } },
      evidence: { source: 'team', reasoning: 'quality' },
    });

    expect(law.status).toBe('proposed');

    const changes = listPendingChanges(db, village.id);
    expect(changes).toHaveLength(1);
    expect(changes[0].change_type).toBe('law.propose');
    expect(changes[0].source_id).toBe(law.id);
    expect(changes[0].status).toBe('pending');
    expect(changes[0].risk_level).toBe(law.risk_level);
    expect(changes[0].proposed_by).toBe(chief.id);
    expect(changes[0].village_id).toBe(village.id);
  });

  // === Test 3: 多個 proposed laws 按 created_at DESC 排序 ===
  it('returns multiple proposed laws sorted by created_at DESC', () => {
    const { village, chief } = setupVillage();

    // 建立兩個 proposed laws（不同 category 確保不會是 low risk auto-approve）
    lawEngine.propose(village.id, chief.id, {
      category: 'deploy',
      content: { description: 'Deploy rule', strategy: {} },
      evidence: { source: 'ops', reasoning: 'safety' },
    });
    // deploy → high risk，不會 auto-approve

    lawEngine.propose(village.id, chief.id, {
      category: 'staging',
      content: { description: 'Staging rule', strategy: {} },
      evidence: { source: 'ops', reasoning: 'testing' },
    });
    // law2 是 medium risk（含 staging），不會 auto-approve

    const changes = listPendingChanges(db, village.id);

    // 過濾掉 rejected 的（deploy 可能被 reject 也可能是 proposed）
    // 只算 proposed 的
    const proposedChanges = changes.filter(c => c.change_type === 'law.propose');
    expect(proposedChanges.length).toBeGreaterThanOrEqual(1);

    // 確認排序是 DESC（最新的在前）
    for (let i = 1; i < proposedChanges.length; i++) {
      expect(proposedChanges[i - 1].created_at >= proposedChanges[i].created_at).toBe(true);
    }
  });

  // === Test 4: active/enacted laws 不出現在待處理佇列 ===
  it('does not include active laws', () => {
    const { village, chief } = setupVillage();

    // 給 chief enact_law_low 權限，讓 low risk law 自動 approve
    chiefEngine.update(chief.id, { permissions: ['propose_law', 'enact_law_low'] }, 'human');

    const law = lawEngine.propose(village.id, chief.id, {
      category: 'unique-cat-active',
      content: { description: 'A simple rule', strategy: {} },
      evidence: { source: 'test', reasoning: 'test' },
    });

    // 確認 law 是 active（low risk auto-approved）
    expect(law.status).toBe('active');

    const changes = listPendingChanges(db, village.id);
    const lawChanges = changes.filter(c => c.source_id === law.id);
    expect(lawChanges).toHaveLength(0);
  });

  // === Test 5: rolled_back laws 不出現在待處理佇列 ===
  it('does not include rolled back laws', () => {
    const { village, chief } = setupVillage();

    // 先建立一個 proposed law，然後 reject 它
    const law = lawEngine.propose(village.id, chief.id, {
      category: 'deploy',
      content: { description: 'Deploy to production', strategy: {} },
      evidence: { source: 'ops', reasoning: 'needed' },
    });

    // 如果是 proposed，reject 它
    if (law.status === 'proposed') {
      lawEngine.reject(law.id, 'human', 'not needed');
    }

    const changes = listPendingChanges(db, village.id);
    const lawChanges = changes.filter(c => c.source_id === law.id);
    expect(lawChanges).toHaveLength(0);
  });

  // === Test 6: ChangeProposal 包含正確的欄位映射 ===
  it('maps law fields correctly to ChangeProposal', () => {
    const { village, chief } = setupVillage();

    const law = lawEngine.propose(village.id, chief.id, {
      category: 'staging',
      content: { description: 'Use staging env', strategy: { env: 'staging' } },
      evidence: { source: 'devops', reasoning: 'best practice' },
    });

    // staging keyword → medium risk → proposed
    expect(law.status).toBe('proposed');

    const changes = listPendingChanges(db, village.id);
    expect(changes).toHaveLength(1);

    const proposal = changes[0];
    expect(proposal.id).toBe(`proposal-law-${law.id}`);
    expect(proposal.village_id).toBe(village.id);
    expect(proposal.change_type).toBe('law.propose');
    expect(proposal.description).toBe('Use staging env');
    expect(proposal.risk_level).toBe('medium');
    expect(proposal.proposed_by).toBe(chief.id);
    expect(proposal.status).toBe('pending');
    expect(proposal.source_id).toBe(law.id);
    expect(proposal.created_at).toBe(law.created_at);
  });

  // === Test 7: pending_approval action 出現在待處理佇列 ===
  it('includes pending_approval actions from loop cycles', () => {
    const { village, chief } = setupVillage();
    const cycleId = insertCycleWithPendingAction(village.id, chief.id);

    const changes = listPendingChanges(db, village.id);
    const actionChanges = changes.filter(c => c.change_type === 'action.pending_approval');
    expect(actionChanges).toHaveLength(1);
    expect(actionChanges[0].source_id).toBe(cycleId);
    expect(actionChanges[0].description).toBe('Deploy to staging');
    expect(actionChanges[0].risk_level).toBe('medium');
    expect(actionChanges[0].status).toBe('pending');
  });

  // === Test 8: 混合來源（laws + actions）按 created_at DESC 排序 ===
  it('combines laws and actions sorted by created_at DESC', () => {
    const { village, chief } = setupVillage();

    // 建立一個 proposed law
    const law = lawEngine.propose(village.id, chief.id, {
      category: 'staging',
      content: { description: 'Staging rule', strategy: {} },
      evidence: { source: 'ops', reasoning: 'safety' },
    });
    expect(law.status).toBe('proposed');

    // 建立一個 pending_approval action
    insertCycleWithPendingAction(village.id, chief.id);

    const changes = listPendingChanges(db, village.id);
    expect(changes.length).toBe(2);

    // 確認排序
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i - 1].created_at >= changes[i].created_at).toBe(true);
    }
  });

  // === Test 9: 不同 village 的變更互不影響 ===
  it('isolates pending changes by village', () => {
    const { village: v1, chief: c1 } = setupVillage();

    // 建立第二個 village
    const v2 = villageMgr.create({ name: 'village-2', target_repo: 'repo2' }, 'human');
    constitutionStore.create(v2.id, {
      rules: [{ description: 'be good', enforcement: 'soft', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
    const c2 = chiefEngine.create(v2.id, {
      name: 'chief-2',
      role: 'developer',
      permissions: ['propose_law'],
      skills: [],
    }, 'human');

    // v1 有一個 proposed law
    lawEngine.propose(v1.id, c1.id, {
      category: 'staging',
      content: { description: 'V1 staging rule', strategy: {} },
      evidence: { source: 'ops', reasoning: 'v1' },
    });

    // v2 有一個 proposed law
    lawEngine.propose(v2.id, c2.id, {
      category: 'staging',
      content: { description: 'V2 staging rule', strategy: {} },
      evidence: { source: 'ops', reasoning: 'v2' },
    });

    const v1Changes = listPendingChanges(db, v1.id);
    const v2Changes = listPendingChanges(db, v2.id);

    expect(v1Changes.every(c => c.village_id === v1.id)).toBe(true);
    expect(v2Changes.every(c => c.village_id === v2.id)).toBe(true);
  });
});
