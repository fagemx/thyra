import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { KarviBridge } from './karvi-bridge';
import type { KarviEvent } from './karvi-bridge';

// Mock Karvi server using Bun.serve
let mockServer: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { method: string; url: string; body?: unknown } | null = null;
let allRequests: { method: string; url: string; body?: unknown }[] = [];
let mockResponses: Map<string, { status: number; body: unknown }> = new Map();

function startMockKarvi(port: number) {
  mockServer = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      let body: unknown = undefined;
      if (req.method === 'POST' && req.body) {
        body = await req.json();
      }
      lastRequest = { method: req.method, url: url.pathname, body };
      allRequests.push(lastRequest);

      const key = `${req.method} ${url.pathname}`;
      const mock = mockResponses.get(key);
      if (mock) {
        return new Response(JSON.stringify(mock.body), {
          status: mock.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    },
  });
}

describe('KarviBridge', () => {
  let db: Database;
  let bridge: KarviBridge;
  const MOCK_PORT = 19461;
  const MOCK_URL = `http://localhost:${MOCK_PORT}`;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    lastRequest = null;
    allRequests = [];
    mockResponses = new Map();
    bridge = new KarviBridge(db, MOCK_URL);
  });

  afterEach(() => {
    if (mockServer) {
      mockServer.stop();
      mockServer = null;
    }
  });

  afterAll(() => {
    if (mockServer) {
      mockServer.stop();
      mockServer = null;
    }
  });

  describe('dispatchTask', () => {
    it('dispatches task to Karvi and returns taskId', async () => {
      mockResponses.set('POST /api/projects', { status: 201, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.dispatchTask({
        villageId: 'v1',
        title: 'Review PR',
        description: 'Check code quality',
        targetRepo: 'org/repo',
      });

      expect(result.taskId).toMatch(/^THYRA-v1-/);
      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/api/projects');
    });

    it('throws on Karvi error', async () => {
      mockResponses.set('POST /api/projects', { status: 500, body: { error: 'fail' } });
      startMockKarvi(MOCK_PORT);

      await expect(bridge.dispatchTask({
        villageId: 'v1',
        title: 'test',
        description: 'test',
        targetRepo: 'r',
      })).rejects.toThrow('Karvi dispatch failed: 500');
    });

    it('records audit log on dispatch', async () => {
      mockResponses.set('POST /api/projects', { status: 201, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      await bridge.dispatchTask({
        villageId: 'v1',
        title: 'test',
        description: 'desc',
        targetRepo: 'r',
      });

      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'karvi'").all();
      expect(logs).toHaveLength(1);
    });
  });

  describe('getHealth', () => {
    it('returns ok when Karvi is up', async () => {
      mockResponses.set('GET /api/health/preflight', { status: 200, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      const health = await bridge.getHealth();
      expect(health.ok).toBe(true);
      expect(bridge.isHealthy()).toBe(true);
    });

    it('returns not ok when Karvi is down', async () => {
      // No mock server started → connection refused
      const health = await bridge.getHealth();
      expect(health.ok).toBe(false);
      expect(bridge.isHealthy()).toBe(false);
    });
  });

  describe('getTaskStatus', () => {
    it('returns task when found on board', async () => {
      mockResponses.set('GET /api/board', {
        status: 200,
        body: { taskPlan: { tasks: [{ id: 'THYRA-v1-123', title: 'test', status: 'done' }] } },
      });
      startMockKarvi(MOCK_PORT);

      const status = await bridge.getTaskStatus('THYRA-v1-123');
      expect(status?.id).toBe('THYRA-v1-123');
      expect(status?.status).toBe('done');
    });

    it('returns null when task not found', async () => {
      mockResponses.set('GET /api/board', {
        status: 200,
        body: { taskPlan: { tasks: [] } },
      });
      startMockKarvi(MOCK_PORT);

      const status = await bridge.getTaskStatus('nonexistent');
      expect(status).toBeNull();
    });

    it('returns null when Karvi is down', async () => {
      const status = await bridge.getTaskStatus('THYRA-v1-123');
      expect(status).toBeNull();
    });
  });

  describe('registerWebhookUrl', () => {
    it('registers webhook URL successfully and returns true', async () => {
      mockResponses.set('POST /api/controls', { status: 200, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.registerWebhookUrl('http://localhost:3462/api/webhooks/karvi');
      expect(result).toBe(true);

      // Verify the request body sent to Karvi
      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/api/controls');
      expect(lastRequest?.body).toEqual({ event_webhook_url: 'http://localhost:3462/api/webhooks/karvi' });
    });

    it('records audit log on successful registration', async () => {
      mockResponses.set('POST /api/controls', { status: 200, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      await bridge.registerWebhookUrl('http://localhost:3462/api/webhooks/karvi');

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'karvi' AND action = 'register_webhook'"
      ).all() as Record<string, unknown>[];
      expect(logs).toHaveLength(1);
      const payload = JSON.parse(logs[0].payload as string);
      expect(payload.url).toBe('http://localhost:3462/api/webhooks/karvi');
    });

    it('returns false when Karvi responds with error', async () => {
      mockResponses.set('POST /api/controls', { status: 500, body: { error: 'internal' } });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.registerWebhookUrl('http://localhost:3462/api/webhooks/karvi');
      expect(result).toBe(false);

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE action = 'register_webhook_failed'"
      ).all();
      expect(logs).toHaveLength(1);
    });

    it('returns false when Karvi is unreachable (graceful degradation)', async () => {
      // Use a port that nothing is listening on
      const offlineBridge = new KarviBridge(db, 'http://localhost:19999');
      const result = await offlineBridge.registerWebhookUrl('http://localhost:3462/api/webhooks/karvi');
      expect(result).toBe(false);

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE action = 'register_webhook_unreachable'"
      ).all();
      expect(logs).toHaveLength(1);
    });

    it('getRegisteredWebhookUrl returns null before registration', () => {
      expect(bridge.getRegisteredWebhookUrl()).toBeNull();
    });

    it('getRegisteredWebhookUrl returns URL after successful registration', async () => {
      mockResponses.set('POST /api/controls', { status: 200, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      await bridge.registerWebhookUrl('http://localhost:3462/api/webhooks/karvi');
      expect(bridge.getRegisteredWebhookUrl()).toBe('http://localhost:3462/api/webhooks/karvi');
    });

    it('getRegisteredWebhookUrl stays null after failed registration', async () => {
      mockResponses.set('POST /api/controls', { status: 500, body: { error: 'fail' } });
      startMockKarvi(MOCK_PORT);

      await bridge.registerWebhookUrl('http://localhost:3462/api/webhooks/karvi');
      expect(bridge.getRegisteredWebhookUrl()).toBeNull();
    });
  });

  describe('getHealth re-registration', () => {
    it('re-registers webhook URL on successful health check', async () => {
      mockResponses.set('POST /api/controls', { status: 200, body: { ok: true } });
      mockResponses.set('GET /api/health/preflight', { status: 200, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      // First register the webhook URL
      await bridge.registerWebhookUrl('http://localhost:3462/api/webhooks/karvi');
      allRequests = [];

      // Then trigger a health check
      await bridge.getHealth();

      // Wait briefly for the async re-registration
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify POST /api/controls was called again during health check
      const controlPosts = allRequests.filter((r) => r.method === 'POST' && r.url === '/api/controls');
      expect(controlPosts.length).toBeGreaterThanOrEqual(1);
    });

    it('does not re-register when no webhook URL is set', async () => {
      mockResponses.set('GET /api/health/preflight', { status: 200, body: { ok: true } });
      startMockKarvi(MOCK_PORT);

      await bridge.getHealth();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const controlPosts = allRequests.filter((r) => r.method === 'POST' && r.url === '/api/controls');
      expect(controlPosts).toHaveLength(0);
    });
  });

  describe('event ingestion', () => {
    it('ingestEvent stores event in audit log', () => {
      const event: KarviEvent = {
        type: 'karvi.event.v1',
        event: 'task.completed',
        task_id: 'THYRA-v1-123',
        timestamp: new Date().toISOString(),
        payload: { result: 'success' },
      };

      bridge.ingestEvent(event);

      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'karvi_event'").all();
      expect(logs).toHaveLength(1);
    });

    it('getRecentEvents returns ingested events', () => {
      bridge.ingestEvent({
        type: 'karvi.event.v1',
        event: 'task.completed',
        task_id: 'T1',
        timestamp: new Date().toISOString(),
        payload: { a: 1 },
      });
      bridge.ingestEvent({
        type: 'karvi.event.v1',
        event: 'task.failed',
        task_id: 'T2',
        timestamp: new Date().toISOString(),
        payload: { b: 2 },
      });

      const events = bridge.getRecentEvents();
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.task_id)).toContain('T1');
      expect(events.map((e) => e.task_id)).toContain('T2');
    });

    it('getRecentEvents respects limit', () => {
      for (let i = 0; i < 5; i++) {
        bridge.ingestEvent({
          type: 'karvi.event.v1',
          event: 'step.completed',
          task_id: `T${i}`,
          timestamp: new Date().toISOString(),
          payload: {},
        });
      }

      expect(bridge.getRecentEvents(2)).toHaveLength(2);
    });
  });
});
