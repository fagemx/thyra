import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { schedulerRoutes, type SchedulerLike } from './scheduler';
import { createDb, initSchema } from '../db';
import type { Database } from 'bun:sqlite';

/** 簡易 mock scheduler */
function createMockScheduler(overrides?: Partial<SchedulerLike>): SchedulerLike {
  let running = false;
  return {
    isRunning: () => running,
    getVillageId: () => 'v-1',
    getIntervalMs: () => 30_000,
    getLastCycleAt: () => null,
    start() { running = true; },
    stop() { running = false; },
    ...overrides,
  };
}

describe('schedulerRoutes', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
  });

  describe('without scheduler instance', () => {
    it('GET /status returns 503', async () => {
      const app = new Hono();
      app.route('', schedulerRoutes({ db }));
      const res = await app.request('/api/scheduler/status');
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('SCHEDULER_NOT_INITIALIZED');
    });

    it('POST /stop returns 503', async () => {
      const app = new Hono();
      app.route('', schedulerRoutes({ db }));
      const res = await app.request('/api/scheduler/stop', { method: 'POST' });
      expect(res.status).toBe(503);
    });

    it('POST /start returns 503', async () => {
      const app = new Hono();
      app.route('', schedulerRoutes({ db }));
      const res = await app.request('/api/scheduler/start', { method: 'POST' });
      expect(res.status).toBe(503);
    });
  });

  describe('with scheduler instance', () => {
    it('GET /status returns scheduler state', async () => {
      const scheduler = createMockScheduler();
      const app = new Hono();
      app.route('', schedulerRoutes({ scheduler, db }));

      const res = await app.request('/api/scheduler/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.running).toBe(false);
      expect(json.data.village_id).toBe('v-1');
    });

    it('POST /stop when running', async () => {
      const scheduler = createMockScheduler();
      scheduler.start();
      const app = new Hono();
      app.route('', schedulerRoutes({ scheduler, db }));

      const res = await app.request('/api/scheduler/stop', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.running).toBe(false);
    });

    it('POST /stop when already stopped returns 400', async () => {
      const scheduler = createMockScheduler();
      const app = new Hono();
      app.route('', schedulerRoutes({ scheduler, db }));

      const res = await app.request('/api/scheduler/stop', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('SCHEDULER_NOT_RUNNING');
    });

    it('POST /start when stopped', async () => {
      const scheduler = createMockScheduler();
      const app = new Hono();
      app.route('', schedulerRoutes({ scheduler, db }));

      const res = await app.request('/api/scheduler/start', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.running).toBe(true);
    });

    it('POST /start when already running returns 400', async () => {
      const scheduler = createMockScheduler();
      scheduler.start();
      const app = new Hono();
      app.route('', schedulerRoutes({ scheduler, db }));

      const res = await app.request('/api/scheduler/start', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('SCHEDULER_ALREADY_RUNNING');
    });

    it('stop writes audit log', async () => {
      const scheduler = createMockScheduler();
      scheduler.start();
      const app = new Hono();
      app.route('', schedulerRoutes({ scheduler, db }));

      await app.request('/api/scheduler/stop', { method: 'POST' });

      const row = db.prepare('SELECT * FROM audit_log WHERE action = ?').get('stop') as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.entity_type).toBe('scheduler');
      expect(row.actor).toBe('human');
    });
  });
});
