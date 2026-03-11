import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { KarviBridge } from './karvi-bridge';
import type { KarviEventNormalized } from './karvi-bridge';
import { KarviWebhookPayloadSchema, normalizeKarviEvent } from './schemas/karvi-event';
import type { KarviWebhookPayload } from './schemas/karvi-event';

// Mock Karvi server using Bun.serve
let mockServer: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { method: string; url: string; body?: unknown } | null = null;
let mockResponses: Map<string, { status: number; body: unknown }> = new Map();

function startMockKarvi(port: number) {
  mockServer = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      lastRequest = { method: req.method, url: url.pathname };

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

/** Helper: build a Karvi v1 webhook payload matching step-worker.js output */
function makeKarviPayload(overrides: Partial<KarviWebhookPayload> = {}): KarviWebhookPayload {
  const now = new Date().toISOString();
  return {
    version: 'karvi.event.v1',
    event_id: `evt_${crypto.randomUUID()}`,
    event_type: 'step_completed',
    occurred_at: now,
    event: 'step_completed',
    ts: now,
    taskId: 'THYRA-v1-123',
    stepId: 'step_abc',
    ...overrides,
  };
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
      // No mock server started -> connection refused
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

  describe('Zod schema validation', () => {
    it('accepts valid Karvi v1 payload', () => {
      const payload = makeKarviPayload();
      const result = KarviWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects payload missing version', () => {
      const { version: _, ...noVersion } = makeKarviPayload();
      const result = KarviWebhookPayloadSchema.safeParse(noVersion);
      expect(result.success).toBe(false);
    });

    it('rejects payload with wrong version', () => {
      const payload = { ...makeKarviPayload(), version: 'karvi.event.v2' };
      const result = KarviWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects payload missing taskId', () => {
      const { taskId: _, ...noTaskId } = makeKarviPayload();
      const result = KarviWebhookPayloadSchema.safeParse(noTaskId);
      expect(result.success).toBe(false);
    });

    it('rejects payload missing stepId', () => {
      const { stepId: _, ...noStepId } = makeKarviPayload();
      const result = KarviWebhookPayloadSchema.safeParse(noStepId);
      expect(result.success).toBe(false);
    });

    it('rejects payload with invalid event_id prefix', () => {
      const payload = makeKarviPayload({ event_id: 'bad_123' });
      const result = KarviWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('accepts payload with extra fields via passthrough', () => {
      const payload = { ...makeKarviPayload(), customField: 'extra' };
      const result = KarviWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('normalizeKarviEvent', () => {
    it('converts camelCase to snake_case', () => {
      const payload = makeKarviPayload({
        taskId: 'task_abc',
        stepId: 'step_xyz',
        stepType: 'implement',
      });
      const normalized = normalizeKarviEvent(payload);
      expect(normalized.task_id).toBe('task_abc');
      expect(normalized.step_id).toBe('step_xyz');
      expect(normalized.step_type).toBe('implement');
    });

    it('preserves event metadata', () => {
      const payload = makeKarviPayload({
        event_id: 'evt_test-001',
        event_type: 'step_failed',
        occurred_at: '2026-03-12T10:00:00.000Z',
        state: 'failed',
        error: 'compile error',
      });
      const normalized = normalizeKarviEvent(payload);
      expect(normalized.event_id).toBe('evt_test-001');
      expect(normalized.event_type).toBe('step_failed');
      expect(normalized.occurred_at).toBe('2026-03-12T10:00:00.000Z');
      expect(normalized.state).toBe('failed');
      expect(normalized.error).toBe('compile error');
    });

    it('stores raw payload for audit', () => {
      const payload = makeKarviPayload();
      const normalized = normalizeKarviEvent(payload);
      expect(normalized.raw).toBeDefined();
      expect((normalized.raw as Record<string, unknown>).version).toBe('karvi.event.v1');
    });
  });

  describe('event ingestion', () => {
    it('ingestEvent stores event in audit log', () => {
      const event = normalizeKarviEvent(makeKarviPayload({
        event_id: 'evt_test-001',
        taskId: 'THYRA-v1-123',
      }));

      const result = bridge.ingestEvent(event);

      expect(result.ingested).toBe(true);
      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'karvi_event'").all();
      expect(logs).toHaveLength(1);
    });

    it('ingestEvent stores event_id in audit log', () => {
      const event = normalizeKarviEvent(makeKarviPayload({
        event_id: 'evt_test-002',
      }));

      bridge.ingestEvent(event);

      const row = db.prepare(
        "SELECT event_id FROM audit_log WHERE entity_type = 'karvi_event'"
      ).get() as Record<string, unknown>;
      expect(row.event_id).toBe('evt_test-002');
    });

    it('ingestEvent is idempotent on duplicate event_id', () => {
      const payload = makeKarviPayload({ event_id: 'evt_dup-001' });
      const event = normalizeKarviEvent(payload);

      const first = bridge.ingestEvent(event);
      const second = bridge.ingestEvent(event);

      expect(first.ingested).toBe(true);
      expect(second.ingested).toBe(false);

      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'karvi_event'").all();
      expect(logs).toHaveLength(1);
    });

    it('getRecentEvents returns ingested events in normalized format', () => {
      bridge.ingestEvent(normalizeKarviEvent(makeKarviPayload({
        event_id: 'evt_r1',
        event_type: 'step_completed',
        taskId: 'T1',
        stepId: 'step_1',
      })));
      bridge.ingestEvent(normalizeKarviEvent(makeKarviPayload({
        event_id: 'evt_r2',
        event_type: 'step_failed',
        taskId: 'T2',
        stepId: 'step_2',
      })));

      const events = bridge.getRecentEvents();
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.task_id)).toContain('T1');
      expect(events.map((e) => e.task_id)).toContain('T2');
      expect(events.map((e) => e.event_type)).toContain('step_completed');
      expect(events.map((e) => e.event_type)).toContain('step_failed');
    });

    it('getRecentEvents reconstructs step_id from raw payload', () => {
      bridge.ingestEvent(normalizeKarviEvent(makeKarviPayload({
        event_id: 'evt_sid-1',
        stepId: 'step_xyz',
      })));

      const events = bridge.getRecentEvents();
      expect(events[0].step_id).toBe('step_xyz');
    });

    it('getRecentEvents respects limit', () => {
      for (let i = 0; i < 5; i++) {
        bridge.ingestEvent(normalizeKarviEvent(makeKarviPayload({
          event_id: `evt_lim-${i}`,
          taskId: `T${i}`,
          stepId: `step_${i}`,
        })));
      }

      expect(bridge.getRecentEvents(2)).toHaveLength(2);
    });
  });
});
