import { Hono } from 'hono';
import type { KarviBridge, KarviEvent } from '../karvi-bridge';
import type { EddaBridge } from '../edda-bridge';

export function bridgeRoutes(karvi: KarviBridge, edda: EddaBridge): Hono {
  const app = new Hono();

  // === Karvi Bridge ===

  app.get('/api/bridges/karvi/status', async (c) => {
    const health = await karvi.getHealth();
    return c.json({ ok: true, data: health });
  });

  app.post('/api/bridges/karvi/dispatch', async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    try {
      const result = await karvi.dispatchTask({
        villageId: body.village_id as string,
        title: body.title as string,
        description: body.description as string,
        targetRepo: body.target_repo as string,
        runtimeHint: body.runtime_hint as string | undefined,
        modelHint: body.model_hint as string | undefined,
      });
      return c.json({ ok: true, data: result }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'DISPATCH_FAILED', message: msg } }, 502);
    }
  });

  app.get('/api/bridges/karvi/events', (c) => {
    const limit = Number(c.req.query('limit') ?? 20);
    return c.json({ ok: true, data: karvi.getRecentEvents(limit) });
  });

  app.post('/api/webhooks/karvi', async (c) => {
    try {
      const event = await c.req.json() as KarviEvent;
      if (event.type !== 'karvi.event.v1') {
        return c.json({ ok: false, error: { code: 'INVALID_EVENT', message: 'Unknown event type' } }, 400);
      }
      karvi.ingestEvent(event);
      return c.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // === Edda Bridge ===

  app.get('/api/bridges/edda/status', async (c) => {
    const health = await edda.getHealth();
    return c.json({ ok: true, data: health });
  });

  app.post('/api/bridges/edda/query', async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const results = await edda.queryDecisions({
      domain: body.domain as string,
      topic: body.topic as string | undefined,
      limit: body.limit as number | undefined,
    });
    return c.json({ ok: true, data: results });
  });

  app.get('/api/bridges/edda/recent', (c) => {
    const limit = Number(c.req.query('limit') ?? 20);
    return c.json({ ok: true, data: edda.getRecentRecorded(limit) });
  });

  return app;
}
