import { Hono } from 'hono';
import { ProposeLawRequestInput, EvaluateLawInput, RollbackLawInput } from '../schemas/law';
import type { LawEngine } from '../law-engine';

export function lawRoutes(engine: LawEngine): Hono {
  const app = new Hono();

  app.get('/api/villages/:vid/laws', (c) => {
    return c.json({ ok: true, data: engine.list(c.req.param('vid')) });
  });

  app.get('/api/villages/:vid/laws/active', (c) => {
    const category = c.req.query('category') || undefined;
    return c.json({ ok: true, data: engine.getActiveLaws(c.req.param('vid'), category) });
  });

  app.post('/api/villages/:vid/laws/propose', async (c) => {
    const parsed = ProposeLawRequestInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const { chief_id, ...rest } = parsed.data;
      const law = engine.propose(c.req.param('vid'), chief_id, rest);
      return c.json({ ok: true, data: law }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.get('/api/laws/:id', (c) => {
    const law = engine.get(c.req.param('id'));
    if (!law) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Law not found' } }, 404);
    return c.json({ ok: true, data: law });
  });

  app.post('/api/laws/:id/approve', (c) => {
    try {
      return c.json({ ok: true, data: engine.approve(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.post('/api/laws/:id/reject', (c) => {
    try {
      return c.json({ ok: true, data: engine.reject(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.post('/api/laws/:id/revoke', (c) => {
    try {
      return c.json({ ok: true, data: engine.revoke(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.post('/api/laws/:id/rollback', async (c) => {
    const parsed = RollbackLawInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: engine.rollback(c.req.param('id'), 'human', parsed.data.reason) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.post('/api/laws/:id/evaluate', async (c) => {
    const parsed = EvaluateLawInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: engine.evaluate(c.req.param('id'), parsed.data) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  return app;
}
