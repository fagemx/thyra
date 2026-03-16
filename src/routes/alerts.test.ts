import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { initSchema } from '../db';
import { AlertManager } from '../alert-manager';
import { WebhookDispatcher } from '../alert-webhook';
import { VillageManager } from '../village-manager';
import { alertRoutes } from './alerts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const am = new AlertManager(db, { dedupWindowMs: 0 });
  const wd = new WebhookDispatcher(db);
  const village = vm.create({ name: 'Route Test Village', target_repo: 'test/repo' }, 'test');

  const app = new Hono();
  app.route('', alertRoutes(am, wd));

  return { db, am, wd, village, app };
}

async function json(app: Hono, method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { 'Content-Type': 'application/json' };
  }
  const res = await app.request(path, opts);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('alertRoutes', () => {
  let am: AlertManager;
  let app: Hono;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    am = s.am;
    app = s.app;
    villageId = s.village.id;
  });

  // -----------------------------------------------------------------------
  // Alerts CRUD
  // -----------------------------------------------------------------------

  describe('GET /alerts', () => {
    it('should list alerts for a village', async () => {
      am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const { status, body } = await json(app, 'GET', `/api/villages/${villageId}/world/alerts`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect((body.data as unknown[]).length).toBe(1);
    });
  });

  describe('GET /alerts/count', () => {
    it('should return active count', async () => {
      am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      am.emit(villageId, 'chief_timeout', 'critical', 'T2', 'M2');
      const { status, body } = await json(app, 'GET', `/api/villages/${villageId}/world/alerts/count`);
      expect(status).toBe(200);
      expect((body.data as Record<string, unknown>).count).toBe(2);
    });
  });

  describe('GET /alerts/:id', () => {
    it('should return single alert', async () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const { status, body } = await json(app, 'GET', `/api/villages/${villageId}/world/alerts/${alert.id}`);
      expect(status).toBe(200);
      expect((body.data as Record<string, unknown>).id).toBe(alert.id);
    });

    it('should return 404 for nonexistent alert', async () => {
      const { status } = await json(app, 'GET', `/api/villages/${villageId}/world/alerts/nonexistent`);
      expect(status).toBe(404);
    });
  });

  describe('POST /alerts/:id/ack', () => {
    it('should acknowledge an alert', async () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const { status, body } = await json(
        app, 'POST',
        `/api/villages/${villageId}/world/alerts/${alert.id}/ack`,
        { actor: 'operator-1' },
      );
      expect(status).toBe(200);
      expect((body.data as Record<string, unknown>).status).toBe('acknowledged');
    });

    it('should return 400 for missing actor', async () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const { status } = await json(
        app, 'POST',
        `/api/villages/${villageId}/world/alerts/${alert.id}/ack`,
        {},
      );
      expect(status).toBe(400);
    });
  });

  describe('POST /alerts/:id/resolve', () => {
    it('should resolve an alert', async () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const { status, body } = await json(
        app, 'POST',
        `/api/villages/${villageId}/world/alerts/${alert.id}/resolve`,
        { actor: 'operator-1', resolution_note: 'fixed' },
      );
      expect(status).toBe(200);
      expect((body.data as Record<string, unknown>).status).toBe('resolved');
    });
  });

  // -----------------------------------------------------------------------
  // Webhooks CRUD
  // -----------------------------------------------------------------------

  describe('POST /webhooks', () => {
    it('should register a webhook', async () => {
      const { status, body } = await json(
        app, 'POST',
        `/api/villages/${villageId}/world/webhooks`,
        { url: 'https://example.com/hook' },
      );
      expect(status).toBe(201);
      expect((body.data as Record<string, unknown>).url).toBe('https://example.com/hook');
    });

    it('should reject invalid URL', async () => {
      const { status } = await json(
        app, 'POST',
        `/api/villages/${villageId}/world/webhooks`,
        { url: 'not-a-url' },
      );
      expect(status).toBe(400);
    });
  });

  describe('GET /webhooks', () => {
    it('should list webhooks', async () => {
      await json(app, 'POST', `/api/villages/${villageId}/world/webhooks`, { url: 'https://a.com/wh' });
      const { status, body } = await json(app, 'GET', `/api/villages/${villageId}/world/webhooks`);
      expect(status).toBe(200);
      expect((body.data as unknown[]).length).toBe(1);
    });
  });

  describe('DELETE /webhooks/:id', () => {
    it('should remove a webhook', async () => {
      const { body: createBody } = await json(
        app, 'POST',
        `/api/villages/${villageId}/world/webhooks`,
        { url: 'https://a.com/wh' },
      );
      const whId = (createBody.data as Record<string, unknown>).id as string;

      const { status } = await json(app, 'DELETE', `/api/villages/${villageId}/world/webhooks/${whId}`);
      expect(status).toBe(200);
    });

    it('should return 404 for nonexistent webhook', async () => {
      const { status } = await json(app, 'DELETE', `/api/villages/${villageId}/world/webhooks/wh_nonexistent`);
      expect(status).toBe(404);
    });
  });
});
