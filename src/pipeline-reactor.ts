/**
 * pipeline-reactor.ts -- Karvi webhook → WorldManager.apply() reactor
 *
 * When a Karvi webhook event arrives indicating a pipeline task has completed,
 * this reactor extracts the result and applies it to the world via WorldManager.
 *
 * Naming convention for task IDs:
 *   `${villageId}:${chiefId}:${pipelineId}:${timestamp}`
 *
 * Only reacts to `task.completed` events. Other event types are ignored.
 *
 * 層級定位：同 governance-scheduler（uses WorldManager, KarviBridge types）。
 */

import type { Database } from 'bun:sqlite';
import type { KarviEventNormalized } from './schemas/karvi-event';
import type { WorldManager } from './world-manager';
import { appendAudit } from './db';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** 從 task_id 解析出的 pipeline context */
export interface PipelineContext {
  village_id: string;
  chief_id: string;
  pipeline_id: string;
  timestamp: string;
}

/** PipelineReactor 處理結果 */
export interface ReactorResult {
  /** 是否觸發了 world apply */
  reacted: boolean;
  /** 原因（成功時 = 'applied'，失敗時 = 錯誤原因） */
  reason: string;
}

// ---------------------------------------------------------------------------
// PipelineReactor class
// ---------------------------------------------------------------------------

export class PipelineReactor {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly db: Database,
  ) {}

  /**
   * 處理 Karvi webhook 事件。
   *
   * 只對 `task.completed` 事件反應。
   * 解析 task_id 取得 village/chief/pipeline context，
   * 並將結果以 `village.update` 寫入 WorldState metadata。
   *
   * 非 pipeline task（task_id 不符合命名規範）會被忽略。
   */
  onKarviEvent(event: KarviEventNormalized): ReactorResult {
    // 只處理 task.completed 事件
    if (event.event_type !== 'task.completed') {
      return { reacted: false, reason: 'event_type_not_task_completed' };
    }

    // 解析 task_id
    const context = parsePipelineTaskId(event.task_id);
    if (!context) {
      return { reacted: false, reason: 'task_id_not_pipeline_format' };
    }

    // 提取結果
    const output = event.raw.output ?? event.raw.result ?? null;
    const status = event.state ?? 'completed';

    // 以 village.update 將 pipeline 結果寫入 world metadata
    try {
      const result = this.worldManager.apply(
        context.village_id,
        {
          type: 'village.update',
          metadata: {
            last_pipeline_result: {
              pipeline_id: context.pipeline_id,
              chief_id: context.chief_id,
              task_id: event.task_id,
              status,
              output,
              completed_at: event.occurred_at,
            },
          },
        },
        `Pipeline ${context.pipeline_id} completed for chief ${context.chief_id}`,
      );

      if (result.applied) {
        appendAudit(this.db, 'pipeline', event.task_id, 'reactor_applied', {
          village_id: context.village_id,
          chief_id: context.chief_id,
          pipeline_id: context.pipeline_id,
          status,
        }, 'reactor');

        return { reacted: true, reason: 'applied' };
      }

      appendAudit(this.db, 'pipeline', event.task_id, 'reactor_rejected', {
        village_id: context.village_id,
        reasons: result.judge_result.reasons,
      }, 'reactor');

      return { reacted: false, reason: `judge_rejected: ${result.judge_result.reasons.join('; ')}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      appendAudit(this.db, 'pipeline', event.task_id, 'reactor_error', {
        village_id: context.village_id,
        error: message,
      }, 'reactor');

      return { reacted: false, reason: `error: ${message}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: parse pipeline task ID
// ---------------------------------------------------------------------------

/**
 * 解析 pipeline task ID。
 * 格式: `${villageId}:${chiefId}:${pipelineId}:${timestamp}`
 * 至少需要 4 段才算合法的 pipeline task ID。
 */
export function parsePipelineTaskId(taskId: string): PipelineContext | null {
  const parts = taskId.split(':');
  if (parts.length < 4) return null;

  const [villageId, chiefId, pipelineId, timestamp] = parts;
  if (!villageId || !chiefId || !pipelineId || !timestamp) return null;

  return {
    village_id: villageId,
    chief_id: chiefId,
    pipeline_id: pipelineId,
    timestamp,
  };
}
