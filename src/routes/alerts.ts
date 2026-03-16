/**
 * alerts.ts -- Alert REST API routes (#236)
 *
 * Routes:
 *   GET    /api/villages/:village_id/world/alerts           -> list alerts (filterable)
 *   GET    /api/villages/:village_id/world/alerts/count     -> active count (badge)
 *   GET    /api/villages/:village_id/world/alerts/:id       -> single alert
 *   POST   /api/villages/:village_id/world/alerts/:id/ack   -> acknowledge
 *   POST   /api/villages/:village_id/world/alerts/:id/resolve -> resolve
 *   POST   /api/villages/:village_id/world/webhooks         -> register webhook
 *   GET    /api/villages/:village_id/world/webhooks         -> list webhooks
 *   DELETE /api/villages/:village_id/world/webhooks/:id     -> remove webhook
 */

import { Hono } from 'hono';
import { AlertManager } from '../alert-manager';
import { WebhookDispatcher } from '../alert-webhook';
import {
  AcknowledgeAlertInput,
  ResolveAlertInput,
  ListAlertsQuery,
  CreateWebhookInput,
} from '../schemas/alert';

export function alertRoutes(am: AlertManager, wd: WebhookDispatcher): Hono {
  const app = new Hono();
  const base = '/api/villages/:village_id/world';

  // GET /world/alerts/count — active count (for badge)
  // Must be before /:id route to avoid conflict
  app.get(`${base}/alerts/count`, (c) => {
    const villageId = c.req.param('village_id');
    const count = am.countActive(villageId);
    return c.json({ ok: true, data: { count } });
  });

  // GET /world/alerts — list alerts
  app.get(`${base}/alerts`, (c) => {
    const villageId = c.req.param('village_id');
    const parsed = ListAlertsQuery.safeParse({
      status: c.req.query('status'),
      type: c.req.query('type'),
      severity: c.req.query('severity'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const alerts = am.list(villageId, parsed.data);
    return c.json({ ok: true, data: alerts });
  });

  // GET /world/alerts/:id — single alert
  app.get(`${base}/alerts/:id`, (c) => {
    const alert = am.get(c.req.param('id'));
    if (!alert) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } },
        404,
      );
    }
    return c.json({ ok: true, data: alert });
  });

  // POST /world/alerts/:id/ack — acknowledge
  app.post(`${base}/alerts/:id/ack`, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = AcknowledgeAlertInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    try {
      const alert = am.acknowledge(c.req.param('id'), parsed.data.actor);
      return c.json({ ok: true, data: alert });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const code = message.includes('not found') ? 'NOT_FOUND' : 'INVALID_STATE';
      const status = message.includes('not found') ? 404 : 409;
      return c.json({ ok: false, error: { code, message } }, status);
    }
  });

  // POST /world/alerts/:id/resolve — resolve
  app.post(`${base}/alerts/:id/resolve`, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = ResolveAlertInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    try {
      const alert = am.resolve(c.req.param('id'), parsed.data.actor, parsed.data.resolution_note);
      return c.json({ ok: true, data: alert });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const code = message.includes('not found') ? 'NOT_FOUND' : 'INVALID_STATE';
      const status = message.includes('not found') ? 404 : 409;
      return c.json({ ok: false, error: { code, message } }, status);
    }
  });

  // POST /world/webhooks — register webhook
  app.post(`${base}/webhooks`, async (c) => {
    const villageId = c.req.param('village_id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = CreateWebhookInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const webhook = wd.register(
      villageId,
      parsed.data.url,
      parsed.data.events,
      parsed.data.secret,
    );
    return c.json({ ok: true, data: webhook }, 201);
  });

  // GET /world/webhooks — list webhooks
  app.get(`${base}/webhooks`, (c) => {
    const villageId = c.req.param('village_id');
    const webhooks = wd.list(villageId);
    return c.json({ ok: true, data: webhooks });
  });

  // DELETE /world/webhooks/:id — remove webhook
  app.delete(`${base}/webhooks/:id`, (c) => {
    try {
      wd.remove(c.req.param('id'));
      return c.json({ ok: true, data: { removed: true } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message } },
        404,
      );
    }
  });

  return app;
}
