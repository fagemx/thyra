/**
 * Scheduler routes — 治理排程器控制端點 (#235)
 * Stub pattern: 接受可選的 GovernanceScheduler 實例。
 * 若未初始化，回傳 SCHEDULER_NOT_INITIALIZED 錯誤。
 */
import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { appendAudit } from '../db';

/** 最小化的 scheduler 介面，避免硬依賴 GovernanceScheduler */
export interface SchedulerLike {
  isRunning(): boolean;
  getVillageId(): string | null;
  getIntervalMs(): number | null;
  getLastCycleAt(): string | null;
  start(): void;
  stop(): void;
}

export interface SchedulerRouteDeps {
  scheduler?: SchedulerLike;
  db: Database;
}

export function schedulerRoutes(deps?: SchedulerRouteDeps): Hono {
  const app = new Hono();

  /** GET /api/scheduler/status — 查詢排程器狀態 */
  app.get('/api/scheduler/status', (c) => {
    if (!deps?.scheduler) {
      return c.json({
        ok: false,
        error: { code: 'SCHEDULER_NOT_INITIALIZED', message: 'GovernanceScheduler not configured' },
      }, 503);
    }

    return c.json({
      ok: true,
      data: {
        running: deps.scheduler.isRunning(),
        village_id: deps.scheduler.getVillageId(),
        interval_ms: deps.scheduler.getIntervalMs(),
        last_cycle_at: deps.scheduler.getLastCycleAt(),
      },
    });
  });

  /** POST /api/scheduler/stop — 緊急停止排程器 */
  app.post('/api/scheduler/stop', (c) => {
    if (!deps?.scheduler) {
      return c.json({
        ok: false,
        error: { code: 'SCHEDULER_NOT_INITIALIZED', message: 'GovernanceScheduler not configured' },
      }, 503);
    }

    if (!deps.scheduler.isRunning()) {
      return c.json({
        ok: false,
        error: { code: 'SCHEDULER_NOT_RUNNING', message: 'Scheduler is already stopped' },
      }, 400);
    }

    deps.scheduler.stop();

    appendAudit(deps.db, 'scheduler', 'global', 'stop', { source: 'dashboard' }, 'human');

    return c.json({
      ok: true,
      data: {
        running: false,
        village_id: deps.scheduler.getVillageId(),
        interval_ms: deps.scheduler.getIntervalMs(),
        last_cycle_at: deps.scheduler.getLastCycleAt(),
      },
    });
  });

  /** POST /api/scheduler/start — 啟動排程器 */
  app.post('/api/scheduler/start', (c) => {
    if (!deps?.scheduler) {
      return c.json({
        ok: false,
        error: { code: 'SCHEDULER_NOT_INITIALIZED', message: 'GovernanceScheduler not configured' },
      }, 503);
    }

    if (deps.scheduler.isRunning()) {
      return c.json({
        ok: false,
        error: { code: 'SCHEDULER_ALREADY_RUNNING', message: 'Scheduler is already running' },
      }, 400);
    }

    deps.scheduler.start();

    appendAudit(deps.db, 'scheduler', 'global', 'start', { source: 'dashboard' }, 'human');

    return c.json({
      ok: true,
      data: {
        running: true,
        village_id: deps.scheduler.getVillageId(),
        interval_ms: deps.scheduler.getIntervalMs(),
        last_cycle_at: deps.scheduler.getLastCycleAt(),
      },
    });
  });

  return app;
}
