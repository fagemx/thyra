import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { bridgeRoutes } from './bridges';
import type { KarviBridge } from '../karvi-bridge';
import type { EddaBridge } from '../edda-bridge';

// ---------------------------------------------------------------------------
// Mock factories — minimal stubs for KarviBridge and EddaBridge
// ---------------------------------------------------------------------------

function mockKarviBridge(overrides: Partial<KarviBridge> = {}): KarviBridge {
  return {
    getHealth: async () => ({ ok: true, url: 'http://localhost:4000' }),
    dispatchProject: async () => ({ project: { id: 'proj-1', taskIds: ['t1'] }, taskCount: 1 }),
    dispatchSingleTask: async () => ({ dispatched: true, planId: 'plan-1' }),
    getRecentEvents: () => [],
    cancelTask: async () => true,
    getBoard: async () => ({ projects: [], tasks: [] }),
    getStatus: async () => ({ healthy: true }),
    getTaskProgress: async () => ({ taskId: 'task-1', status: 'running', progress: 50 }),
    ingestEvent: () => ({ ingested: true }),
    registerWebhookUrl: async () => true,
    getRegisteredWebhookUrl: () => null,
    ...overrides,
  } as unknown as KarviBridge;
}

function mockEddaBridge(overrides: Partial<EddaBridge> = {}): EddaBridge {
  return {
    getHealth: async () => ({ ok: true, url: 'http://localhost:5000' }),
    queryDecisions: async () => ({
      query: 'test',
      input_type: 'keyword',
      decisions: [],
      timeline: [],
      related_commits: [],
      related_notes: [],
    }),
    recordDecision: async () => ({ event_id: 'evt-1' }),
    getDecisionOutcomes: async () => ({ outcomes: [] }),
    getRecentRecorded: () => [],
    recordNote: async () => ({ event_id: 'note-1' }),
    queryEventLog: async () => [],
    ...overrides,
  } as unknown as EddaBridge;
}

function setupApp(
  karviOverrides: Partial<KarviBridge> = {},
  eddaOverrides: Partial<EddaBridge> = {},
) {
  const karvi = mockKarviBridge(karviOverrides);
  const edda = mockEddaBridge(eddaOverrides);

  const app = new Hono();
  app.onError((err, c) => {
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });
  app.route('', bridgeRoutes(karvi, edda));

  return { app, karvi, edda };
}

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bridge Routes — Karvi', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = setupApp());
  });

  it('GET /api/bridges/karvi/status returns health', async () => {
    const res = await app.request('/api/bridges/karvi/status');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { ok: boolean; url: string } };
    expect(body.ok).toBe(true);
    expect(body.data.ok).toBe(true);
  });

  it('POST /api/bridges/karvi/dispatch returns 201', async () => {
    const res = await post(app, '/api/bridges/karvi/dispatch', {
      title: 'My Project',
      tasks: [{ title: 'task1', description: 'do stuff' }],
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; data: { project: { id: string } } };
    expect(body.ok).toBe(true);
    expect(body.data.project.id).toBe('proj-1');
  });

  it('POST /api/bridges/karvi/dispatch returns 400 for invalid input', async () => {
    const res = await post(app, '/api/bridges/karvi/dispatch', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('POST /api/bridges/karvi/dispatch returns 502 when Karvi unavailable', async () => {
    const { app: unavailableApp } = setupApp({
      dispatchProject: async () => null,
    });
    const res = await post(unavailableApp, '/api/bridges/karvi/dispatch', {
      title: 'My Project',
      tasks: [{ title: 'task1', description: 'do stuff' }],
    });
    expect(res.status).toBe(502);
  });

  it('GET /api/bridges/karvi/events returns recent events', async () => {
    const res = await app.request('/api/bridges/karvi/events');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST /api/bridges/karvi/tasks/:taskId/cancel returns success', async () => {
    const res = await app.request('/api/bridges/karvi/tasks/task-1/cancel', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { cancelled: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.cancelled).toBe(true);
  });

  it('GET /api/bridges/karvi/board returns board', async () => {
    const res = await app.request('/api/bridges/karvi/board');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('GET /api/bridges/karvi/runtime-status returns status', async () => {
    const res = await app.request('/api/bridges/karvi/runtime-status');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('POST /api/webhooks/karvi accepts valid webhook', async () => {
    const res = await post(app, '/api/webhooks/karvi', {
      version: 'karvi.event.v1',
      event_type: 'task.completed',
      event_id: 'evt_abc123',
      occurred_at: new Date().toISOString(),
      taskId: 'task-1',
      stepId: 'step-1',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('POST /api/webhooks/karvi rejects invalid webhook', async () => {
    const res = await post(app, '/api/webhooks/karvi', {
      bad: 'data',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/bridges/karvi/webhook-url validates URL', async () => {
    const res = await post(app, '/api/bridges/karvi/webhook-url', {
      url: 'not-a-url',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
  });

  it('POST /api/bridges/karvi/webhook-url accepts valid URL', async () => {
    const res = await post(app, '/api/bridges/karvi/webhook-url', {
      url: 'http://localhost:3000/webhook',
    });
    expect(res.status).toBe(200);
  });

  it('GET /api/bridges/karvi/webhook-url returns current URL', async () => {
    const res = await app.request('/api/bridges/karvi/webhook-url');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { url: null; registered: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.registered).toBe(false);
  });
});

describe('Bridge Routes — Edda', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = setupApp());
  });

  it('GET /api/bridges/edda/status returns health', async () => {
    const res = await app.request('/api/bridges/edda/status');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { ok: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.ok).toBe(true);
  });

  it('POST /api/bridges/edda/query returns decisions', async () => {
    const res = await post(app, '/api/bridges/edda/query', {
      q: 'test query',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { decisions: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.decisions).toBeDefined();
  });

  it('POST /api/bridges/edda/decide returns 201', async () => {
    const res = await post(app, '/api/bridges/edda/decide', {
      domain: 'test',
      aspect: 'setting',
      value: 'enabled',
      reason: 'for testing',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; data: { event_id: string } };
    expect(body.ok).toBe(true);
    expect(body.data.event_id).toBe('evt-1');
  });

  it('POST /api/bridges/edda/decide returns 502 when Edda unavailable', async () => {
    const { app: unavailableApp } = setupApp({}, {
      recordDecision: async () => null,
    });
    const res = await post(unavailableApp, '/api/bridges/edda/decide', {
      domain: 'test',
      aspect: 'setting',
      value: 'enabled',
    });
    expect(res.status).toBe(502);
  });

  it('GET /api/bridges/edda/decisions/:eventId/outcomes returns outcomes', async () => {
    const res = await app.request('/api/bridges/edda/decisions/evt-1/outcomes');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('GET /api/bridges/edda/decisions/:eventId/outcomes returns 404 when not found', async () => {
    const { app: notFoundApp } = setupApp({}, {
      getDecisionOutcomes: async () => null,
    });
    const res = await notFoundApp.request('/api/bridges/edda/decisions/evt-missing/outcomes');
    expect(res.status).toBe(404);
  });

  it('GET /api/bridges/edda/recent returns recent recorded', async () => {
    const res = await app.request('/api/bridges/edda/recent');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST /api/bridges/edda/note records a note', async () => {
    const res = await post(app, '/api/bridges/edda/note', {
      text: 'Session note',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; data: { event_id: string } };
    expect(body.ok).toBe(true);
    expect(body.data.event_id).toBe('note-1');
  });

  it('POST /api/bridges/edda/note returns 502 when Edda unavailable', async () => {
    const { app: unavailableApp } = setupApp({}, {
      recordNote: async () => null,
    });
    const res = await post(unavailableApp, '/api/bridges/edda/note', {
      text: 'Session note',
    });
    expect(res.status).toBe(502);
  });

  it('GET /api/bridges/edda/log returns event log', async () => {
    const res = await app.request('/api/bridges/edda/log');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
