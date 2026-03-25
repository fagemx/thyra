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
import { z } from 'zod';
import { CycleTelemetryCollector } from '../cycle-telemetry';

const TelemetryListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  chief_id: z.string().min(1).optional(),
});

const TelemetrySummaryQuery = z.object({
  window_hours: z.coerce.number().int().min(1).max(720).default(24),
});

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
    const parsed = TelemetryListQuery.safeParse({
      limit: c.req.query('limit'),
      chief_id: c.req.query('chief_id') || undefined,
    });
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }

    const data = CycleTelemetryCollector.list(db, villageId, {
      chiefId: parsed.data.chief_id,
      limit: parsed.data.limit,
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
    const parsed = TelemetrySummaryQuery.safeParse({
      window_hours: c.req.query('window_hours'),
    });
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }

    const data = CycleTelemetryCollector.summarize(db, villageId, { windowHours: parsed.data.window_hours });

    return c.json({ ok: true, data });
  });

  return app;
}
