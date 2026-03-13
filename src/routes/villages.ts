import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { CreateVillageInput, UpdateVillageInput } from '../schemas/village';
import type { VillageManager } from '../village-manager';
import { evaluateVillage } from '../village-evaluator';
import { appendAudit } from '../db';

export function villageRoutes(mgr: VillageManager, db?: Database): Hono {
  const app = new Hono();

  app.get('/api/villages', (c) => {
    const status = c.req.query('status') || undefined;
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

    const from = c.req.query('from');
    const to = c.req.query('to');
    const period = from && to ? { from, to } : undefined;

    const score = evaluateVillage(db, villageId, period);

    // Record to audit_log (THY-07)
    appendAudit(db, 'village_score', villageId, 'evaluate', score, 'system');

    return c.json({ ok: true, data: score });
  });

  return app;
}
