import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from '../src/db';
import { EddaBridge } from '../src/edda-bridge';
import { bridgeRoutes } from '../src/routes/bridges';
import { KarviBridge } from '../src/karvi-bridge';
import type { EddaDecideResult } from '../src/edda-bridge';

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let mockResponses: Map<string, { status: number; body: unknown }> = new Map();

function startMockEdda(port: number) {
  mockServer = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
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

describe('Edda Bridge Route Validation', () => {
  let db: Database;
  let app: Hono;
  const MOCK_PORT = 19465;
  const MOCK_URL = `http://localhost:${MOCK_PORT}`;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    mockResponses = new Map();
    const karvi = new KarviBridge(db, 'http://localhost:19999');
    const edda = new EddaBridge(db, MOCK_URL);
    app = new Hono();
    app.route('', bridgeRoutes(karvi, edda));
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

  // --- POST /api/bridges/edda/query ---

  describe('POST /api/bridges/edda/query validation', () => {
    it('accepts empty body (all fields optional)', async () => {
      // Edda offline → graceful degradation, but validation passes
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it('accepts valid query with domain and limit', async () => {
      mockResponses.set('GET /api/decisions', {
        status: 200,
        body: { query: 'review', input_type: 'domain', decisions: [], timeline: [], related_commits: [], related_notes: [] },
      });
      startMockEdda(MOCK_PORT);

      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'review', limit: 5 }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it('rejects limit with negative value', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: -1 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects limit with zero', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 0 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects limit exceeding max (100)', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 101 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects limit with string type', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 'abc' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects include_superseded with non-boolean', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_superseded: 'yes' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects non-float limit', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 3.5 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });
  });

  // --- POST /api/bridges/edda/decide ---

  describe('POST /api/bridges/edda/decide validation', () => {
    it('rejects empty body (missing required fields)', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects empty string domain', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: '', aspect: 'x', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects empty string aspect', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', aspect: '', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects empty string value', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', aspect: 'x', value: '' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects non-string domain (number)', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 123, aspect: 'x', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects missing aspect field', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('accepts valid decide input (Edda offline → 502)', async () => {
      // No mock server → Edda unreachable → recordDecision returns null → 502
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', aspect: 'review_policy', value: '2 approvals' }),
      });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('EDDA_UNAVAILABLE');
    });

    it('accepts valid decide input with reason (Edda online → 201)', async () => {
      const decideResult: EddaDecideResult = { event_id: 'evt-route-1' };
      mockResponses.set('POST /api/decide', { status: 200, body: decideResult });
      startMockEdda(MOCK_PORT);

      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', aspect: 'review_policy', value: '2 approvals', reason: 'stability' }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.event_id).toBe('evt-route-1');
    });
  });
});
