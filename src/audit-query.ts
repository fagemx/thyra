import type { Database } from 'bun:sqlite';

/**
 * 單筆 audit 事件（payload 已 JSON.parse）
 */
export interface AuditEvent {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: unknown;
  actor: string;
  created_at: string;
  event_id: string | null;
}

/**
 * 查詢結果（含分頁資訊）
 */
export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditQueryParams {
  entity_type?: string;
  entity_id?: string;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export type VillageAuditQueryParams = Omit<AuditQueryParams, 'entity_type' | 'entity_id'>;

/**
 * Audit log 查詢（read-only，符合 THY-07 append-only 原則）
 */
export class AuditQuery {
  constructor(private db: Database) {}

  /**
   * 通用查詢 — 支援 entity_type, entity_id, action, actor, time range, 分頁
   */
  query(params: AuditQueryParams): AuditQueryResult {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (params.entity_type) {
      conditions.push('entity_type = ?');
      values.push(params.entity_type);
    }
    if (params.entity_id) {
      conditions.push('entity_id = ?');
      values.push(params.entity_id);
    }
    if (params.action) {
      conditions.push('action = ?');
      values.push(params.action);
    }
    if (params.actor) {
      conditions.push('actor = ?');
      values.push(params.actor);
    }
    if (params.from) {
      conditions.push('created_at >= ?');
      values.push(params.from);
    }
    if (params.to) {
      conditions.push('created_at <= ?');
      values.push(params.to);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // 取 total（不受 limit/offset 影響）
    const countRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM audit_log ${whereClause}`
    ).get(...values) as { cnt: number };
    const total = countRow.cnt;

    // 取分頁資料
    const rows = this.db.prepare(
      `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).all(...values, params.limit, params.offset) as Array<{
      id: number;
      entity_type: string;
      entity_id: string;
      action: string;
      payload: string;
      actor: string;
      created_at: string;
      event_id: string | null;
    }>;

    return {
      events: rows.map((r) => ({
        ...r,
        payload: JSON.parse(r.payload) as unknown,
      })),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  /**
   * Village 維度查詢 — 透過 subquery 找出該 village 下所有 entity 的 audit trail
   */
  queryByVillage(villageId: string, params: VillageAuditQueryParams): AuditQueryResult {
    const villageCondition = `(
      (entity_type = 'village' AND entity_id = ?)
      OR (entity_type = 'constitution' AND entity_id IN (SELECT id FROM constitutions WHERE village_id = ?))
      OR (entity_type = 'chief' AND entity_id IN (SELECT id FROM chiefs WHERE village_id = ?))
      OR (entity_type = 'law' AND entity_id IN (SELECT id FROM laws WHERE village_id = ?))
      OR (entity_type = 'skill' AND entity_id IN (SELECT id FROM skills WHERE village_id = ?))
      OR (entity_type = 'loop' AND entity_id IN (SELECT id FROM loop_cycles WHERE village_id = ?))
    )`;

    const conditions: string[] = [villageCondition];
    const values: (string | number)[] = [
      villageId, villageId, villageId, villageId, villageId, villageId,
    ];

    if (params.action) {
      conditions.push('action = ?');
      values.push(params.action);
    }
    if (params.actor) {
      conditions.push('actor = ?');
      values.push(params.actor);
    }
    if (params.from) {
      conditions.push('created_at >= ?');
      values.push(params.from);
    }
    if (params.to) {
      conditions.push('created_at <= ?');
      values.push(params.to);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const countRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM audit_log ${whereClause}`
    ).get(...values) as { cnt: number };
    const total = countRow.cnt;

    const rows = this.db.prepare(
      `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).all(...values, params.limit, params.offset) as Array<{
      id: number;
      entity_type: string;
      entity_id: string;
      action: string;
      payload: string;
      actor: string;
      created_at: string;
      event_id: string | null;
    }>;

    return {
      events: rows.map((r) => ({
        ...r,
        payload: JSON.parse(r.payload) as unknown,
      })),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }
}
