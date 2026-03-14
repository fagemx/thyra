import type { Database } from 'bun:sqlite';
import { assembleWorldState, type WorldState } from './state';

export type SnapshotTrigger = 'manual' | 'cycle_end' | 'pre_change';

export interface SnapshotMeta {
  id: string;
  village_id: string;
  trigger: SnapshotTrigger;
  version: number;
  created_at: string;
}

/**
 * 保存當前 WorldState snapshot，回傳 snapshot_id。
 * 內部呼叫 assembleWorldState 取得完整狀態後序列化存入 DB。
 */
export function snapshotWorldState(
  db: Database,
  villageId: string,
  trigger: SnapshotTrigger,
): string {
  const state = assembleWorldState(db, villageId);
  const id = `snap_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO world_snapshots (id, village_id, trigger, snapshot, version, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, villageId, trigger, JSON.stringify(state), now);

  return id;
}

/**
 * 從 snapshot 還原 WorldState。
 * 不做 Zod validate — 資料是由 assembleWorldState 產生的。
 */
export function loadSnapshot(db: Database, snapshotId: string): WorldState {
  const row = db.prepare(
    'SELECT snapshot FROM world_snapshots WHERE id = ?'
  ).get(snapshotId) as { snapshot: string } | null;

  if (!row) throw new Error(`Snapshot not found: ${snapshotId}`);
  return JSON.parse(row.snapshot) as WorldState;
}

/**
 * 查詢某 village 的最近 N 個 snapshot metadata（不含 full snapshot JSON）。
 */
export function listSnapshots(
  db: Database,
  villageId: string,
  limit = 10,
): SnapshotMeta[] {
  return db.prepare(`
    SELECT id, village_id, trigger, version, created_at
    FROM world_snapshots
    WHERE village_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(villageId, limit) as SnapshotMeta[];
}
