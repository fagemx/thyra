/**
 * ChangeProposal — 統一的待處理變更佇列。
 *
 * 來源：
 * 1. proposed laws（status = 'proposed'）
 * 2. loop cycle actions with status = 'pending_approval'
 */
import type { Database } from 'bun:sqlite';

/** 待處理變更的統一表示 */
export interface ChangeProposal {
  id: string;
  village_id: string;
  /** 變更類型，如 'law.propose'、'action.pending_approval' */
  change_type: string;
  description: string;
  risk_level: string;
  proposed_by: string;
  /** 永遠是 'pending' */
  status: 'pending';
  /** 底層實體的 ID（law_id、cycle_id 等） */
  source_id: string;
  created_at: string;
}

/**
 * 查詢某個 village 的所有待處理變更。
 * 純讀取函數，不寫 audit_log。
 */
export function listPendingChanges(db: Database, villageId: string): ChangeProposal[] {
  const proposals: ChangeProposal[] = [];

  // 1. 查詢 proposed laws
  const lawRows = db.prepare(
    'SELECT * FROM laws WHERE village_id = ? AND status = ? ORDER BY created_at DESC'
  ).all(villageId, 'proposed') as Record<string, unknown>[];

  for (const row of lawRows) {
    const content = JSON.parse((row.content as string) || '{}') as { description?: string };
    proposals.push({
      id: `proposal-law-${row.id as string}`,
      village_id: villageId,
      change_type: 'law.propose',
      description: content.description ?? `Law proposal: ${row.category as string}`,
      risk_level: row.risk_level as string,
      proposed_by: row.proposed_by as string,
      status: 'pending',
      source_id: row.id as string,
      created_at: row.created_at as string,
    });
  }

  // 2. 查詢 loop cycle actions with pending_approval status
  const cycleRows = db.prepare(
    'SELECT * FROM loop_cycles WHERE village_id = ? ORDER BY created_at DESC'
  ).all(villageId) as Record<string, unknown>[];

  for (const cycle of cycleRows) {
    const actions = JSON.parse((cycle.actions as string) || '[]') as Array<{
      type: string;
      description: string;
      risk_level: string;
      status: string;
      estimated_cost: number;
      reason: string;
    }>;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.status === 'pending_approval') {
        proposals.push({
          id: `proposal-action-${cycle.id as string}-${i}`,
          village_id: villageId,
          change_type: 'action.pending_approval',
          description: action.description,
          risk_level: action.risk_level,
          proposed_by: cycle.chief_id as string,
          status: 'pending',
          source_id: cycle.id as string,
          created_at: cycle.created_at as string,
        });
      }
    }
  }

  // 按 created_at DESC 排序
  proposals.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return proposals;
}
