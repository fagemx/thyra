/**
 * cycles.test.ts — Cycle management API route tests
 *
 * Tests for all 5 cycle endpoints (spec SS9.1-9.5):
 * - POST /api/v1/worlds/:id/cycles       — open cycle
 * - GET  /api/v1/worlds/:id/cycles/active — get active cycle
 * - GET  /api/v1/cycles/:id              — get cycle by ID
 * - POST /api/v1/cycles/:id/close        — close cycle
 * - GET  /api/v1/worlds/:id/cycles       — list cycles
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { cycleRoutes } from './cycles';

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

function openCycleBody(mode = 'normal') {
  return {
    mode,
    openedBy: { type: 'system', id: 'scheduler' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cycle Management Routes', () => {
  let app: Hono;

  beforeEach(() => {
    const ctx = setup();
    app = ctx.app;
  });

  // =========================================================================
  // POST /api/v1/worlds/:id/cycles — Open Cycle (SS9.1)
  // =========================================================================
  describe('POST /api/v1/worlds/:id/cycles', () => {
    it('should open a new cycle with 201', async () => {
      const { status, body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());

      expect(status).toBe(201);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.worldId).toBe(WORLD_ID);
      expect(data.status).toBe('open');
      expect(data.mode).toBe('normal');
      expect(data.cycleNumber).toBe(1);
      expect(data.cycleId).toBeDefined();
      expect(data.openedAt).toBeDefined();
    });

    it('should reject opening a second cycle while one is active', async () => {
      await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const { status, body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());

      expect(status).toBe(409);
      expect(body.ok).toBe(false);
      expect((body.error as Record<string, string>).code).toBe('ACTIVE_CYCLE_EXISTS');
    });

    it('should allow opening a new cycle after closing the previous one', async () => {
      const { body: first } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const firstId = (first.data as Record<string, string>).cycleId;

      // Close the first cycle
      await json(app, 'POST', `/api/v1/cycles/${firstId}/close`);

      // Open second cycle
      const { status, body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody('peak'));
      expect(status).toBe(201);
      expect((body.data as Record<string, unknown>).cycleNumber).toBe(2);
      expect((body.data as Record<string, unknown>).mode).toBe('peak');
    });

    it('should return 400 on invalid body', async () => {
      const { status, body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, { mode: 'invalid' });

      expect(status).toBe(400);
      expect(body.ok).toBe(false);
      expect((body.error as Record<string, string>).code).toBe('VALIDATION');
    });

    it('should auto-increment cycle numbers per world', async () => {
      // Open + close 3 cycles
      for (let i = 0; i < 3; i++) {
        const { body: openRes } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
        const cycleId = (openRes.data as Record<string, string>).cycleId;
        await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);
      }
      // 4th cycle
      const { body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      expect((body.data as Record<string, unknown>).cycleNumber).toBe(4);
    });
  });

  // =========================================================================
  // GET /api/v1/worlds/:id/cycles/active — Get Active Cycle (SS9.2)
  // =========================================================================
  describe('GET /api/v1/worlds/:id/cycles/active', () => {
    it('should return 404 when no active cycle', async () => {
      const { status, body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles/active`);
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
      expect((body.error as Record<string, string>).code).toBe('NO_ACTIVE_CYCLE');
    });

    it('should return the active cycle', async () => {
      const { body: openRes } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const openedCycleId = (openRes.data as Record<string, string>).cycleId;

      const { status, body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles/active`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect((body.data as Record<string, string>).cycleId).toBe(openedCycleId);
      expect((body.data as Record<string, string>).status).toBe('open');
    });

    it('should return 404 after cycle is closed', async () => {
      const { body: openRes } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const cycleId = (openRes.data as Record<string, string>).cycleId;
      await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);

      const { status } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles/active`);
      expect(status).toBe(404);
    });
  });

  // =========================================================================
  // GET /api/v1/cycles/:id — Get Cycle by ID (SS9.3)
  // =========================================================================
  describe('GET /api/v1/cycles/:id', () => {
    it('should return cycle details', async () => {
      const { body: openRes } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const cycleId = (openRes.data as Record<string, string>).cycleId;

      const { status, body } = await json(app, 'GET', `/api/v1/cycles/${cycleId}`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.cycleId).toBe(cycleId);
      expect(data.worldId).toBe(WORLD_ID);
      expect(data.proposalIds).toEqual([]);
      expect(data.judgmentReportIds).toEqual([]);
      expect(data.appliedChangeIds).toEqual([]);
    });

    it('should return 404 for non-existent cycle', async () => {
      const { status, body } = await json(app, 'GET', '/api/v1/cycles/nonexistent');
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
      expect((body.error as Record<string, string>).code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // POST /api/v1/cycles/:id/close — Close Cycle (SS9.4)
  // =========================================================================
  describe('POST /api/v1/cycles/:id/close', () => {
    it('should close an open cycle', async () => {
      const { body: openRes } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const cycleId = (openRes.data as Record<string, string>).cycleId;

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.status).toBe('closed');
      expect(data.currentStage).toBe('complete');
      expect(data.completedAt).toBeDefined();
    });

    it('should return 404 for non-existent cycle', async () => {
      const { status, body } = await json(app, 'POST', '/api/v1/cycles/nonexistent/close');
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
    });

    it('should return 409 when trying to close an already closed cycle', async () => {
      const { body: openRes } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const cycleId = (openRes.data as Record<string, string>).cycleId;

      await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);
      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);

      expect(status).toBe(409);
      expect(body.ok).toBe(false);
      expect((body.error as Record<string, string>).code).toBe('CYCLE_ALREADY_CLOSED');
    });

    it('should increment version on close', async () => {
      const { body: openRes } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      const cycleId = (openRes.data as Record<string, string>).cycleId;

      const { body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);
      expect((body.data as Record<string, unknown>).version).toBe(2);
    });
  });

  // =========================================================================
  // GET /api/v1/worlds/:id/cycles — List Cycles (SS9.5)
  // =========================================================================
  describe('GET /api/v1/worlds/:id/cycles', () => {
    it('should return empty list for world with no cycles', async () => {
      const { status, body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('should list all cycles for a world', async () => {
      // Create 2 cycles (open + close first, then open second)
      const { body: first } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      await json(app, 'POST', `/api/v1/cycles/${(first.data as Record<string, string>).cycleId}/close`);
      await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody('peak'));

      const { status, body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles`);
      expect(status).toBe(200);
      expect((body.data as unknown[]).length).toBe(2);
    });

    it('should filter by status=open', async () => {
      const { body: first } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      await json(app, 'POST', `/api/v1/cycles/${(first.data as Record<string, string>).cycleId}/close`);
      await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody('peak'));

      const { body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles?status=open`);
      const data = body.data as Record<string, unknown>[];
      expect(data.length).toBe(1);
      expect(data[0].status).toBe('open');
    });

    it('should filter by status=closed', async () => {
      const { body: first } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      await json(app, 'POST', `/api/v1/cycles/${(first.data as Record<string, string>).cycleId}/close`);
      await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());

      const { body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles?status=closed`);
      const data = body.data as Record<string, unknown>[];
      expect(data.length).toBe(1);
      expect(data[0].status).toBe('closed');
    });

    it('should filter by mode', async () => {
      const { body: first } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody('normal'));
      await json(app, 'POST', `/api/v1/cycles/${(first.data as Record<string, string>).cycleId}/close`);
      await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody('peak'));

      const { body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles?mode=peak`);
      const data = body.data as Record<string, unknown>[];
      expect(data.length).toBe(1);
      expect(data[0].mode).toBe('peak');
    });

    it('should respect limit parameter', async () => {
      // Create 3 cycles
      for (let i = 0; i < 3; i++) {
        const { body: opened } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
        await json(app, 'POST', `/api/v1/cycles/${(opened.data as Record<string, string>).cycleId}/close`);
      }

      const { body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles?limit=2`);
      expect((body.data as unknown[]).length).toBe(2);
    });

    it('should not return cycles from other worlds', async () => {
      await json(app, 'POST', '/api/v1/worlds/world_other/cycles', openCycleBody());

      const { body } = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/cycles`);
      expect((body.data as unknown[]).length).toBe(0);
    });
  });

  // =========================================================================
  // THY-11 Envelope compliance
  // =========================================================================
  describe('THY-11 envelope compliance', () => {
    it('success responses have { ok: true, data }', async () => {
      const { body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('data');
    });

    it('error responses have { ok: false, error: { code, message } }', async () => {
      const { body } = await json(app, 'GET', '/api/v1/cycles/nonexistent');
      expect(body).toHaveProperty('ok', false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });
});
