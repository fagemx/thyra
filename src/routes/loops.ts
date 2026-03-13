import { Hono } from 'hono';
import { StartCycleInput, StopCycleInput } from '../schemas/loop';
import type { LoopRunner } from '../loop-runner';

export function loopRoutes(runner: LoopRunner): Hono {
  const app = new Hono();

  app.post('/api/villages/:vid/loops/start', async (c) => {
    const parsed = StartCycleInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    try {
      const cycle = runner.startCycle(c.req.param('vid'), parsed.data);
      return c.json({ ok: true, data: cycle }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.get('/api/villages/:vid/loops', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json({ ok: true, data: runner.listCycles(c.req.param('vid'), { status }) });
  });

  app.get('/api/loops/:id', (c) => {
    const cycle = runner.get(c.req.param('id'));
    if (!cycle) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Cycle not found' } }, 404);
    return c.json({ ok: true, data: cycle });
  });

  app.post('/api/loops/:id/stop', async (c) => {
    const parsed = StopCycleInput.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    try {
      const cycle = runner.abortCycle(c.req.param('id'), parsed.data.reason);
      return c.json({ ok: true, data: cycle });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.get('/api/loops/:id/actions', (c) => {
    const actions = runner.getActions(c.req.param('id'));
    return c.json({ ok: true, data: actions });
  });

  return app;
}
