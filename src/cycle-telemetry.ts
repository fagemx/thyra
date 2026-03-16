/**
 * cycle-telemetry.ts — Per-operation telemetry for governance cycles
 *
 * 記錄每輪 chief cycle 各步驟的耗時和狀態。
 * 遵循 CycleMetricsCollector 的 static-method 模式。
 *
 * 用法：
 *   const session = CycleTelemetryCollector.begin(cycleId, chiefId, villageId);
 *   session.start('get_state');
 *   // ... do work ...
 *   session.end('get_state', 'ok');
 *   const telemetry = session.finish();
 *   CycleTelemetryCollector.save(db, telemetry);
 */

import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type {
  CycleTelemetry,
  OperationTiming,
  OperationName,
  OperationStatus,
  OperationMetadata,
  TelemetrySummary,
} from './schemas/cycle-telemetry';

// ---------------------------------------------------------------------------
// TelemetrySession — 追蹤一個 chief 在一輪 cycle 內的各操作計時
// ---------------------------------------------------------------------------

export class TelemetrySession {
  private readonly cycleId: string;
  private readonly chiefId: string;
  private readonly villageId: string;
  private readonly sessionStart: number;
  private readonly operations: OperationTiming[] = [];
  private readonly pendingStarts: Map<string, number> = new Map();

  constructor(cycleId: string, chiefId: string, villageId: string) {
    this.cycleId = cycleId;
    this.chiefId = chiefId;
    this.villageId = villageId;
    this.sessionStart = Date.now();
  }

  /** 開始計時一個操作 */
  start(opName: OperationName): void {
    this.pendingStarts.set(opName, Date.now());
  }

  /** 結束一個操作的計時，記錄 duration 和狀態 */
  end(opName: OperationName, status: OperationStatus, metadata?: OperationMetadata): void {
    const startTime = this.pendingStarts.get(opName);
    const durationMs = startTime !== undefined ? Date.now() - startTime : 0;
    this.pendingStarts.delete(opName);

    const timing: OperationTiming = {
      name: opName,
      duration_ms: durationMs,
      status,
    };
    if (metadata) {
      timing.metadata = metadata;
    }
    this.operations.push(timing);
  }

  /** 完成 session，回傳完整 CycleTelemetry */
  finish(): CycleTelemetry {
    const totalDurationMs = Date.now() - this.sessionStart;
    return {
      id: `tel-${randomUUID()}`,
      cycle_id: this.cycleId,
      chief_id: this.chiefId,
      village_id: this.villageId,
      total_duration_ms: totalDurationMs,
      operations: this.operations,
      created_at: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// CycleTelemetryCollector — 靜態方法，負責 session 建立、DB 存取、聚合
// ---------------------------------------------------------------------------

export class CycleTelemetryCollector {
  /** 建立新的 TelemetrySession */
  static begin(cycleId: string, chiefId: string, villageId: string): TelemetrySession {
    return new TelemetrySession(cycleId, chiefId, villageId);
  }

  /** 儲存 telemetry 到 cycle_telemetry 表 */
  static save(db: Database, telemetry: CycleTelemetry): void {
    db.prepare(`
      INSERT INTO cycle_telemetry (id, cycle_id, chief_id, village_id, total_duration_ms, operations, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      telemetry.id,
      telemetry.cycle_id,
      telemetry.chief_id,
      telemetry.village_id,
      telemetry.total_duration_ms,
      JSON.stringify(telemetry.operations),
      telemetry.created_at,
    );
  }

  /** 查詢 telemetry 列表 */
  static list(
    db: Database,
    villageId: string,
    opts?: { chiefId?: string; limit?: number },
  ): CycleTelemetry[] {
    const limit = opts?.limit ?? 20;

    if (opts?.chiefId) {
      const rows = db.prepare(`
        SELECT id, cycle_id, chief_id, village_id, total_duration_ms, operations, created_at
        FROM cycle_telemetry
        WHERE village_id = ? AND chief_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(villageId, opts.chiefId, limit) as RawTelemetryRow[];
      return rows.map(toTelemetry);
    }

    const rows = db.prepare(`
      SELECT id, cycle_id, chief_id, village_id, total_duration_ms, operations, created_at
      FROM cycle_telemetry
      WHERE village_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(villageId, limit) as RawTelemetryRow[];
    return rows.map(toTelemetry);
  }

  /** 計算 telemetry 聚合摘要 */
  static summarize(
    db: Database,
    villageId: string,
    opts?: { windowHours?: number },
  ): TelemetrySummary {
    const windowHours = opts?.windowHours ?? 24;
    const since = new Date(Date.now() - windowHours * 3600_000).toISOString();

    const rows = db.prepare(`
      SELECT total_duration_ms, operations
      FROM cycle_telemetry
      WHERE village_id = ? AND created_at >= ?
      ORDER BY created_at DESC
    `).all(villageId, since) as { total_duration_ms: number; operations: string }[];

    if (rows.length === 0) {
      return {
        cycle_count: 0,
        avg_duration_ms: 0,
        max_duration_ms: 0,
        total_cost_cents: 0,
        slowest_operation: null,
        operation_breakdown: [],
      };
    }

    const cycleCount = rows.length;
    const totalDuration = rows.reduce((s, r) => s + r.total_duration_ms, 0);
    const maxDuration = Math.max(...rows.map(r => r.total_duration_ms));

    // 聚合各操作的耗時和錯誤率
    const opStats = new Map<string, { totalMs: number; count: number; errors: number }>();
    let totalCostCents = 0;

    for (const row of rows) {
      const ops = JSON.parse(row.operations) as OperationTiming[];
      for (const op of ops) {
        const existing = opStats.get(op.name) ?? { totalMs: 0, count: 0, errors: 0 };
        existing.totalMs += op.duration_ms;
        existing.count += 1;
        if (op.status === 'error') existing.errors += 1;
        if (op.metadata?.cost_cents) totalCostCents += op.metadata.cost_cents;
        opStats.set(op.name, existing);
      }
    }

    const operationBreakdown = Array.from(opStats.entries()).map(([name, stats]) => ({
      name,
      avg_ms: stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0,
      error_rate: stats.count > 0 ? stats.errors / stats.count : 0,
    }));

    // 找最慢的操作
    const slowest = operationBreakdown.reduce<{ name: string; avg_ms: number } | null>(
      (best, curr) => {
        if (!best || curr.avg_ms > best.avg_ms) return { name: curr.name, avg_ms: curr.avg_ms };
        return best;
      },
      null,
    );

    return {
      cycle_count: cycleCount,
      avg_duration_ms: Math.round(totalDuration / cycleCount),
      max_duration_ms: maxDuration,
      total_cost_cents: totalCostCents,
      slowest_operation: slowest,
      operation_breakdown: operationBreakdown,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RawTelemetryRow {
  id: string;
  cycle_id: string;
  chief_id: string;
  village_id: string;
  total_duration_ms: number;
  operations: string;
  created_at: string;
}

function toTelemetry(row: RawTelemetryRow): CycleTelemetry {
  return {
    id: row.id,
    cycle_id: row.cycle_id,
    chief_id: row.chief_id,
    village_id: row.village_id,
    total_duration_ms: row.total_duration_ms,
    operations: JSON.parse(row.operations) as OperationTiming[],
    created_at: row.created_at,
  };
}
