/**
 * adjustments.test.ts — Governance adjustment routes 整合測試
 *
 * 覆蓋：
 * - POST: harmful outcome → adjustment created (triggered: true)
 * - POST: neutral + watch → no adjustment (triggered: false)
 * - POST: invalid body → 400
 * - GET: list persisted adjustments
 * - GET: status filter
 * - THY-11: response format { ok, data/error }
 * - THY-07: audit_log written
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, initSchema } from '../db';
import type { Database } from 'bun:sqlite';
import { adjustmentRoutes } from './adjustments';
import type { OutcomeReport } from '../schemas/outcome-report';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutcomeReport(overrides: Partial<OutcomeReport> = {}): OutcomeReport {
  return {
    id: 'outcome-001',
    appliedChangeId: 'change-001',
    outcomeWindowId: 'window-001',
    primaryObjectiveMet: true,
    expectedEffects: [
      {
        metric: 'revenue',
        expectedDirection: 'up',
        baseline: 100,
        observed: 120,
        delta: 20,
        matched: true,
      },
    ],
    sideEffects: [],
    verdict: 'beneficial',
    recommendation: 'reinforce',
    notes: ['Expected effects: 1/1 matched', 'Verdict: beneficial'],
    createdAt: '2026-03-19T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

const WORLD_ID = 'world-test-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adjustment routes', () => {
  let app: ReturnType<typeof adjustmentRoutes>;
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    app = adjustmentRoutes(db);
  });

  // ---- POST /api/worlds/:worldId/adjustments ----

  describe('POST /api/worlds/:worldId/adjustments', () => {
    it('creates adjustment for harmful + rollback outcome (triggered: true)', async () => {
      const report = makeOutcomeReport({
        verdict: 'harmful',
        recommendation: 'rollback',
        primaryObjectiveMet: false,
        expectedEffects: [
          { metric: 'revenue', expectedDirection: 'up', baseline: 100, observed: 80, delta: -20, matched: false },
        ],
        sideEffects: [
          { metric: 'satisfaction', baseline: 90, observed: 60, delta: -30, severity: 'significant', acceptable: false },
        ],
        notes: ['Expected effects: 0/1 matched'],
      });

      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; data: { adjustment: Record<string, unknown>; triggered: boolean } };
      expect(json.ok).toBe(true);
      expect(json.data.triggered).toBe(true);
      expect(json.data.adjustment).toBeDefined();
      expect(json.data.adjustment.worldId).toBe(WORLD_ID);
      expect(json.data.adjustment.adjustmentType).toBe('law_threshold');
      expect(json.data.adjustment.status).toBe('proposed');
      expect(json.data.adjustment.target).toBe('change-001');
    });

    it('returns null adjustment for neutral + watch (triggered: false)', async () => {
      const report = makeOutcomeReport({
        verdict: 'neutral',
        recommendation: 'watch',
      });

      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; data: { adjustment: null; triggered: boolean } };
      expect(json.ok).toBe(true);
      expect(json.data.triggered).toBe(false);
      expect(json.data.adjustment).toBeNull();
    });

    it('returns null adjustment for beneficial + reinforce', async () => {
      const report = makeOutcomeReport({
        verdict: 'beneficial',
        recommendation: 'reinforce',
      });

      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; data: { triggered: boolean } };
      expect(json.ok).toBe(true);
      expect(json.data.triggered).toBe(false);
    });

    it('creates adjustment for harmful + do_not_repeat (simulation_policy)', async () => {
      const report = makeOutcomeReport({
        verdict: 'harmful',
        recommendation: 'do_not_repeat',
        primaryObjectiveMet: false,
      });

      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; data: { adjustment: Record<string, unknown>; triggered: boolean } };
      expect(json.ok).toBe(true);
      expect(json.data.triggered).toBe(true);
      expect(json.data.adjustment.adjustmentType).toBe('simulation_policy');
    });

    it('creates adjustment for neutral + retune (risk_policy)', async () => {
      const report = makeOutcomeReport({
        verdict: 'neutral',
        recommendation: 'retune',
      });

      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; data: { adjustment: Record<string, unknown>; triggered: boolean } };
      expect(json.ok).toBe(true);
      expect(json.data.triggered).toBe(true);
      expect(json.data.adjustment.adjustmentType).toBe('risk_policy');
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: { bad: true } }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('writes audit_log on adjustment creation (THY-07)', async () => {
      const report = makeOutcomeReport({
        verdict: 'harmful',
        recommendation: 'rollback',
        primaryObjectiveMet: false,
      });

      await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'governance_adjustment'"
      ).all() as Array<{ action: string; entity_id: string }>;
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('created');
    });
  });

  // ---- GET /api/worlds/:worldId/adjustments ----

  describe('GET /api/worlds/:worldId/adjustments', () => {
    it('lists persisted adjustments', async () => {
      // Create two adjustments
      const harmful = makeOutcomeReport({
        id: 'outcome-h1',
        verdict: 'harmful',
        recommendation: 'rollback',
        primaryObjectiveMet: false,
      });
      const retune = makeOutcomeReport({
        id: 'outcome-r1',
        verdict: 'neutral',
        recommendation: 'retune',
      });

      await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: harmful }),
      });
      await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: retune }),
      });

      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
      expect(json.ok).toBe(true);
      expect(json.data.length).toBe(2);
    });

    it('filters by status', async () => {
      const report = makeOutcomeReport({
        verdict: 'harmful',
        recommendation: 'rollback',
        primaryObjectiveMet: false,
      });

      await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      // Filter by proposed (should find 1)
      const res1 = await app.request(`/api/worlds/${WORLD_ID}/adjustments?status=proposed`);
      const json1 = (await res1.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
      expect(json1.data.length).toBe(1);

      // Filter by approved (should find 0)
      const res2 = await app.request(`/api/worlds/${WORLD_ID}/adjustments?status=approved`);
      const json2 = (await res2.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
      expect(json2.data.length).toBe(0);
    });

    it('filters by adjustmentType', async () => {
      const report = makeOutcomeReport({
        verdict: 'harmful',
        recommendation: 'rollback',
        primaryObjectiveMet: false,
      });

      await app.request(`/api/worlds/${WORLD_ID}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });

      // law_threshold (should find 1)
      const res1 = await app.request(`/api/worlds/${WORLD_ID}/adjustments?adjustmentType=law_threshold`);
      const json1 = (await res1.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
      expect(json1.data.length).toBe(1);

      // risk_policy (should find 0)
      const res2 = await app.request(`/api/worlds/${WORLD_ID}/adjustments?adjustmentType=risk_policy`);
      const json2 = (await res2.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
      expect(json2.data.length).toBe(0);
    });

    it('returns empty array for unknown worldId', async () => {
      const res = await app.request('/api/worlds/no-such-world/adjustments');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    it('response matches THY-11 format', async () => {
      const res = await app.request(`/api/worlds/${WORLD_ID}/adjustments`);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).toHaveProperty('ok');
      expect(json).toHaveProperty('data');
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });
  });
});
