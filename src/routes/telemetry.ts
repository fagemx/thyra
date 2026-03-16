/**
 * telemetry.ts — Telemetry API routes (#232)
 *
 * 提供 per-operation governance cycle telemetry 的查詢端點。
 *
 * Endpoints:
 *   GET /api/villages/:id/telemetry          — 最近的 telemetry 列表
 *   GET /api/villages/:id/telemetry/summary  — 聚合統計摘要
 */

import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { CycleTelemetryCollector } from '../cycle-telemetry';

export function telemetryRoutes(db: Database) {
  const app = new Hono();

  /**
   * GET /api/villages/:id/telemetry
   * Query params:
   *   - limit: number (default 20)
   *   - chief_id: string (optional, filter by chief)
   */
  app.get('/api/villages/:id/telemetry', (c) => {
    const villageId = c.req.param('id');
    const limitStr = c.req.query('limit');
    const chiefId = c.req.query('chief_id');

    const limit = limitStr ? Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 100) : 20;

    const data = CycleTelemetryCollector.list(db, villageId, {
      chiefId: chiefId || undefined,
      limit,
    });

    return c.json({ ok: true, data });
  });

  /**
   * GET /api/villages/:id/telemetry/summary
   * Query params:
   *   - window_hours: number (default 24)
   */
  app.get('/api/villages/:id/telemetry/summary', (c) => {
    const villageId = c.req.param('id');
    const windowStr = c.req.query('window_hours');

    const windowHours = windowStr
      ? Math.min(Math.max(1, parseInt(windowStr, 10) || 24), 720)
      : 24;

    const data = CycleTelemetryCollector.summarize(db, villageId, { windowHours });

    return c.json({ ok: true, data });
  });

  return app;
}
