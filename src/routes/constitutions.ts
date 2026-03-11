import { Hono } from 'hono';
import { CreateConstitutionInput } from '../schemas/constitution';
import type { ConstitutionStore } from '../constitution-store';

export function constitutionRoutes(store: ConstitutionStore): Hono {
  const app = new Hono();

  app.get('/api/villages/:vid/constitutions', (c) => {
    return c.json({ ok: true, data: store.list(c.req.param('vid')) });
  });

  app.post('/api/villages/:vid/constitutions', async (c) => {
    const parsed = CreateConstitutionInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: store.create(c.req.param('vid'), parsed.data, 'human') }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'CONFLICT', message: msg } }, 409);
    }
  });

  app.get('/api/villages/:vid/constitutions/active', (c) => {
    const active = store.getActive(c.req.param('vid'));
    if (!active) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No active constitution' } }, 404);
    return c.json({ ok: true, data: active });
  });

  app.get('/api/constitutions/:id', (c) => {
    const constitution = store.get(c.req.param('id'));
    if (!constitution) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    return c.json({ ok: true, data: constitution });
  });

  app.post('/api/constitutions/:id/revoke', (c) => {
    try {
      store.revoke(c.req.param('id'), 'human');
      return c.json({ ok: true, data: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.post('/api/constitutions/:id/supersede', async (c) => {
    const parsed = CreateConstitutionInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: store.supersede(c.req.param('id'), parsed.data, 'human') }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  return app;
}
