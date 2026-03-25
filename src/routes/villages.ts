import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { CreateVillageInput, UpdateVillageInput, SetBoardMappingInput } from '../schemas/village';
import type { VillageManager } from '../village-manager';
import { evaluateVillage } from '../village-evaluator';
import { appendAudit } from '../db';

const VillageStatusQuery = z.enum(['active', 'paused', 'archived']).optional();
const DateQuery = z.string().datetime({ offset: true }).optional();

export function villageRoutes(mgr: VillageManager, db?: Database): Hono {
  const app = new Hono();

  app.get('/api/villages', (c) => {
    const statusParsed = VillageStatusQuery.safeParse(c.req.query('status') || undefined);
    if (!statusParsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: statusParsed.error.message } }, 400);
    }
    const status = statusParsed.data;
    return c.json({ ok: true, data: mgr.list(status ? { status } : undefined) });
  });

  app.post('/api/villages', async (c) => {
    const parsed = CreateVillageInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    return c.json({ ok: true, data: mgr.create(parsed.data, 'human') }, 201);
  });

  app.get('/api/villages/:id', (c) => {
    const v = mgr.get(c.req.param('id'));
    if (!v) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Village not found' } }, 404);
    return c.json({ ok: true, data: v });
  });

  app.patch('/api/villages/:id', async (c) => {
    const parsed = UpdateVillageInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: mgr.update(c.req.param('id'), parsed.data, 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  app.delete('/api/villages/:id', (c) => {
    try {
      mgr.archive(c.req.param('id'), 'human');
      return c.json({ ok: true, data: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  // GET /api/villages/:id/score — evaluate village performance
  app.get('/api/villages/:id/score', (c) => {
    if (!db) {
      return c.json({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Evaluator not configured' } }, 500);
    }

    const villageId = c.req.param('id');

    // Verify village exists
    const village = mgr.get(villageId);
    if (!village) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Village not found' } }, 404);
    }

    const fromRaw = c.req.query('from');
    const toRaw = c.req.query('to');
    if (fromRaw) {
      const fp = DateQuery.safeParse(fromRaw);
      if (!fp.success) return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Invalid from date: must be ISO 8601 datetime' } }, 400);
    }
    if (toRaw) {
      const tp = DateQuery.safeParse(toRaw);
      if (!tp.success) return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Invalid to date: must be ISO 8601 datetime' } }, 400);
    }
    const period = fromRaw && toRaw ? { from: fromRaw, to: toRaw } : undefined;

    const score = evaluateVillage(db, villageId, period);

    // Record to audit_log (THY-07)
    appendAudit(db, 'village_score', villageId, 'evaluate', score, 'system');

    return c.json({ ok: true, data: score });
  });

  // === Board Mapping Routes ===

  // GET /api/villages/:id/board-mapping
  app.get('/api/villages/:id/board-mapping', (c) => {
    const villageId = c.req.param('id');
    const village = mgr.get(villageId);
    if (!village) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Village not found' } }, 404);
    }
    const mapping = mgr.getBoardMapping(villageId);
    if (!mapping) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Board mapping not found' } }, 404);
    }
    return c.json({ ok: true, data: mapping });
  });

  // PUT /api/villages/:id/board-mapping
  app.put('/api/villages/:id/board-mapping', async (c) => {
    const villageId = c.req.param('id');
    const parsed = SetBoardMappingInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const mapping = mgr.setBoardMapping(villageId, parsed.data, 'human');
      return c.json({ ok: true, data: mapping });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  // DELETE /api/villages/:id/board-mapping
  app.delete('/api/villages/:id/board-mapping', (c) => {
    const villageId = c.req.param('id');
    const removed = mgr.removeBoardMapping(villageId, 'human');
    if (!removed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Board mapping not found' } }, 404);
    }
    return c.json({ ok: true, data: null });
  });

  // GET /api/board-mappings — list all board mappings
  app.get('/api/board-mappings', (c) => {
    return c.json({ ok: true, data: mgr.listBoardMappings() });
  });

  return app;
}
