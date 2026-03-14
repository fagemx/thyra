/**
 * Proposal routes — 待處理變更佇列的 API 端點。
 */
import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { listPendingChanges } from '../world/proposal';

export function proposalRoutes(db: Database): Hono {
  const app = new Hono();

  /** GET /api/villages/:id/pending-changes — 查詢某個 village 的所有待處理變更 */
  app.get('/api/villages/:id/pending-changes', (c) => {
    const villageId = c.req.param('id');

    // 確認 village 存在
    const village = db.prepare('SELECT id FROM villages WHERE id = ?').get(villageId);
    if (!village) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Village not found' } },
        404,
      );
    }

    const changes = listPendingChanges(db, villageId);
    return c.json({ ok: true, data: changes });
  });

  return app;
}
