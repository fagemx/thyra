/**
 * world.ts — World API routes
 *
 * 8 個 endpoint 掛載在 /api/villages/:id/world/ 底下：
 *   GET  /state      → 取得 village 的完整世界狀態
 *   POST /judge      → 評估變更是否合法（dry-run）
 *   POST /apply      → 套用變更
 *   POST /snapshot   → 手動拍攝快照
 *   GET  /snapshots  → 列出歷史快照
 *   POST /rollback   → 回滾到指定快照
 *   GET  /continuity → 驗證跨週期狀態連續性
 *   GET  /pulse      → SSE stream of world health metrics
 *   GET  /events     → SSE stream of governance events (audit_log)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Database } from 'bun:sqlite';
import { WorldManager } from '../world-manager';
import { listSnapshots } from '../world/snapshot';
import {
  JudgeChangeInput,
  ApplyChangeInput,
  RollbackInput,
  SnapshotInput,
  ContinuityInput,
} from '../schemas/world';
import { verifyContinuity } from '../world/continuity';
import { computeWorldHealth } from '../world/health';
import { AuditQuery } from '../audit-query';
import { z } from 'zod';

const SnapshotsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export function worldRoutes(worldManager: WorldManager, db: Database): Hono {
  const app = new Hono();

  const base = '/api/villages/:id/world';

  // GET /state — 取得完整世界狀態
  app.get(`${base}/state`, (c) => {
    const villageId = c.req.param('id');
    const state = worldManager.getState(villageId);
    return c.json({ ok: true, data: state });
  });

  // POST /judge — 評估變更是否合法（dry-run）
  app.post(`${base}/judge`, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = JudgeChangeInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const villageId = c.req.param('id');
    const result = worldManager.propose(villageId, parsed.data.change);
    return c.json({ ok: true, data: result });
  });

  // POST /apply — 套用變更
  app.post(`${base}/apply`, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = ApplyChangeInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const villageId = c.req.param('id');
    const result = worldManager.apply(villageId, parsed.data.change, parsed.data.reason);
    return c.json({ ok: true, data: result });
  });

  // POST /snapshot — 手動拍攝快照
  app.post(`${base}/snapshot`, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = SnapshotInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const villageId = c.req.param('id');
    const snapshotId = worldManager.snapshot(villageId, parsed.data.trigger);
    return c.json({ ok: true, data: { snapshot_id: snapshotId } });
  });

  // GET /snapshots — 列出歷史快照
  app.get(`${base}/snapshots`, (c) => {
    const query = SnapshotsQuery.safeParse({
      limit: c.req.query('limit'),
    });
    if (!query.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: query.error.message } },
        400,
      );
    }

    const villageId = c.req.param('id');
    const snapshots = listSnapshots(db, villageId, query.data.limit);
    return c.json({ ok: true, data: snapshots });
  });

  // POST /rollback — 回滾到指定快照
  app.post(`${base}/rollback`, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = RollbackInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const villageId = c.req.param('id');
    const result = worldManager.rollback(
      villageId,
      parsed.data.snapshot_id,
      parsed.data.reason,
    );
    return c.json({ ok: true, data: result });
  });

  // GET /continuity — 驗證跨週期狀態連續性
  app.get(`${base}/continuity`, (c) => {
    const query = ContinuityInput.safeParse({
      cycle_count: c.req.query('cycle_count') ? Number(c.req.query('cycle_count')) : undefined,
    });
    if (!query.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: query.error.message } },
        400,
      );
    }

    const villageId = c.req.param('id');
    const report = verifyContinuity(db, villageId, query.data.cycle_count);
    return c.json({ ok: true, data: report });
  });

  // GET /events — SSE stream of governance events (audit_log)
  app.get(`${base}/events`, (c) => {
    const villageId = c.req.param('id');
    const rawInterval = Number(c.req.query('interval') ?? '3000');
    const interval = Math.min(Math.max(1000, Number.isFinite(rawInterval) ? rawInterval : 3000), 60000);
    const auditQuery = new AuditQuery(db);

    return streamSSE(c, async (stream) => {
      const streamCtrl = { alive: true };
      stream.onAbort(() => { streamCtrl.alive = false; });

      // 初始批次 — 最近 50 筆
      const initial = auditQuery.queryByVillage(villageId, {
        limit: 50,
        offset: 0,
      });

      let lastId = 0;
      for (const event of initial.events) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: 'timeline',
          id: String(event.id),
        });
        if (event.id > lastId) lastId = event.id;
      }

      // 增量推送 — poll audit_log WHERE id > lastId, scoped to village
      const villageFilter = `(
        (entity_type = 'village' AND entity_id = ?)
        OR (entity_type = 'constitution' AND entity_id IN (SELECT id FROM constitutions WHERE village_id = ?))
        OR (entity_type = 'chief' AND entity_id IN (SELECT id FROM chiefs WHERE village_id = ?))
        OR (entity_type = 'law' AND entity_id IN (SELECT id FROM laws WHERE village_id = ?))
        OR (entity_type = 'skill' AND entity_id IN (SELECT id FROM skills WHERE village_id = ?))
        OR (entity_type = 'loop' AND entity_id IN (SELECT id FROM loop_cycles WHERE village_id = ?))
      )`;
      const incrementalStmt = db.prepare(
        `SELECT * FROM audit_log WHERE id > ? AND ${villageFilter} ORDER BY id ASC LIMIT 50`
      );

      while (streamCtrl.alive) {
        await stream.sleep(interval);

        const rows = incrementalStmt.all(lastId, villageId, villageId, villageId, villageId, villageId, villageId) as Array<{
          id: number;
          entity_type: string;
          entity_id: string;
          action: string;
          payload: string;
          actor: string;
          created_at: string;
          event_id: string | null;
        }>;

        for (const row of rows) {
          const event = {
            ...row,
            payload: JSON.parse(row.payload) as unknown,
          };
          await stream.writeSSE({
            data: JSON.stringify(event),
            event: 'timeline',
            id: String(event.id),
          });
          if (event.id > lastId) lastId = event.id;
        }
      }
    });
  });

  // GET /pulse — SSE stream of world health metrics
  app.get(`${base}/pulse`, (c) => {
    const villageId = c.req.param('id');
    const rawInterval = Number(c.req.query('interval') ?? '5000');
    const interval = Math.min(Math.max(1000, Number.isFinite(rawInterval) ? rawInterval : 5000), 60000);

    return streamSSE(c, async (stream) => {
      let id = 0;
      const streamCtrl = { alive: true };
      stream.onAbort(() => { streamCtrl.alive = false; });

      while (streamCtrl.alive) {
        const state = worldManager.getState(villageId);
        const health = computeWorldHealth(state);
        await stream.writeSSE({
          data: JSON.stringify(health),
          event: 'pulse',
          id: String(id++),
        });
        await stream.sleep(interval);
      }
    });
  });

  return app;
}
