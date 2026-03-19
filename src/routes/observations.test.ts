/**
 * observations.test.ts — Observation batch API route tests
 *
 * Tests for observation endpoints (spec SS10.1-10.2):
 * - POST /api/v1/cycles/:id/observations — create observation batch
 * - GET  /api/v1/cycles/:id/observations — get observation batch
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { cycleRoutes } from './cycles';
import { observationRoutes } from './observations';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const app = new Hono();
  app.onError((err, c) => {
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });
  app.route('', cycleRoutes(db));
  app.route('', observationRoutes(db));

  return { db, app };
}

async function json(app: Hono, method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await app.request(path, opts);
  const data = await res.json() as Record<string, unknown>;
  return { status: res.status, body: data };
}

const WORLD_ID = 'world_test_001';

function openCycleBody() {
  return { mode: 'normal', openedBy: { type: 'system', id: 'scheduler' } };
}

function sampleObservation(id = 'obs_001') {
  return {
    id,
    source: 'state_diff',
    timestamp: new Date().toISOString(),
    scope: 'world',
    importance: 'medium',
    summary: 'Market capacity changed from 100 to 120',
  };
}

async function createCycle(app: Hono): Promise<string> {
  const { body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
  return (body.data as Record<string, string>).cycleId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Observation Routes', () => {
  let app: Hono;

  beforeEach(() => {
    const ctx = setup();
    app = ctx.app;
  });

  // =========================================================================
  // POST /api/v1/cycles/:id/observations — Create Batch (SS10.1)
  // =========================================================================
  describe('POST /api/v1/cycles/:id/observations', () => {
    it('should create an observation batch with 201', async () => {
      const cycleId = await createCycle(app);

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [sampleObservation()],
      });

      expect(status).toBe(201);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.cycleId).toBe(cycleId);
      expect(data.worldId).toBe(WORLD_ID);
      expect((data.observations as unknown[]).length).toBe(1);
      expect(data.id).toBeDefined();
    });

    it('should reject if cycle does not exist', async () => {
      const { status, body } = await json(app, 'POST', '/api/v1/cycles/nonexistent/observations', {
        observations: [sampleObservation()],
      });

      expect(status).toBe(404);
      expect(body.ok).toBe(false);
      expect((body.error as Record<string, string>).code).toBe('NOT_FOUND');
    });

    it('should reject if cycle is closed', async () => {
      const cycleId = await createCycle(app);
      await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [sampleObservation()],
      });

      expect(status).toBe(409);
      expect((body.error as Record<string, string>).code).toBe('CYCLE_CLOSED');
    });

    it('should reject duplicate batch for same cycle', async () => {
      const cycleId = await createCycle(app);
      await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [sampleObservation()],
      });

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [sampleObservation('obs_002')],
      });

      expect(status).toBe(409);
      expect((body.error as Record<string, string>).code).toBe('BATCH_EXISTS');
    });

    it('should reject empty observations array', async () => {
      const cycleId = await createCycle(app);

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [],
      });

      expect(status).toBe(400);
      expect((body.error as Record<string, string>).code).toBe('VALIDATION');
    });

    it('should reject invalid observation schema', async () => {
      const cycleId = await createCycle(app);

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [{ bad: 'data' }],
      });

      expect(status).toBe(400);
      expect((body.error as Record<string, string>).code).toBe('VALIDATION');
    });
  });

  // =========================================================================
  // GET /api/v1/cycles/:id/observations — Get Batch (SS10.2)
  // =========================================================================
  describe('GET /api/v1/cycles/:id/observations', () => {
    it('should return observation batch', async () => {
      const cycleId = await createCycle(app);
      await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [sampleObservation()],
      });

      const { status, body } = await json(app, 'GET', `/api/v1/cycles/${cycleId}/observations`);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.cycleId).toBe(cycleId);
      expect((data.observations as unknown[]).length).toBe(1);
    });

    it('should return 404 when no batch exists', async () => {
      const cycleId = await createCycle(app);

      const { status, body } = await json(app, 'GET', `/api/v1/cycles/${cycleId}/observations`);

      expect(status).toBe(404);
      expect((body.error as Record<string, string>).code).toBe('NOT_FOUND');
    });

    it('should return 404 for non-existent cycle', async () => {
      const { status, body } = await json(app, 'GET', '/api/v1/cycles/nonexistent/observations');

      expect(status).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  // =========================================================================
  // THY-11 Envelope compliance
  // =========================================================================
  describe('THY-11 envelope compliance', () => {
    it('success responses have { ok: true, data }', async () => {
      const cycleId = await createCycle(app);
      const { body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
        observations: [sampleObservation()],
      });
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('data');
    });

    it('error responses have { ok: false, error: { code, message } }', async () => {
      const { body } = await json(app, 'GET', '/api/v1/cycles/nonexistent/observations');
      expect(body).toHaveProperty('ok', false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });
});
