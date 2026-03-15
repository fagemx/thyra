/**
 * world.ts — World API routes
 *
 * 7 個 endpoint 掛載在 /api/villages/:id/world/ 底下：
 *   GET  /state      → 取得 village 的完整世界狀態
 *   POST /judge      → 評估變更是否合法（dry-run）
 *   POST /apply      → 套用變更
 *   POST /snapshot   → 手動拍攝快照
 *   GET  /snapshots  → 列出歷史快照
 *   POST /rollback   → 回滾到指定快照
 *   GET  /continuity → 驗證跨週期狀態連續性
 */

import { Hono } from 'hono';
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
    const body = await c.req.json().catch(() => ({}));
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
    const body = await c.req.json().catch(() => ({}));
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
    const body = await c.req.json().catch(() => ({}));
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
    const body = await c.req.json().catch(() => ({}));
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

  return app;
}
