import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { EddaBridge } from './edda-bridge';

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let mockResponses: Map<string, { status: number; body: unknown }> = new Map();
let lastRequest: { method: string; url: string; body?: unknown } | null = null;

function startMockEdda(port: number) {
  mockServer = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      lastRequest = { method: req.method, url: url.pathname };

      // Match by method + pathname (ignore query params for matching)
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

describe('EddaBridge', () => {
  let db: Database;
  let bridge: EddaBridge;
  const MOCK_PORT = 19463;
  const MOCK_URL = `http://localhost:${MOCK_PORT}`;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    lastRequest = null;
    mockResponses = new Map();
    bridge = new EddaBridge(db, MOCK_URL);
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

  describe('queryDecisions', () => {
    it('returns precedents from Edda', async () => {
      mockResponses.set('GET /api/decisions', {
        status: 200,
        body: {
          decisions: [
            { domain: 'review', aspect: 'min_approvals', value: '2', reason: 'best practice', created_at: '2024-01-01' },
          ],
        },
      });
      startMockEdda(MOCK_PORT);

      const results = await bridge.queryDecisions({ domain: 'review' });
      expect(results).toHaveLength(1);
      expect(results[0].domain).toBe('review');
    });

    it('returns empty array when Edda is down (graceful degradation)', async () => {
      // No mock server → connection refused
      const results = await bridge.queryDecisions({ domain: 'review' });
      expect(results).toEqual([]);
    });

    it('returns empty array on non-200 response', async () => {
      mockResponses.set('GET /api/decisions', { status: 500, body: { error: 'fail' } });
      startMockEdda(MOCK_PORT);

      const results = await bridge.queryDecisions({ domain: 'review' });
      expect(results).toEqual([]);
    });
  });

  describe('recordDecision', () => {
    it('records decision to Edda and returns true', async () => {
      mockResponses.set('POST /api/decisions', { status: 201, body: { ok: true } });
      startMockEdda(MOCK_PORT);

      const ok = await bridge.recordDecision({
        domain: 'law',
        aspect: 'review_policy',
        value: '2 approvals',
        reason: 'Stability requirement',
        refs: ['law-123'],
      });

      expect(ok).toBe(true);
      expect(lastRequest?.method).toBe('POST');

      // Check audit log
      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'edda' AND action = 'record'").all();
      expect(logs).toHaveLength(1);
    });

    it('returns false when Edda is down (graceful degradation)', async () => {
      const ok = await bridge.recordDecision({
        domain: 'law',
        aspect: 'test',
        value: 'v',
        reason: 'r',
      });

      expect(ok).toBe(false);
    });

    it('returns false on non-200 response', async () => {
      mockResponses.set('POST /api/decisions', { status: 500, body: { error: 'fail' } });
      startMockEdda(MOCK_PORT);

      const ok = await bridge.recordDecision({
        domain: 'law',
        aspect: 'test',
        value: 'v',
        reason: 'r',
      });

      expect(ok).toBe(false);
    });
  });

  describe('getHealth', () => {
    it('returns ok when Edda is up', async () => {
      mockResponses.set('GET /api/health', { status: 200, body: { ok: true } });
      startMockEdda(MOCK_PORT);

      const health = await bridge.getHealth();
      expect(health.ok).toBe(true);
      expect(bridge.isHealthy()).toBe(true);
    });

    it('returns not ok when Edda is down', async () => {
      const health = await bridge.getHealth();
      expect(health.ok).toBe(false);
      expect(bridge.isHealthy()).toBe(false);
    });
  });

  describe('getRecentRecorded', () => {
    it('returns recently recorded decisions from audit log', async () => {
      mockResponses.set('POST /api/decisions', { status: 201, body: { ok: true } });
      startMockEdda(MOCK_PORT);

      await bridge.recordDecision({ domain: 'law', aspect: 'a1', value: 'v1', reason: 'r1' });
      await bridge.recordDecision({ domain: 'law', aspect: 'a2', value: 'v2', reason: 'r2' });

      const recent = bridge.getRecentRecorded();
      expect(recent).toHaveLength(2);
    });

    it('returns empty when no decisions recorded', () => {
      const recent = bridge.getRecentRecorded();
      expect(recent).toEqual([]);
    });
  });
});
