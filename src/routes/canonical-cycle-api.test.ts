/**
 * canonical-cycle-api.test.ts — GP-5 Full 10-Stage Canonical Cycle Integration Test
 *
 * Tests the complete canonical cycle via API endpoints:
 * 1. POST /worlds → create world (simulated via DB insert)
 * 2. POST /worlds/:id/cycles → start first cycle
 * 3. POST /cycles/:id/observations → create observation batch
 * 4. POST /cycles/:id/proposals → chief proposes throttle_entry
 * 5. POST /proposals/:id/judgment → 4-layer judgment
 * 6. POST /proposals/:id/apply → apply change
 * 7. GET /worlds/:id/pulse → see updated PulseFrame
 * 8. POST /outcome-windows/:id/evaluate → evaluate outcome
 * 9. GET /worlds/:id/precedents → see PrecedentRecord
 * 10. POST /worlds/:id/governance-adjustments → if verdict=harmful
 *
 * CONTRACT: THY-11 — all responses { ok, data/error }
 * CONTRACT: API-02 — route paths match world-cycle-api.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { cycleRoutes } from './cycles';
import { observationRoutes } from './observations';
import { canonicalProposalRoutes } from './canonical-proposals';
import { outcomeRoutes } from './outcomes';
import { precedentRoutes } from './precedents';
import { pulseRoutes } from './pulse';
import { governanceAdjustmentRoutes } from './governance-adjustments';

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
  app.route('', canonicalProposalRoutes(db));
  app.route('', outcomeRoutes(db));
  app.route('', precedentRoutes(db));
  app.route('', pulseRoutes(db));
  app.route('', governanceAdjustmentRoutes(db));

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

const WORLD_ID = 'world_midnight_market_001';

// ---------------------------------------------------------------------------
// GP-5: Full 10-Stage Canonical Cycle via API
// ---------------------------------------------------------------------------

describe('GP-5: Full Canonical Cycle via API', () => {
  let app: Hono;
  let db: Database;

  // Shared state across sequential tests
  let cycleId: string;
  let proposalId: string;
  let appliedChangeId: string;
  let outcomeWindowId: string;

  beforeEach(() => {
    const s = setup();
    app = s.app;
    db = s.db;
  });

  it('completes full 10-stage canonical cycle', async () => {
    // =====================================================================
    // Step 1: Create World (simulated via DB — world routes are separate)
    // =====================================================================
    // No world table in canonical cycle API — we just use worldId directly.
    // The cycle_runs, observation_batches, etc. reference world_id as TEXT.

    // =====================================================================
    // Step 2: POST /api/v1/worlds/:id/cycles — start first cycle
    // =====================================================================
    const cycleRes = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, {
      mode: 'peak',
      openedBy: { type: 'system', id: 'scheduler' },
    });
    expect(cycleRes.status).toBe(201);
    expect(cycleRes.body.ok).toBe(true);
    const cycleData = cycleRes.body.data as Record<string, unknown>;
    expect(cycleData.worldId).toBe(WORLD_ID);
    expect(cycleData.status).toBe('open');
    expect(cycleData.mode).toBe('peak');
    cycleId = cycleData.cycleId as string;

    // =====================================================================
    // Step 3: POST /api/v1/cycles/:id/observations — create observation batch
    // =====================================================================
    const obsRes = await json(app, 'POST', `/api/v1/cycles/${cycleId}/observations`, {
      observations: [
        {
          id: 'obs_001',
          source: 'external',
          scope: 'entry_gate',
          importance: 'high',
          summary: 'North gate congestion at 87 — above safe threshold',
          details: { metric: 'congestion_score', value: 87 },
          targetIds: ['north_gate'],
          timestamp: new Date().toISOString(),
        },
      ],
    });
    expect(obsRes.status).toBe(201);
    expect(obsRes.body.ok).toBe(true);
    const obsData = obsRes.body.data as Record<string, unknown>;
    expect(obsData.cycleId).toBe(cycleId);

    // Verify GET observations works
    const obsGetRes = await json(app, 'GET', `/api/v1/cycles/${cycleId}/observations`);
    expect(obsGetRes.status).toBe(200);
    expect(obsGetRes.body.ok).toBe(true);

    // =====================================================================
    // Step 4: POST /api/v1/cycles/:id/proposals — chief proposes throttle_entry
    // =====================================================================
    const propRes = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, {
      kind: 'throttle_entry',
      title: 'Throttle north gate entry',
      summary: 'Reduce entry rate at north gate to prevent overcrowding during peak',
      data: { maxEntryRate: 50, targetEntity: 'north_gate' },
      createdBy: { type: 'chief', id: 'safety_chief_001' },
    });
    expect(propRes.status).toBe(201);
    expect(propRes.body.ok).toBe(true);
    const propData = propRes.body.data as Record<string, unknown>;
    expect(propData.status).toBe('proposed');
    expect(propData.kind).toBe('throttle_entry');
    proposalId = propData.id as string;

    // =====================================================================
    // Step 5: POST /api/v1/proposals/:id/judgment — 4-layer judgment
    // =====================================================================
    const judgRes = await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
      verdict: 'approved_with_constraints',
      rationale: 'Approved with time limit — north gate congestion exceeds threshold',
      constraints: ['time_limited: 60 minutes'],
      layers: {
        constitutional: 'pass',
        risk: 'medium',
        budget: 'pass',
        precedent: 'no_prior',
      },
    });
    expect(judgRes.status).toBe(200);
    expect(judgRes.body.ok).toBe(true);
    const judgData = judgRes.body.data as Record<string, unknown>;
    expect(judgData.status).toBe('approved_with_constraints');
    expect(judgData.judgmentReport).toBeDefined();

    // =====================================================================
    // Step 6: POST /api/v1/proposals/:id/apply — apply change
    // =====================================================================
    const applyRes = await json(app, 'POST', `/api/v1/proposals/${proposalId}/apply`);
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.ok).toBe(true);
    const applyData = applyRes.body.data as Record<string, unknown>;
    expect(applyData.status).toBe('applied');
    appliedChangeId = applyData.id as string;

    // Create outcome window for this applied change (manual insert — normally done by apply engine)
    const owId = `ow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const owTimestamp = new Date().toISOString();
    db.prepare(`
      INSERT INTO outcome_windows (
        id, world_id, applied_change_id, proposal_id, cycle_id,
        status, baseline_snapshot, opened_at, version, created_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, 1, ?)
    `).run(
      owId, WORLD_ID, appliedChangeId, proposalId, cycleId,
      JSON.stringify({ congestion_score: 87, stall_fill_rate: 0.7 }),
      owTimestamp, owTimestamp,
    );
    outcomeWindowId = owId;

    // =====================================================================
    // Step 7: GET /api/v1/worlds/:id/pulse — see updated PulseFrame
    // =====================================================================
    // Insert a pulse frame (normally emitted by pulse emitter after apply)
    const pulseId = `pulse_${Date.now()}`;
    db.prepare(`
      INSERT INTO pulse_frames (
        id, world_id, cycle_id, health_score, mode, stability,
        sub_scores, dominant_concerns, metrics,
        latest_applied_change_id, open_outcome_window_count, pending_proposal_count,
        version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      pulseId, WORLD_ID, cycleId, 65.5, 'peak', 'unstable',
      JSON.stringify({ congestionHealth: 13, supplyHealth: 70, conversionHealth: 60, frictionHealth: 85, fairnessHealth: 75 }),
      JSON.stringify([{ kind: 'gate_congestion', severity: 'high', summary: 'North gate congestion at 87' }]),
      JSON.stringify({ congestion_score: 87, stall_fill_rate: 0.7, checkout_conversion: 0.6, complaint_rate: 0.15, fairness_score: 75 }),
      appliedChangeId, 1, 0,
      new Date().toISOString(),
    );

    const pulseRes = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/pulse`);
    expect(pulseRes.status).toBe(200);
    expect(pulseRes.body.ok).toBe(true);
    const pulseData = pulseRes.body.data as Record<string, unknown>;
    // PULSE-01: healthScore + mode + stability + dominantConcerns present
    expect(pulseData.healthScore).toBeDefined();
    expect(pulseData.mode).toBe('peak');
    expect(pulseData.stability).toBe('unstable');
    expect(pulseData.dominantConcerns).toBeDefined();
    expect(Array.isArray(pulseData.dominantConcerns)).toBe(true);

    // =====================================================================
    // Step 8: POST /api/v1/outcome-windows/:id/evaluate — evaluate outcome
    // =====================================================================
    const evalRes = await json(app, 'POST', `/api/v1/outcome-windows/${outcomeWindowId}/evaluate`, {
      currentSnapshot: { congestion_score: 65, stall_fill_rate: 0.75 },
      expectedEffects: [
        { metric: 'congestion_score', expectedDirection: 'down' },
      ],
      sideEffectMetrics: ['stall_fill_rate'],
    });
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.ok).toBe(true);
    const evalData = evalRes.body.data as Record<string, unknown>;
    // OUTCOME-02: verdict + metric deltas
    expect(evalData.verdict).toBeDefined();
    expect(evalData.recommendation).toBeDefined();
    expect(evalData.expectedEffects).toBeDefined();
    expect(evalData.outcomeWindowId).toBe(outcomeWindowId);

    // Verify window is now closed
    const windowRes = await json(app, 'GET', `/api/v1/outcome-windows/${outcomeWindowId}`);
    expect(windowRes.status).toBe(200);
    expect((windowRes.body.data as Record<string, unknown>).status).toBe('closed');

    // Verify outcome report is retrievable
    const reportId = evalData.id as string;
    const reportRes = await json(app, 'GET', `/api/v1/outcome-reports/${reportId}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.ok).toBe(true);

    // =====================================================================
    // Step 9: GET /api/v1/worlds/:id/precedents — see PrecedentRecord
    // =====================================================================
    // Insert a precedent record (normally done by PrecedentRecorder after evaluation)
    db.prepare(`
      INSERT INTO precedent_records (
        id, world_id, world_type, proposal_id, outcome_report_id,
        change_kind, cycle_id, context, decision, outcome,
        recommendation, lessons_learned, context_tags, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      'prec_001', WORLD_ID, 'market', proposalId, reportId,
      'throttle_entry', cycleId,
      'North gate congestion at 87 during peak hour',
      'Applied throttle_entry to reduce entry rate',
      evalData.verdict as string,
      evalData.recommendation as string,
      JSON.stringify(['All expected effects materialized as predicted']),
      JSON.stringify(['peak_hour', 'festival_night']),
      new Date().toISOString(),
    );

    const precRes = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/precedents`);
    expect(precRes.status).toBe(200);
    expect(precRes.body.ok).toBe(true);
    const precData = precRes.body.data as Array<Record<string, unknown>>;
    expect(precData.length).toBe(1);
    // PREC-01: proposalId + outcomeReportId linked
    expect(precData[0].proposalId).toBe(proposalId);
    expect(precData[0].outcomeReportId).toBe(reportId);

    // =====================================================================
    // Step 10: POST /api/v1/worlds/:id/governance-adjustments
    // =====================================================================
    // This test uses the beneficial verdict from step 8, so no adjustment should fire.
    // Test both scenarios.
    const adjRes = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`, {
      report: {
        id: reportId,
        appliedChangeId,
        outcomeWindowId,
        primaryObjectiveMet: evalData.primaryObjectiveMet,
        expectedEffects: evalData.expectedEffects,
        sideEffects: evalData.sideEffects,
        verdict: evalData.verdict,
        recommendation: evalData.recommendation,
        notes: evalData.notes,
        createdAt: evalData.createdAt,
        version: 1,
      },
    });
    expect(adjRes.status).toBe(200);
    expect(adjRes.body.ok).toBe(true);
    const adjData = adjRes.body.data as Record<string, unknown>;
    // Beneficial verdict should not trigger adjustment (ADJ-02)
    if (evalData.verdict === 'beneficial') {
      expect(adjData.triggered).toBe(false);
    }

    // Test with harmful verdict to verify adjustment triggers
    const harmfulAdjRes = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`, {
      report: {
        id: 'harmful_report_001',
        appliedChangeId,
        outcomeWindowId,
        primaryObjectiveMet: false,
        expectedEffects: [
          { metric: 'congestion_score', expectedDirection: 'down', baseline: 87, observed: 90, delta: 3, matched: false },
        ],
        sideEffects: [
          { metric: 'stall_fill_rate', baseline: 0.7, observed: 0.3, delta: -0.4, severity: 'significant', acceptable: false },
        ],
        verdict: 'harmful',
        recommendation: 'rollback',
        notes: ['Expected effects: 0/1 matched'],
        createdAt: new Date().toISOString(),
        version: 1,
      },
    });
    expect(harmfulAdjRes.status).toBe(200);
    expect(harmfulAdjRes.body.ok).toBe(true);
    const harmfulAdjData = harmfulAdjRes.body.data as Record<string, unknown>;
    expect(harmfulAdjData.triggered).toBe(true);
    expect(harmfulAdjData.adjustment).toBeDefined();

    // Verify adjustment is listed
    const adjListRes = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`);
    expect(adjListRes.status).toBe(200);
    expect(adjListRes.body.ok).toBe(true);
    const adjListData = adjListRes.body.data as Array<Record<string, unknown>>;
    expect(adjListData.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// THY-11 Envelope Compliance
// ---------------------------------------------------------------------------

describe('API envelope compliance (THY-11)', () => {
  let app: Hono;

  beforeEach(() => {
    const s = setup();
    app = s.app;
  });

  it('success responses have { ok: true, data }', async () => {
    // Open a cycle (success case)
    const res = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, {
      mode: 'normal',
      openedBy: { type: 'system', id: 'test' },
    });
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
  });

  it('error responses have { ok: false, error: { code, message } }', async () => {
    // Try to get non-existent cycle
    const res = await json(app, 'GET', '/api/v1/cycles/nonexistent');
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('error');
    const error = res.body.error as Record<string, unknown>;
    expect(error).toHaveProperty('code');
    expect(error).toHaveProperty('message');
  });
});

// ---------------------------------------------------------------------------
// Outcome Routes Unit Tests
// ---------------------------------------------------------------------------

describe('outcome routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const s = setup();
    app = s.app;
    db = s.db;
  });

  function insertOutcomeWindow(worldId: string, appliedChangeId: string, proposalId: string, cycleId: string): string {
    const id = `ow_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ts = new Date().toISOString();
    db.prepare(`
      INSERT INTO outcome_windows (
        id, world_id, applied_change_id, proposal_id, cycle_id,
        status, baseline_snapshot, opened_at, version, created_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, 1, ?)
    `).run(id, worldId, appliedChangeId, proposalId, cycleId,
      JSON.stringify({ congestion_score: 80 }), ts, ts);
    return id;
  }

  it('GET /api/v1/outcome-windows/:id returns window', async () => {
    const owId = insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');
    const res = await json(app, 'GET', `/api/v1/outcome-windows/${owId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.data as Record<string, unknown>).id).toBe(owId);
  });

  it('GET /api/v1/outcome-windows/:id returns 404 for missing', async () => {
    const res = await json(app, 'GET', '/api/v1/outcome-windows/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('POST /api/v1/outcome-windows/:id/evaluate succeeds', async () => {
    const owId = insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');
    const res = await json(app, 'POST', `/api/v1/outcome-windows/${owId}/evaluate`, {
      currentSnapshot: { congestion_score: 60 },
      expectedEffects: [{ metric: 'congestion_score', expectedDirection: 'down' }],
      sideEffectMetrics: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.data as Record<string, unknown>).verdict).toBe('beneficial');
  });

  it('POST /api/v1/outcome-windows/:id/evaluate returns 409 for already evaluated', async () => {
    const owId = insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');
    // Evaluate once
    await json(app, 'POST', `/api/v1/outcome-windows/${owId}/evaluate`, {
      currentSnapshot: { congestion_score: 60 },
      expectedEffects: [{ metric: 'congestion_score', expectedDirection: 'down' }],
    });
    // Try again
    const res = await json(app, 'POST', `/api/v1/outcome-windows/${owId}/evaluate`, {
      currentSnapshot: { congestion_score: 60 },
      expectedEffects: [{ metric: 'congestion_score', expectedDirection: 'down' }],
    });
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
  });

  it('POST /api/v1/outcome-windows/:id/evaluate returns 400 for invalid body', async () => {
    const owId = insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');
    const res = await json(app, 'POST', `/api/v1/outcome-windows/${owId}/evaluate`, { bad: true });
    expect(res.status).toBe(400);
  });

  it('GET /api/v1/outcome-reports/:id returns report after evaluation', async () => {
    const owId = insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');
    const evalRes = await json(app, 'POST', `/api/v1/outcome-windows/${owId}/evaluate`, {
      currentSnapshot: { congestion_score: 60 },
      expectedEffects: [{ metric: 'congestion_score', expectedDirection: 'down' }],
    });
    const reportId = (evalRes.body.data as Record<string, unknown>).id as string;
    const res = await json(app, 'GET', `/api/v1/outcome-reports/${reportId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/v1/outcome-reports/:id returns 404 for missing', async () => {
    const res = await json(app, 'GET', '/api/v1/outcome-reports/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /api/v1/worlds/:id/outcome-windows lists windows', async () => {
    insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');
    insertOutcomeWindow(WORLD_ID, 'ac_2', 'prop_2', 'cycle_1');

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/outcome-windows`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.data as unknown[]).length).toBe(2);
  });

  it('GET /api/v1/worlds/:id/outcome-windows filters by status', async () => {
    insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/outcome-windows?status=open`);
    expect((res.body.data as unknown[]).length).toBe(1);

    const res2 = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/outcome-windows?status=closed`);
    expect((res2.body.data as unknown[]).length).toBe(0);
  });

  it('writes audit_log on evaluation (THY-07)', async () => {
    const owId = insertOutcomeWindow(WORLD_ID, 'ac_1', 'prop_1', 'cycle_1');
    await json(app, 'POST', `/api/v1/outcome-windows/${owId}/evaluate`, {
      currentSnapshot: { congestion_score: 60 },
      expectedEffects: [{ metric: 'congestion_score', expectedDirection: 'down' }],
    });

    const logs = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'outcome_window' AND action = 'evaluated'"
    ).all() as Array<{ entity_id: string }>;
    expect(logs.length).toBe(1);
    expect(logs[0].entity_id).toBe(owId);
  });
});

// ---------------------------------------------------------------------------
// Precedent Routes Unit Tests
// ---------------------------------------------------------------------------

describe('precedent routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const s = setup();
    app = s.app;
    db = s.db;
  });

  function insertPrecedent(
    id: string,
    worldId: string,
    overrides: Partial<{
      worldType: string; changeKind: string; outcome: string;
      recommendation: string; contextTags: string[];
    }> = {},
  ): void {
    const ts = new Date().toISOString();
    db.prepare(`
      INSERT INTO precedent_records (
        id, world_id, world_type, proposal_id, outcome_report_id,
        change_kind, cycle_id, context, decision, outcome,
        recommendation, lessons_learned, context_tags, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id, worldId,
      overrides.worldType ?? 'market',
      'prop_1', 'report_1',
      overrides.changeKind ?? 'throttle_entry',
      'cycle_1',
      'test context', 'test decision',
      overrides.outcome ?? 'beneficial',
      overrides.recommendation ?? 'reinforce',
      JSON.stringify(['lesson 1']),
      JSON.stringify(overrides.contextTags ?? ['peak_hour']),
      ts,
    );
  }

  it('GET /api/v1/worlds/:id/precedents lists precedents', async () => {
    insertPrecedent('prec_1', WORLD_ID);
    insertPrecedent('prec_2', WORLD_ID);

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/precedents`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.data as unknown[]).length).toBe(2);
  });

  it('GET /api/v1/worlds/:id/precedents filters by kind', async () => {
    insertPrecedent('prec_1', WORLD_ID, { changeKind: 'throttle_entry' });
    insertPrecedent('prec_2', WORLD_ID, { changeKind: 'modify_pricing_rule' });

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/precedents?kind=throttle_entry`);
    expect((res.body.data as unknown[]).length).toBe(1);
  });

  it('GET /api/v1/worlds/:id/precedents filters by verdict', async () => {
    insertPrecedent('prec_1', WORLD_ID, { outcome: 'beneficial' });
    insertPrecedent('prec_2', WORLD_ID, { outcome: 'harmful' });

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/precedents?verdict=harmful`);
    expect((res.body.data as unknown[]).length).toBe(1);
  });

  it('GET /api/v1/worlds/:id/precedents filters by contextTag', async () => {
    insertPrecedent('prec_1', WORLD_ID, { contextTags: ['peak_hour', 'festival_night'] });
    insertPrecedent('prec_2', WORLD_ID, { contextTags: ['morning'] });

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/precedents?contextTag=festival_night`);
    expect((res.body.data as unknown[]).length).toBe(1);
  });

  it('GET /api/v1/precedents/:id returns single precedent', async () => {
    insertPrecedent('prec_1', WORLD_ID);

    const res = await json(app, 'GET', '/api/v1/precedents/prec_1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.data as Record<string, unknown>).id).toBe('prec_1');
  });

  it('GET /api/v1/precedents/:id returns 404 for missing', async () => {
    const res = await json(app, 'GET', '/api/v1/precedents/nonexistent');
    expect(res.status).toBe(404);
  });

  it('POST /api/v1/precedents/search searches by worldType', async () => {
    insertPrecedent('prec_1', WORLD_ID, { worldType: 'market' });
    insertPrecedent('prec_2', 'world_2', { worldType: 'town' });

    const res = await json(app, 'POST', '/api/v1/precedents/search', {
      worldType: 'market',
    });
    expect(res.status).toBe(200);
    expect((res.body.data as unknown[]).length).toBe(1);
  });

  it('POST /api/v1/precedents/search searches by proposalKind', async () => {
    insertPrecedent('prec_1', WORLD_ID, { changeKind: 'throttle_entry' });
    insertPrecedent('prec_2', WORLD_ID, { changeKind: 'modify_pricing_rule' });

    const res = await json(app, 'POST', '/api/v1/precedents/search', {
      proposalKind: 'throttle_entry',
    });
    expect((res.body.data as unknown[]).length).toBe(1);
  });

  it('POST /api/v1/precedents/search searches by contextTags', async () => {
    insertPrecedent('prec_1', WORLD_ID, { contextTags: ['peak_hour', 'festival_night'] });
    insertPrecedent('prec_2', WORLD_ID, { contextTags: ['morning'] });

    const res = await json(app, 'POST', '/api/v1/precedents/search', {
      contextTags: ['festival_night'],
    });
    expect((res.body.data as unknown[]).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pulse Routes Unit Tests
// ---------------------------------------------------------------------------

describe('pulse routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const s = setup();
    app = s.app;
    db = s.db;
  });

  function insertPulseFrame(worldId: string): string {
    const id = `pulse_test_${Date.now()}`;
    db.prepare(`
      INSERT INTO pulse_frames (
        id, world_id, cycle_id, health_score, mode, stability,
        sub_scores, dominant_concerns, metrics,
        open_outcome_window_count, pending_proposal_count,
        version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id, worldId, 'cycle_1', 78, 'peak', 'stable',
      JSON.stringify({ congestionHealth: 50, supplyHealth: 80, conversionHealth: 70, frictionHealth: 85, fairnessHealth: 75 }),
      JSON.stringify([]),
      JSON.stringify({ congestion_score: 50, stall_fill_rate: 0.8 }),
      0, 0, new Date().toISOString(),
    );
    return id;
  }

  it('GET /api/v1/worlds/:id/pulse returns latest pulse', async () => {
    insertPulseFrame(WORLD_ID);

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/pulse`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const data = res.body.data as Record<string, unknown>;
    expect(data.healthScore).toBe(78);
    expect(data.mode).toBe('peak');
    expect(data.stability).toBe('stable');
  });

  it('GET /api/v1/worlds/:id/pulse returns 404 when no pulse exists', async () => {
    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/pulse`);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('GET /api/v1/worlds/:id/pulse returns latest when multiple exist', async () => {
    // Insert older pulse
    db.prepare(`
      INSERT INTO pulse_frames (
        id, world_id, health_score, mode, stability,
        sub_scores, dominant_concerns, metrics,
        open_outcome_window_count, pending_proposal_count,
        version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      'pulse_old', WORLD_ID, 50, 'open', 'unstable',
      '{}', '[]', '{}', 0, 0, '2026-01-01T00:00:00Z',
    );

    // Insert newer pulse
    db.prepare(`
      INSERT INTO pulse_frames (
        id, world_id, health_score, mode, stability,
        sub_scores, dominant_concerns, metrics,
        open_outcome_window_count, pending_proposal_count,
        version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      'pulse_new', WORLD_ID, 90, 'peak', 'stable',
      '{}', '[]', '{}', 0, 0, '2026-03-19T00:00:00Z',
    );

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/pulse`);
    expect((res.body.data as Record<string, unknown>).healthScore).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// Governance Adjustment v1 Routes Unit Tests
// ---------------------------------------------------------------------------

describe('governance adjustment v1 routes', () => {
  let app: Hono;
  let db: Database;

  beforeEach(() => {
    const s = setup();
    app = s.app;
    db = s.db;
  });

  function makeReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'report_001',
      appliedChangeId: 'ac_001',
      outcomeWindowId: 'ow_001',
      primaryObjectiveMet: true,
      expectedEffects: [{ metric: 'revenue', expectedDirection: 'up', baseline: 100, observed: 120, delta: 20, matched: true }],
      sideEffects: [],
      verdict: 'beneficial',
      recommendation: 'reinforce',
      notes: ['Test note'],
      createdAt: new Date().toISOString(),
      version: 1,
      ...overrides,
    };
  }

  it('POST /api/v1/worlds/:id/governance-adjustments creates adjustment for harmful', async () => {
    const res = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`, {
      report: makeReport({
        verdict: 'harmful',
        recommendation: 'rollback',
        primaryObjectiveMet: false,
        expectedEffects: [{ metric: 'revenue', expectedDirection: 'up', baseline: 100, observed: 80, delta: -20, matched: false }],
        sideEffects: [{ metric: 'satisfaction', baseline: 90, observed: 60, delta: -30, severity: 'significant', acceptable: false }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.data as Record<string, unknown>).triggered).toBe(true);
  });

  it('POST /api/v1/worlds/:id/governance-adjustments returns no trigger for beneficial', async () => {
    const res = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`, {
      report: makeReport(),
    });
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, unknown>).triggered).toBe(false);
  });

  it('GET /api/v1/worlds/:id/governance-adjustments lists adjustments', async () => {
    // Create one
    await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`, {
      report: makeReport({ verdict: 'harmful', recommendation: 'rollback', primaryObjectiveMet: false }),
    });

    const res = await json(app, 'GET', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.data as unknown[]).length).toBe(1);
  });

  it('writes audit_log on adjustment creation (THY-07)', async () => {
    await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`, {
      report: makeReport({ verdict: 'harmful', recommendation: 'rollback', primaryObjectiveMet: false }),
    });

    const logs = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'governance_adjustment'"
    ).all();
    expect(logs.length).toBe(1);
  });

  it('returns 400 for invalid body', async () => {
    const res = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/governance-adjustments`, {
      report: { bad: true },
    });
    expect(res.status).toBe(400);
  });
});
