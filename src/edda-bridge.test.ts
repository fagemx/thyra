import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { EddaBridge } from './edda-bridge';
import type { EddaQueryResult, EddaDecideResult, EddaNoteResult, EddaLogEntry, EddaDraft } from './edda-bridge';

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

  describe('recordNote', () => {
    it('sends POST /api/note and returns EddaNoteResult', async () => {
      const noteResult: EddaNoteResult = { event_id: 'evt-note-1' };
      mockResponses.set('POST /api/note', { status: 200, body: noteResult });
      startMockEdda(MOCK_PORT);

      const result = await bridge.recordNote({ text: 'session complete' });

      expect(result).not.toBeNull();
      expect(result?.event_id).toBe('evt-note-1');
      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/api/note');
      const body = lastRequest?.body as Record<string, unknown>;
      expect(body.text).toBe('session complete');

      // 檢查 audit log
      const logs = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'edda' AND action = 'record_note'").all();
      expect(logs).toHaveLength(1);
    });

    it('passes role and tags in request body', async () => {
      const noteResult: EddaNoteResult = { event_id: 'evt-note-2' };
      mockResponses.set('POST /api/note', { status: 200, body: noteResult });
      startMockEdda(MOCK_PORT);

      const result = await bridge.recordNote({
        text: 'tagged note',
        role: 'reviewer',
        tags: ['session', 'review'],
      });

      expect(result?.event_id).toBe('evt-note-2');
      const body = lastRequest?.body as Record<string, unknown>;
      expect(body.role).toBe('reviewer');
      expect(body.tags).toEqual(['session', 'review']);
    });

    it('returns null when Edda is down (graceful degradation)', async () => {
      // No mock server → connection refused
      const result = await bridge.recordNote({ text: 'offline note' });
      expect(result).toBeNull();
    });

    it('returns null on non-200 response', async () => {
      mockResponses.set('POST /api/note', { status: 500, body: { error: 'fail' } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.recordNote({ text: 'error note' });
      expect(result).toBeNull();
    });
  });

  describe('listDrafts', () => {
    it('sends GET /api/drafts and returns EddaDraft array', async () => {
      const drafts: EddaDraft[] = [
        { event_id: 'evt-draft-1', key: 'law.review_policy', value: '3 approvals', reason: 'stricter review', status: 'pending', ts: '2024-06-01T00:00:00Z', branch: 'main' },
        { event_id: 'evt-draft-2', key: 'db.backup', value: 'daily', status: 'pending', ts: '2024-06-02T00:00:00Z' },
      ];
      mockResponses.set('GET /api/drafts', { status: 200, body: drafts });
      startMockEdda(MOCK_PORT);

      const result = await bridge.listDrafts();
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result?.[0].event_id).toBe('evt-draft-1');
      expect(result?.[0].key).toBe('law.review_policy');
      expect(result?.[0].reason).toBe('stricter review');
      expect(result?.[0].status).toBe('pending');
      expect(result?.[1].reason).toBeUndefined();
      expect(lastRequest?.method).toBe('GET');
      expect(lastRequest?.url).toBe('/api/drafts');
    });

    it('returns empty array when no drafts exist', async () => {
      mockResponses.set('GET /api/drafts', { status: 200, body: [] });
      startMockEdda(MOCK_PORT);

      const result = await bridge.listDrafts();
      expect(result).toEqual([]);
    });

    it('returns null when Edda is down (graceful degradation)', async () => {
      const result = await bridge.listDrafts();
      expect(result).toBeNull();
    });

    it('returns null on non-200 response', async () => {
      mockResponses.set('GET /api/drafts', { status: 500, body: { error: 'fail' } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.listDrafts();
      expect(result).toBeNull();
    });

    it('returns null on malformed response (Zod validation failure)', async () => {
      mockResponses.set('GET /api/drafts', { status: 200, body: { unexpected: true } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.listDrafts();
      expect(result).toBeNull();
    });
  });

  describe('queryEventLog', () => {
    it('sends GET /api/log and handles Edda real format { events: [...] }', async () => {
      // Edda 真實格式：{ events: [...] }，欄位名 event_type / detail
      const eddaResponse = {
        events: [
          { event_id: 'evt-log-1', event_type: 'decision', detail: 'chose sqlite', ts: '2024-01-01T00:00:00Z', branch: 'main' },
          { event_id: 'evt-log-2', event_type: 'note', detail: 'session end', ts: '2024-01-02T00:00:00Z', branch: 'main' },
        ],
      };
      mockResponses.set('GET /api/log', { status: 200, body: eddaResponse });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryEventLog();
      expect(result).toHaveLength(2);
      expect(result[0].event_id).toBe('evt-log-1');
      expect(result[0].type).toBe('decision');
      expect(result[0].summary).toBe('chose sqlite');
      expect(result[1].type).toBe('note');
      expect(result[1].summary).toBe('session end');
    });

    it('also handles direct array format (backward compat)', async () => {
      const entries: EddaLogEntry[] = [
        { event_id: 'evt-log-3', type: 'decision', summary: 'chose postgres', ts: '2024-01-03T00:00:00Z' },
      ];
      mockResponses.set('GET /api/log', { status: 200, body: entries });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryEventLog();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('decision');
      expect(result[0].summary).toBe('chose postgres');
    });

    it('forwards filter params as query string', async () => {
      mockResponses.set('GET /api/log', { status: 200, body: [] });
      startMockEdda(MOCK_PORT);

      await bridge.queryEventLog({
        type: 'decision',
        keyword: 'sqlite',
        after: '2024-01-01',
        before: '2024-12-31',
        limit: 10,
      });

      expect(lastRequest?.url).toContain('type=decision');
      expect(lastRequest?.url).toContain('keyword=sqlite');
      expect(lastRequest?.url).toContain('after=2024-01-01');
      expect(lastRequest?.url).toContain('before=2024-12-31');
      expect(lastRequest?.url).toContain('limit=10');
    });

    it('returns empty array when Edda is down (graceful degradation)', async () => {
      const result = await bridge.queryEventLog({ type: 'decision' });
      expect(result).toEqual([]);
    });

    it('returns empty array on non-200 response', async () => {
      mockResponses.set('GET /api/log', { status: 500, body: { error: 'fail' } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryEventLog();
      expect(result).toEqual([]);
    });

    it('returns empty array on malformed response (Zod validation failure)', async () => {
      mockResponses.set('GET /api/log', { status: 200, body: { unexpected: true } });
      startMockEdda(MOCK_PORT);

      const result = await bridge.queryEventLog();
      expect(result).toEqual([]);
    });
  });
});
