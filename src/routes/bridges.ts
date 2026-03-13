import { Hono } from 'hono';
import type { KarviBridge } from '../karvi-bridge';
import type { EddaBridge } from '../edda-bridge';
import { KarviWebhookPayloadSchema, normalizeKarviEvent } from '../schemas/karvi-event';
import { EddaQueryInput, EddaDecideInput } from '../schemas/edda-bridge';
import { EddaNoteInput } from '../schemas/edda-note';
import { DispatchProjectInput } from '../schemas/karvi-dispatch';

export function bridgeRoutes(karvi: KarviBridge, edda: EddaBridge): Hono {
  const app = new Hono();

  // === Karvi Bridge ===

  app.get('/api/bridges/karvi/status', async (c) => {
    const health = await karvi.getHealth();
    return c.json({ ok: true, data: health });
  });

  app.post('/api/bridges/karvi/dispatch', async (c) => {
    const parsed = DispatchProjectInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    try {
      const result = await karvi.dispatchProject(parsed.data);
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

  app.post('/api/bridges/karvi/tasks/:taskId/cancel', async (c) => {
    const taskId = c.req.param('taskId');
    const cancelled = await karvi.cancelTask(taskId);
    if (!cancelled) {
      return c.json({ ok: false, error: { code: 'KARVI_UNAVAILABLE', message: 'Cancel failed or Karvi unreachable' } }, 502);
    }
    return c.json({ ok: true, data: { cancelled: true } });
  });

  app.get('/api/bridges/karvi/board', async (c) => {
    const board = await karvi.getBoard();
    if (!board) {
      return c.json({ ok: false, error: { code: 'KARVI_UNAVAILABLE', message: 'Karvi unreachable' } }, 502);
    }
    return c.json({ ok: true, data: board });
  });

  app.get('/api/bridges/karvi/runtime-status', async (c) => {
    const fieldsParam = c.req.query('fields');
    const fields = fieldsParam ? fieldsParam.split(',') : undefined;
    const status = await karvi.getStatus(fields);
    if (!status) {
      return c.json({ ok: false, error: { code: 'KARVI_UNAVAILABLE', message: 'Karvi unreachable' } }, 502);
    }
    return c.json({ ok: true, data: status });
  });

  app.get('/api/bridges/karvi/tasks/:taskId/progress', async (c) => {
    const taskId = c.req.param('taskId');
    const progress = await karvi.getTaskProgress(taskId);
    if (!progress) {
      return c.json({ ok: false, error: { code: 'KARVI_UNAVAILABLE', message: 'Karvi unreachable or task not found' } }, 502);
    }
    return c.json({ ok: true, data: progress });
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

  app.post('/api/bridges/karvi/webhook-url', async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const url = body.url;
    if (typeof url !== 'string' || !/^https?:\/\/.+/.test(url)) {
      return c.json({
        ok: false,
        error: { code: 'VALIDATION', message: 'url must be a valid http(s) URL' },
      }, 400);
    }
    const result = await karvi.registerWebhookUrl(url);
    if (!result) {
      return c.json({
        ok: false,
        error: { code: 'KARVI_UNAVAILABLE', message: 'Failed to register webhook URL on Karvi' },
      }, 502);
    }
    return c.json({ ok: true, data: { url } });
  });

  app.get('/api/bridges/karvi/webhook-url', (c) => {
    const url = karvi.getRegisteredWebhookUrl();
    return c.json({ ok: true, data: { url, registered: url !== null } });
  });

  // === Edda Bridge ===

  app.get('/api/bridges/edda/status', async (c) => {
    const health = await edda.getHealth();
    return c.json({ ok: true, data: health });
  });

  app.post('/api/bridges/edda/query', async (c) => {
    const parsed = EddaQueryInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    const { data } = parsed;
    const results = await edda.queryDecisions({
      q: data.q,
      domain: data.domain,
      keyword: data.keyword,
      limit: data.limit,
      includeSuperseded: data.include_superseded,
      branch: data.branch,
    });
    return c.json({ ok: true, data: results });
  });

  app.post('/api/bridges/edda/decide', async (c) => {
    const parsed = EddaDecideInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    const result = await edda.recordDecision(parsed.data);
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

  app.post('/api/bridges/edda/note', async (c) => {
    const parsed = EddaNoteInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    const result = await edda.recordNote(parsed.data);
    if (!result) {
      return c.json({ ok: false, error: { code: 'EDDA_UNAVAILABLE', message: 'Edda unreachable' } }, 502);
    }
    return c.json({ ok: true, data: result }, 201);
  });

  app.get('/api/bridges/edda/log', async (c) => {
    const entries = await edda.queryEventLog({
      type: c.req.query('type') || undefined,
      keyword: c.req.query('keyword') || undefined,
      after: c.req.query('after') || undefined,
      before: c.req.query('before') || undefined,
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    });
    return c.json({ ok: true, data: entries });
  });

  return app;
}
