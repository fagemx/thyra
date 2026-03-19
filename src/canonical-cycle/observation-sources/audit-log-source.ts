/**
 * observation-sources/audit-log-source.ts — 從 audit_log 產生觀察
 *
 * 讀取 audit_log 表中的近期事件，轉換為結構化觀察。
 * 使用 entity_type 對應到 scope，action 決定 importance。
 *
 * @see TRACK_A_OBSERVATION_BUILDER.md Step 2
 */

import type { Database } from 'bun:sqlite';
import type { Observation, ObservationScope } from '../../schemas/observation';

/** audit_log 表的 row 結構 */
interface AuditLogRow {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: string;
  actor: string;
  created_at: string;
  event_id: string | null;
}

/** 將 entity_type 映射到 ObservationScope */
function mapEntityTypeToScope(entityType: string): ObservationScope {
  const mapping: Record<string, ObservationScope> = {
    village: 'world',
    constitution: 'world',
    chief: 'chief',
    law: 'law',
    skill: 'world',
    loop: 'world',
    zone: 'zone',
    stall: 'stall',
    event: 'event',
  };
  return mapping[entityType] ?? 'world';
}

/** 根據 action 推斷 importance */
function inferImportance(action: string): 'low' | 'medium' | 'high' | 'critical' {
  if (action.includes('delete') || action.includes('revoke')) return 'high';
  if (action.includes('create') || action.includes('supersede')) return 'medium';
  return 'low';
}

/**
 * 從 audit_log 讀取近期事件並轉換為觀察。
 *
 * @param db - SQLite database handle
 * @param worldId - 篩選的 village ID（audit_log 無 village_id 欄位，用 entity_id 關聯）
 * @param sinceTimestamp - 起始時間（預設 15 分鐘前）
 */
export function observeFromAuditLog(
  db: Database,
  _worldId: string,
  sinceTimestamp?: string,
): Observation[] {
  const since = sinceTimestamp ?? new Date(Date.now() - 15 * 60_000).toISOString();

  const rows = db.prepare(
    `SELECT id, entity_type, entity_id, action, payload, actor, created_at, event_id
     FROM audit_log
     WHERE created_at > ?
     ORDER BY created_at ASC`
  ).all(since) as AuditLogRow[];

  return rows.map(row => ({
    id: `obs_audit_${row.id}`,
    source: 'audit_log' as const,
    timestamp: row.created_at,
    scope: mapEntityTypeToScope(row.entity_type),
    importance: inferImportance(row.action),
    summary: `Audit: ${row.entity_type}.${row.action}`,
    details: safeParseJson(row.payload),
    targetIds: [row.entity_id],
  }));
}

/** 安全解析 JSON，失敗則回傳包含原始字串的物件 */
function safeParseJson(jsonStr: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(jsonStr);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { raw: parsed };
  } catch {
    return { raw: jsonStr };
  }
}
