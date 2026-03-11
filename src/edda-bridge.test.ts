import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { EddaBridge } from './edda-bridge';
import type { EddaQueryResult, EddaDecideResult } from './edda-bridge';

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let mockResponses: Map<string, { status: number; body: unknown }> = new Map();
let lastRequest: { method: string; url: string; body?: unknown } | null = null;

function startMockEdda(port: number) {
  mockServer = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      lastRequest = { method: req.method, url: url.pathname + url.search };

      if (req.method === 'POST') {
        try {
          lastRequest.body = await req.json();
        } catch { /* ignore */ }
      }

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

/** 建立最小 AskResult mock 回應 */
function makeAskResult(overrides: Partial<EddaQueryResult> = {}): EddaQueryResult {
  return {
    query: overrides.query ?? '',
    input_type: overrides.input_type ?? 'overview',
    decisions: overrides.decisions ?? [],
    timeline: overrides.timeline ?? [],
    related_commits: overrides.related_commits ?? [],
    related_notes: overrides.related_notes ?? [],
  };
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
    it('sends GET /api/decisions?q= and returns EddaQueryResult', async () => {
      mockResponses.set('GET /api/decisions', {
        status: 200,
        body: makeAskResult({
          query: 'review',
          input_type: 'domain',
          decisions: [
            { event_id: 'evt-1', key: 'review.min_approvals', value: '2', reason: 'best practice', domain: 'review', branch: 'main', ts: '2024-01-01T00:00:00Z', is_active: true },
          ],
        }),
      });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryDecisions({ domain: 'review' });
      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].key).toBe('review.min_approvals');
      expect(result.decisions[0].event_id).toBe('evt-1');
      expect(result.input_type).toBe('domain');
      expect(lastRequest?.url).toContain('q=review');
    });

    it('uses q param for exact key query (contains .)', async () => {
      mockResponses.set('GET /api/decisions', {
        status: 200,
        body: makeAskResult({
          query: 'db.engine',
          input_type: 'exact_key',
          decisions: [
            { event_id: 'evt-2', key: 'db.engine', value: 'sqlite', reason: 'lightweight', domain: 'db', branch: 'main', ts: '2024-01-01T00:00:00Z', is_active: true },
          ],
          timeline: [
            { event_id: 'evt-0', key: 'db.engine', value: 'postgres', reason: 'initial', domain: 'db', branch: 'main', ts: '2023-06-01T00:00:00Z', is_active: false },
            { event_id: 'evt-2', key: 'db.engine', value: 'sqlite', reason: 'lightweight', domain: 'db', branch: 'main', ts: '2024-01-01T00:00:00Z', is_active: true },
          ],
        }),
      });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryDecisions({ q: 'db.engine' });
      expect(result.input_type).toBe('exact_key');
      expect(result.decisions).toHaveLength(1);
      expect(result.timeline).toHaveLength(2);
      expect(lastRequest?.url).toContain('q=db.engine');
    });

    it('uses keyword param for free-text search', async () => {
      mockResponses.set('GET /api/decisions', {
        status: 200,
        body: makeAskResult({
          query: 'postgres',
          input_type: 'keyword',
          decisions: [
            { event_id: 'evt-3', key: 'db.engine', value: 'postgres', reason: 'production ready', domain: 'db', branch: 'main', ts: '2024-01-01T00:00:00Z', is_active: true },
          ],
        }),
      });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryDecisions({ keyword: 'postgres' });
      expect(result.input_type).toBe('keyword');
      expect(result.decisions).toHaveLength(1);
      expect(lastRequest?.url).toContain('q=postgres');
    });

    it('passes limit, all, branch params', async () => {
      mockResponses.set('GET /api/decisions', {
        status: 200,
        body: makeAskResult({ query: 'db' }),
      });
      startMockEdda(MOCK_PORT);

      await bridge.queryDecisions({ domain: 'db', limit: 5, includeSuperseded: true, branch: 'dev' });
      expect(lastRequest?.url).toContain('q=db');
      expect(lastRequest?.url).toContain('limit=5');
      expect(lastRequest?.url).toContain('all=true');
      expect(lastRequest?.url).toContain('branch=dev');
    });

    it('returns empty result when Edda is down (graceful degradation)', async () => {
      // No mock server → connection refused
      const result = await bridge.queryDecisions({ domain: 'review' });
      expect(result.decisions).toEqual([]);
      expect(result.timeline).toEqual([]);
      expect(result.query).toBe('review');
    });

    it('returns empty result on non-200 response', async () => {
      mockResponses.set('GET /api/decisions', { status: 500, body: { error: 'fail' } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryDecisions({ domain: 'review' });
      expect(result.decisions).toEqual([]);
    });

    it('returns overview when no query params given', async () => {
      mockResponses.set('GET /api/decisions', {
        status: 200,
        body: makeAskResult({ query: '', input_type: 'overview' }),
      });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryDecisions({});
      expect(result.input_type).toBe('overview');
    });
  });

  describe('recordDecision', () => {
    it('sends POST /api/decide with key=value format and returns EddaDecideResult', async () => {
      const decideResult: EddaDecideResult = { event_id: 'evt-new-1' };
      mockResponses.set('POST /api/decide', { status: 200, body: decideResult });
      startMockEdda(MOCK_PORT);

      const result = await bridge.recordDecision({
        domain: 'law',
        aspect: 'review_policy',
        value: '2 approvals',
        reason: 'Stability requirement',
      });

      expect(result).not.toBeNull();
      expect(result?.event_id).toBe('evt-new-1');
      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/api/decide');
      // 驗證 body 格式為 { decision: "key=value", reason }
      const body = lastRequest?.body as Record<string, unknown>;
      expect(body.decision).toBe('law.review_policy=2 approvals');
      expect(body.reason).toBe('Stability requirement');

      // 檢查 audit log
      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'edda' AND action = 'record'").all();
      expect(logs).toHaveLength(1);
    });

    it('returns superseded event_id when auto-superseding', async () => {
      const decideResult: EddaDecideResult = { event_id: 'evt-new-2', superseded: 'evt-old-1' };
      mockResponses.set('POST /api/decide', { status: 200, body: decideResult });
      startMockEdda(MOCK_PORT);

      const result = await bridge.recordDecision({
        domain: 'db',
        aspect: 'engine',
        value: 'postgres',
        reason: 'Production upgrade',
      });

      expect(result?.event_id).toBe('evt-new-2');
      expect(result?.superseded).toBe('evt-old-1');
    });

    it('returns null when Edda is down (graceful degradation)', async () => {
      const result = await bridge.recordDecision({
        domain: 'law',
        aspect: 'test',
        value: 'v',
        reason: 'r',
      });

      expect(result).toBeNull();
    });

    it('returns null on non-200 response', async () => {
      mockResponses.set('POST /api/decide', { status: 500, body: { error: 'fail' } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.recordDecision({
        domain: 'law',
        aspect: 'test',
        value: 'v',
        reason: 'r',
      });

      expect(result).toBeNull();
    });
  });

  describe('getDecisionOutcomes', () => {
    it('returns outcomes for a decision event', async () => {
      const outcomes = { outcomes: [{ key: 'result', value: 'success' }] };
      mockResponses.set('GET /api/decisions/evt-1/outcomes', { status: 200, body: outcomes });
      startMockEdda(MOCK_PORT);

      const result = await bridge.getDecisionOutcomes('evt-1');
      expect(result).toEqual(outcomes);
    });

    it('returns null on 404', async () => {
      mockResponses.set('GET /api/decisions/evt-missing/outcomes', { status: 404, body: { error: 'not found' } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.getDecisionOutcomes('evt-missing');
      expect(result).toBeNull();
    });

    it('returns null when Edda is down (graceful degradation)', async () => {
      const result = await bridge.getDecisionOutcomes('evt-1');
      expect(result).toBeNull();
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
      const decideResult: EddaDecideResult = { event_id: 'evt-r1' };
      mockResponses.set('POST /api/decide', { status: 200, body: decideResult });
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
