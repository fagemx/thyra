/**
 * canonical-cycle/observation-builder.ts — 觀察批次建構器
 *
 * 從多個來源（state diff、audit log、external events）聚合觀察，
 * 產生結構化的 ObservationBatch。這是 canonical cycle 的第一步：
 * 「上次 cycle 以來，世界發生了什麼？」
 *
 * 新模組放在 src/canonical-cycle/。
 * canonical-cycle/ 可 import world/，但 world/ 不可 import canonical-cycle/。
 *
 * @see docs/plan/world-cycle/TRACK_A_OBSERVATION_BUILDER.md
 * @see docs/world-design-v0/canonical-cycle.md §4.1
 */

import type { Database } from 'bun:sqlite';
import type { WorldState } from '../world/state';
import type { Observation, ObservationBatch } from '../schemas/observation';
import { ObservationBatchSchema } from '../schemas/observation';
import { observeFromStateDiff } from './observation-sources/state-diff-source';
import { observeFromAuditLog } from './observation-sources/audit-log-source';
import { observeFromExternal } from './observation-sources/external-source';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// ExternalEvent — 外部事件輸入型別
// ---------------------------------------------------------------------------

export interface ExternalEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件類型（如 karvi.webhook、human.action、timer.tick） */
  type: string;
  /** 事件發生時間 (ISO 8601) */
  timestamp: string;
  /** 事件資料 */
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ObservationBuilderDeps — 建構器依賴
// ---------------------------------------------------------------------------

export interface ObservationBuilderDeps {
  /** SQLite database handle（用於讀取 audit_log） */
  db: Database;
  /** World（village）ID */
  worldId: string;
  /** 上次 cycle 的 WorldState（null = 首次 cycle） */
  previousState: WorldState | null;
  /** 當前 WorldState */
  currentState: WorldState;
  /** 外部事件列表（可選） */
  externalEvents?: ExternalEvent[];
  /** audit_log 查詢起始時間（可選，預設 15 分鐘前） */
  sinceTimestamp?: string;
}

// ---------------------------------------------------------------------------
// 主函數
// ---------------------------------------------------------------------------

/**
 * 從所有可用來源建構 ObservationBatch。
 *
 * 來源聚合順序：
 * 1. State diff（前後快照比較）
 * 2. Audit log（DB 近期事件）
 * 3. External events（外部注入的事件）
 *
 * 產出的 batch 經過 Zod 驗證，保證結構合法。
 */
export function buildObservationBatch(deps: ObservationBuilderDeps): ObservationBatch {
  const observations: Observation[] = [];

  // Source 1: state diff
  if (deps.previousState) {
    const diffObs = observeFromStateDiff(deps.previousState, deps.currentState);
    observations.push(...diffObs);
  }

  // Source 2: audit log
  const auditObs = observeFromAuditLog(deps.db, deps.worldId, deps.sinceTimestamp);
  observations.push(...auditObs);

  // Source 3: external events
  if (deps.externalEvents && deps.externalEvents.length > 0) {
    const extObs = observeFromExternal(deps.externalEvents);
    observations.push(...extObs);
  }

  const batch: ObservationBatch = {
    id: `obs_batch_${randomUUID()}`,
    worldId: deps.worldId,
    observations,
    createdAt: new Date().toISOString(),
    version: 1,
  };

  // Zod 驗證，確保產出的 batch 一定合法
  return ObservationBatchSchema.parse(batch);
}
