import { Hono } from 'hono';
import { CreateVillageInput, UpdateVillageInput } from '../schemas/village';
import type { VillageManager } from '../village-manager';

export function villageRoutes(mgr: VillageManager): Hono {
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

  return app;
}
