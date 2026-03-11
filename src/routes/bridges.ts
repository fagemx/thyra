import { Hono } from 'hono';
import type { KarviBridge } from '../karvi-bridge';
import type { EddaBridge } from '../edda-bridge';
import { KarviWebhookPayloadSchema, normalizeKarviEvent } from '../schemas/karvi-event';

export function bridgeRoutes(karvi: KarviBridge, edda: EddaBridge): Hono {
  const app = new Hono();

  // === Karvi Bridge ===

  app.get('/api/bridges/karvi/status', async (c) => {
    const health = await karvi.getHealth();
    return c.json({ ok: true, data: health });
  });

  app.post('/api/bridges/karvi/dispatch', async (c) => {
    const body = await c.req.json();
    try {
      const result = await karvi.dispatchProject(body);
      if (!result) {
        return c.json({ ok: false, error: { code: 'KARVI_UNAVAILABLE', message: 'Karvi unreachable' } }, 502);
      }
      return c.json({ ok: true, data: result }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'DISPATCH_FAILED', message: msg } }, 502);
    }
  });

  app.post('/api/bridges/karvi/tasks/:taskId/dispatch', async (c) => {
    const taskId = c.req.param('taskId');
    const runtime = c.req.query('runtime') || undefined;
    try {
      const result = await karvi.dispatchSingleTask(taskId, runtime);
      if (!result) {
        return c.json({ ok: false, error: { code: 'KARVI_UNAVAILABLE', message: 'Karvi unreachable' } }, 502);
      }
      return c.json({ ok: true, data: result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const code = msg.startsWith('BUDGET_EXCEEDED') ? 'BUDGET_EXCEEDED' : 'DISPATCH_FAILED';
      const status = code === 'BUDGET_EXCEEDED' ? 409 : 502;
      return c.json({ ok: false, error: { code, message: msg } }, status);
    }
  });

  app.get('/api/bridges/karvi/events', (c) => {
    const limit = Number(c.req.query('limit') ?? 20);
    return c.json({ ok: true, data: karvi.getRecentEvents(limit) });
  });

  app.post('/api/webhooks/karvi', async (c) => {
    try {
      const body = await c.req.json();
      const parsed = KarviWebhookPayloadSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({
          ok: false,
          error: { code: 'INVALID_EVENT', message: parsed.error.message },
        }, 400);
      }

      const event = normalizeKarviEvent(parsed.data);
      const result = karvi.ingestEvent(event);

      if (!result.ingested) {
        return c.json({ ok: true, data: { duplicate: true } });
      }

      return c.json({ ok: true, data: { event_id: event.event_id } });
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
      q: body.q as string | undefined,
      domain: body.domain as string | undefined,
      keyword: body.keyword as string | undefined,
      limit: body.limit as number | undefined,
      includeSuperseded: body.include_superseded as boolean | undefined,
      branch: body.branch as string | undefined,
    });
    return c.json({ ok: true, data: results });
  });

  app.post('/api/bridges/edda/decide', async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const domain = body.domain as string | undefined;
    const aspect = body.aspect as string | undefined;
    const value = body.value as string | undefined;
    if (!domain || !aspect || !value) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'domain, aspect, value required' } }, 400);
    }
    const result = await edda.recordDecision({
      domain,
      aspect,
      value,
      reason: body.reason as string | undefined,
    });
    if (!result) {
      return c.json({ ok: false, error: { code: 'EDDA_UNAVAILABLE', message: 'Edda unreachable or rejected' } }, 502);
    }
    return c.json({ ok: true, data: result }, 201);
  });

  app.get('/api/bridges/edda/decisions/:eventId/outcomes', async (c) => {
    const eventId = c.req.param('eventId');
    const outcomes = await edda.getDecisionOutcomes(eventId);
    if (!outcomes) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Decision outcomes not found' } }, 404);
    }
    return c.json({ ok: true, data: outcomes });
  });

  app.get('/api/bridges/edda/recent', (c) => {
    const limit = Number(c.req.query('limit') ?? 20);
    return c.json({ ok: true, data: edda.getRecentRecorded(limit) });
  });

  return app;
}
