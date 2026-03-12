import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { KarviBridge } from './karvi-bridge';
import type { KarviEventNormalized } from './karvi-bridge';
import { KarviWebhookPayloadSchema, normalizeKarviEvent } from './schemas/karvi-event';
import type { KarviWebhookPayload } from './schemas/karvi-event';

// Mock Karvi server using Bun.serve
let mockServer: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { method: string; url: string; search?: string; body?: unknown } | null = null;
let allRequests: { method: string; url: string; search?: string; body?: unknown }[] = [];
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
      lastRequest = { method: req.method, url: url.pathname, search: url.search, body };
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

  describe('dispatchProject', () => {
    const PROJECT_RESPONSE = {
      ok: true,
      title: 'Review PR',
      taskCount: 1,
      project: {
        id: 'PROJ-abc',
        title: 'Review PR',
        repo: 'org/repo',
        status: 'executing',
        concurrency: 3,
        completionTrigger: 'pr_merged',
        taskIds: ['task-1'],
        createdAt: '2026-03-12T00:00:00Z',
      },
    };

    it('dispatches project to Karvi with correct format', async () => {
      mockResponses.set('POST /api/projects', { status: 201, body: PROJECT_RESPONSE });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.dispatchProject({
        title: 'Review PR',
        tasks: [{ id: 'task-1', title: 'Check code', assignee: 'engineer_lite', target_repo: 'org/repo' }],
      });

      expect(result).not.toBeNull();
      expect(result!.project?.id).toBe('PROJ-abc');
      expect(result!.taskCount).toBe(1);
      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/api/projects');
    });

    it('throws on Karvi error response', async () => {
      mockResponses.set('POST /api/projects', { status: 500, body: { error: 'fail' } });
      startMockKarvi(MOCK_PORT);

      await expect(bridge.dispatchProject({
        title: 'test',
        tasks: [{ title: 'a' }],
      })).rejects.toThrow('Karvi dispatch failed: 500');
    });

    it('returns null when Karvi unreachable (graceful degradation)', async () => {
      // Use a port where nothing is listening
      const offlineBridge = new KarviBridge(db, 'http://localhost:19999');
      const result = await offlineBridge.dispatchProject({
        title: 'test',
        tasks: [{ title: 'a' }],
      });
      expect(result).toBeNull();
    });

    it('records audit log on successful dispatch', async () => {
      mockResponses.set('POST /api/projects', { status: 201, body: PROJECT_RESPONSE });
      startMockKarvi(MOCK_PORT);

      await bridge.dispatchProject({
        title: 'test',
        tasks: [{ title: 'a' }],
      });

      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'karvi' AND action = 'dispatch'").all();
      expect(logs).toHaveLength(1);
    });

    it('validates input with Zod (rejects empty tasks)', async () => {
      await expect(bridge.dispatchProject({
        title: 'test',
        tasks: [],
      })).rejects.toThrow();
    });

    it('supports optional fields: concurrency, autoStart, goal', async () => {
      mockResponses.set('POST /api/projects', { status: 201, body: PROJECT_RESPONSE });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.dispatchProject({
        title: 'Big project',
        tasks: [{ title: 'a' }, { title: 'b' }],
        concurrency: 5,
        autoStart: true,
        goal: 'Ship feature X',
      });

      expect(result).not.toBeNull();
    });
  });

  describe('dispatchSingleTask', () => {
    it('dispatches single task by ID', async () => {
      mockResponses.set('POST /api/tasks/task-1/dispatch', {
        status: 200,
        body: { ok: true, taskId: 'task-1', dispatched: true, planId: 'plan-abc' },
      });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.dispatchSingleTask('task-1');
      expect(result).not.toBeNull();
      expect(result!.dispatched).toBe(true);
      expect(result!.planId).toBe('plan-abc');
    });

    it('throws BUDGET_EXCEEDED on 409', async () => {
      mockResponses.set('POST /api/tasks/task-1/dispatch', {
        status: 409,
        body: { error: 'Budget exceeded', code: 'BUDGET_EXCEEDED', remaining: { llm_calls: 0, tokens: 0, wall_clock_ms: 0, steps: 0 } },
      });
      startMockKarvi(MOCK_PORT);

      await expect(bridge.dispatchSingleTask('task-1')).rejects.toThrow('BUDGET_EXCEEDED');
    });

    it('returns null when Karvi unreachable', async () => {
      const offlineBridge = new KarviBridge(db, 'http://localhost:19999');
      const result = await offlineBridge.dispatchSingleTask('task-1');
      expect(result).toBeNull();
    });

    it('records audit on budget exceeded', async () => {
      mockResponses.set('POST /api/tasks/task-1/dispatch', {
        status: 409,
        body: { error: 'Budget exceeded', code: 'BUDGET_EXCEEDED', remaining: { llm_calls: 5 } },
      });
      startMockKarvi(MOCK_PORT);

      await bridge.dispatchSingleTask('task-1').catch(() => {});
      const logs = db.prepare("SELECT * FROM audit_log WHERE action = 'budget_exceeded'").all();
      expect(logs).toHaveLength(1);
    });
  });

  describe('syncBudgetControls', () => {
    const BUDGET = { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 };

    it('sends budget to Karvi controls endpoint', async () => {
      mockResponses.set('POST /api/controls', { status: 200, body: { ok: true, controls: {} } });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.syncBudgetControls('village-1', BUDGET);
      expect(result).toBe(true);
      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/api/controls');
    });

    it('records audit on success', async () => {
      mockResponses.set('POST /api/controls', { status: 200, body: { ok: true, controls: {} } });
      startMockKarvi(MOCK_PORT);

      await bridge.syncBudgetControls('village-1', BUDGET);
      const logs = db.prepare("SELECT * FROM audit_log WHERE action = 'sync_budget'").all();
      expect(logs).toHaveLength(1);
    });

    it('returns false on Karvi error', async () => {
      mockResponses.set('POST /api/controls', { status: 500, body: { error: 'fail' } });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.syncBudgetControls('village-1', BUDGET);
      expect(result).toBe(false);
    });

    it('returns false when Karvi unreachable', async () => {
      const offlineBridge = new KarviBridge(db, 'http://localhost:19999');
      const result = await offlineBridge.syncBudgetControls('village-1', BUDGET);
      expect(result).toBe(false);
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

  describe('cancelTask', () => {
    it('returns true on successful cancel', async () => {
      mockResponses.set('POST /api/tasks/THYRA-v1-123/cancel', {
        status: 200,
        body: { ok: true, taskId: 'THYRA-v1-123', cancelled: true },
      });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.cancelTask('THYRA-v1-123');
      expect(result).toBe(true);
      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/api/tasks/THYRA-v1-123/cancel');
    });

    it('records audit log on success', async () => {
      mockResponses.set('POST /api/tasks/THYRA-v1-123/cancel', {
        status: 200, body: { ok: true },
      });
      startMockKarvi(MOCK_PORT);

      await bridge.cancelTask('THYRA-v1-123');
      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'karvi' AND action = 'cancel_task'",
      ).all();
      expect(logs).toHaveLength(1);
    });

    it('returns false on error response', async () => {
      mockResponses.set('POST /api/tasks/THYRA-v1-123/cancel', {
        status: 404, body: { ok: false, error: 'not found' },
      });
      startMockKarvi(MOCK_PORT);

      const result = await bridge.cancelTask('THYRA-v1-123');
      expect(result).toBe(false);
    });

    it('returns false when Karvi is offline (graceful degradation)', async () => {
      const offlineBridge = new KarviBridge(db, 'http://localhost:19499');
      const result = await offlineBridge.cancelTask('THYRA-v1-123');
      expect(result).toBe(false);
    });
  });

  describe('getBoard', () => {
    it('returns board data on success', async () => {
      const boardData = {
        taskPlan: { tasks: [{ id: 'T1', title: 'test', status: 'done' }] },
        controls: { maxConcurrency: 3 },
      };
      mockResponses.set('GET /api/board', { status: 200, body: boardData });
      startMockKarvi(MOCK_PORT);

      const board = await bridge.getBoard();
      expect(board).not.toBeNull();
      expect(board?.taskPlan?.tasks).toHaveLength(1);
    });

    it('returns null when Karvi is offline', async () => {
      const board = await bridge.getBoard();
      expect(board).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('returns status data on success', async () => {
      const statusData = {
        status: 'running',
        tasks: { total: 5, done: 2, in_progress: 1, pending: 1, blocked: 0, failed: 1 },
        uptime: 3600,
      };
      mockResponses.set('GET /api/status', { status: 200, body: statusData });
      startMockKarvi(MOCK_PORT);

      const status = await bridge.getStatus();
      expect(status?.status).toBe('running');
      expect(status?.tasks?.total).toBe(5);
    });

    it('passes fields as query parameter', async () => {
      mockResponses.set('GET /api/status', { status: 200, body: { status: 'ok' } });
      startMockKarvi(MOCK_PORT);

      await bridge.getStatus(['core', 'steps']);
      expect(lastRequest?.search).toContain('fields=');
    });

    it('returns null when Karvi is offline', async () => {
      const status = await bridge.getStatus();
      expect(status).toBeNull();
    });
  });

  describe('getTaskProgress', () => {
    it('returns progress data on success', async () => {
      const progressData = {
        taskId: 'THYRA-v1-123',
        status: 'in_progress',
        steps: [
          { id: 'step-1', type: 'code', status: 'done', duration: 120 },
          { id: 'step-2', type: 'test', status: 'in_progress' },
        ],
        duration: 180,
      };
      mockResponses.set('GET /api/tasks/THYRA-v1-123/progress', {
        status: 200, body: progressData,
      });
      startMockKarvi(MOCK_PORT);

      const progress = await bridge.getTaskProgress('THYRA-v1-123');
      expect(progress?.taskId).toBe('THYRA-v1-123');
      expect(progress?.steps).toHaveLength(2);
    });

    it('returns null on 404', async () => {
      mockResponses.set('GET /api/tasks/nonexistent/progress', {
        status: 404, body: { ok: false },
      });
      startMockKarvi(MOCK_PORT);

      const progress = await bridge.getTaskProgress('nonexistent');
      expect(progress).toBeNull();
    });

    it('returns null when Karvi is offline', async () => {
      const progress = await bridge.getTaskProgress('THYRA-v1-123');
      expect(progress).toBeNull();
    });
  });
});
