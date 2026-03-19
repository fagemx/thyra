/**
 * canonical-proposals.test.ts — Canonical proposal, judgment, apply, rollback route tests
 *
 * Tests for proposal endpoints (spec SS11.1, SS12.1, SS13.1, SS13.3):
 * - POST /api/v1/cycles/:id/proposals         — submit proposal
 * - POST /api/v1/proposals/:id/judgment        — judge proposal
 * - POST /api/v1/proposals/:id/apply           — apply proposal
 * - POST /api/v1/applied-changes/:id/rollback  — rollback change
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { cycleRoutes } from './cycles';
import { canonicalProposalRoutes } from './canonical-proposals';

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
  app.route('', canonicalProposalRoutes(db));

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

function sampleProposalBody() {
  return {
    kind: 'throttle_entry',
    title: 'Throttle market entry at peak',
    summary: 'Reduce entry rate to prevent overcrowding',
    data: { maxEntryRate: 50 },
    createdBy: { type: 'chief', id: 'chief_001' },
  };
}

async function createCycle(app: Hono): Promise<string> {
  const { body } = await json(app, 'POST', `/api/v1/worlds/${WORLD_ID}/cycles`, openCycleBody());
  return (body.data as Record<string, string>).cycleId;
}

async function submitProposal(app: Hono, cycleId: string): Promise<string> {
  const { body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, sampleProposalBody());
  return (body.data as Record<string, string>).id;
}

async function approveProposal(app: Hono, proposalId: string): Promise<void> {
  await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
    verdict: 'approved',
    rationale: 'Low risk, beneficial change',
  });
}

async function applyProposal(app: Hono, proposalId: string): Promise<string> {
  const { body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/apply`);
  return (body.data as Record<string, string>).id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Canonical Proposal Routes', () => {
  let app: Hono;

  beforeEach(() => {
    const ctx = setup();
    app = ctx.app;
  });

  // =========================================================================
  // POST /api/v1/cycles/:id/proposals — Submit Proposal (SS11.1)
  // =========================================================================
  describe('POST /api/v1/cycles/:id/proposals', () => {
    it('should submit a proposal with 201', async () => {
      const cycleId = await createCycle(app);

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, sampleProposalBody());

      expect(status).toBe(201);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.cycleId).toBe(cycleId);
      expect(data.worldId).toBe(WORLD_ID);
      expect(data.status).toBe('proposed');
      expect(data.kind).toBe('throttle_entry');
      expect(data.title).toBe('Throttle market entry at peak');
      expect(data.id).toBeDefined();
    });

    it('should reject if cycle does not exist', async () => {
      const { status, body } = await json(app, 'POST', '/api/v1/cycles/nonexistent/proposals', sampleProposalBody());

      expect(status).toBe(404);
      expect((body.error as Record<string, string>).code).toBe('NOT_FOUND');
    });

    it('should reject if cycle is closed', async () => {
      const cycleId = await createCycle(app);
      await json(app, 'POST', `/api/v1/cycles/${cycleId}/close`);

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, sampleProposalBody());

      expect(status).toBe(409);
      expect((body.error as Record<string, string>).code).toBe('CYCLE_CLOSED');
    });

    it('should reject invalid body', async () => {
      const cycleId = await createCycle(app);

      const { status, body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, { bad: 'data' });

      expect(status).toBe(400);
      expect((body.error as Record<string, string>).code).toBe('VALIDATION');
    });

    it('should allow multiple proposals per cycle', async () => {
      const cycleId = await createCycle(app);

      const { status: s1 } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, sampleProposalBody());
      const { status: s2 } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, {
        ...sampleProposalBody(),
        title: 'Second proposal',
      });

      expect(s1).toBe(201);
      expect(s2).toBe(201);
    });
  });

  // =========================================================================
  // POST /api/v1/proposals/:id/judgment — Judge Proposal (SS12.1)
  // =========================================================================
  describe('POST /api/v1/proposals/:id/judgment', () => {
    it('should judge a proposed proposal', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);

      const { status, body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
        verdict: 'approved',
        rationale: 'Low risk change',
      });

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.status).toBe('approved');
      expect(data.judgmentReport).toBeDefined();
      expect(data.judgedAt).toBeDefined();
    });

    it('should reject judgment on non-existent proposal', async () => {
      const { status, body } = await json(app, 'POST', '/api/v1/proposals/nonexistent/judgment', {
        verdict: 'approved',
        rationale: 'test',
      });

      expect(status).toBe(404);
      expect((body.error as Record<string, string>).code).toBe('NOT_FOUND');
    });

    it('should reject judgment on already judged proposal', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);
      await approveProposal(app, proposalId);

      const { status, body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
        verdict: 'rejected',
        rationale: 'Changed mind',
      });

      expect(status).toBe(409);
      expect((body.error as Record<string, string>).code).toBe('INVALID_STATE');
    });

    it('should support rejected verdict', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);

      const { body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
        verdict: 'rejected',
        rationale: 'Too risky',
      });

      expect((body.data as Record<string, string>).status).toBe('rejected');
    });

    it('should support approved_with_constraints verdict', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);

      const { body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
        verdict: 'approved_with_constraints',
        rationale: 'OK but with limits',
        constraints: ['max_duration_30min'],
      });

      const data = body.data as Record<string, unknown>;
      expect(data.status).toBe('approved_with_constraints');
      const report = data.judgmentReport as Record<string, unknown>;
      expect(report.constraints).toEqual(['max_duration_30min']);
    });

    it('should reject invalid verdict', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);

      const { status, body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
        verdict: 'invalid_verdict',
        rationale: 'test',
      });

      expect(status).toBe(400);
      expect((body.error as Record<string, string>).code).toBe('VALIDATION');
    });
  });

  // =========================================================================
  // POST /api/v1/proposals/:id/apply — Apply Proposal (SS13.1)
  // =========================================================================
  describe('POST /api/v1/proposals/:id/apply', () => {
    it('should apply an approved proposal', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);
      await approveProposal(app, proposalId);

      const { status, body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/apply`);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.proposalId).toBe(proposalId);
      expect(data.status).toBe('applied');
      expect(data.id).toBeDefined();
      expect(data.appliedAt).toBeDefined();
    });

    it('should reject applying unapproved proposal', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);

      const { status, body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/apply`);

      expect(status).toBe(409);
      expect((body.error as Record<string, string>).code).toBe('INVALID_STATE');
    });

    it('should reject applying non-existent proposal', async () => {
      const { status, body } = await json(app, 'POST', '/api/v1/proposals/nonexistent/apply');

      expect(status).toBe(404);
      expect((body.error as Record<string, string>).code).toBe('NOT_FOUND');
    });

    it('should apply approved_with_constraints proposal', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);

      await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
        verdict: 'approved_with_constraints',
        rationale: 'OK with limits',
      });

      const { status, body } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/apply`);

      expect(status).toBe(200);
      expect((body.data as Record<string, string>).status).toBe('applied');
    });

    it('should update cycle applied_change_ids', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);
      await approveProposal(app, proposalId);
      await json(app, 'POST', `/api/v1/proposals/${proposalId}/apply`);

      // Verify cycle was updated
      const { body } = await json(app, 'GET', `/api/v1/cycles/${cycleId}`);
      const data = body.data as Record<string, unknown>;
      expect((data.appliedChangeIds as string[]).length).toBe(1);
    });
  });

  // =========================================================================
  // POST /api/v1/applied-changes/:id/rollback — Rollback (SS13.3)
  // =========================================================================
  describe('POST /api/v1/applied-changes/:id/rollback', () => {
    it('should rollback an applied change', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);
      await approveProposal(app, proposalId);
      const appliedChangeId = await applyProposal(app, proposalId);

      const { status, body } = await json(app, 'POST', `/api/v1/applied-changes/${appliedChangeId}/rollback`, {
        reason: 'Metrics degraded after change',
      });

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const data = body.data as Record<string, unknown>;
      expect(data.status).toBe('rolled_back');
      expect(data.rollbackReason).toBe('Metrics degraded after change');
      expect(data.rolledBackAt).toBeDefined();
    });

    it('should reject rollback on non-existent change', async () => {
      const { status, body } = await json(app, 'POST', '/api/v1/applied-changes/nonexistent/rollback', {
        reason: 'test',
      });

      expect(status).toBe(404);
      expect((body.error as Record<string, string>).code).toBe('NOT_FOUND');
    });

    it('should reject rollback on already rolled back change', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);
      await approveProposal(app, proposalId);
      const appliedChangeId = await applyProposal(app, proposalId);

      await json(app, 'POST', `/api/v1/applied-changes/${appliedChangeId}/rollback`, {
        reason: 'First rollback',
      });

      const { status, body } = await json(app, 'POST', `/api/v1/applied-changes/${appliedChangeId}/rollback`, {
        reason: 'Second rollback attempt',
      });

      expect(status).toBe(409);
      expect((body.error as Record<string, string>).code).toBe('ALREADY_ROLLED_BACK');
    });

    it('should reject rollback without reason', async () => {
      const cycleId = await createCycle(app);
      const proposalId = await submitProposal(app, cycleId);
      await approveProposal(app, proposalId);
      const appliedChangeId = await applyProposal(app, proposalId);

      const { status, body } = await json(app, 'POST', `/api/v1/applied-changes/${appliedChangeId}/rollback`, {});

      expect(status).toBe(400);
      expect((body.error as Record<string, string>).code).toBe('VALIDATION');
    });
  });

  // =========================================================================
  // Full lifecycle: propose → judge → apply → rollback
  // =========================================================================
  describe('Full lifecycle', () => {
    it('should support complete propose → judge → apply → rollback flow', async () => {
      const cycleId = await createCycle(app);

      // Step 1: Submit proposal
      const { body: submitRes } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, sampleProposalBody());
      const proposalId = (submitRes.data as Record<string, string>).id;
      expect((submitRes.data as Record<string, string>).status).toBe('proposed');

      // Step 2: Judge → approve
      const { body: judgeRes } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/judgment`, {
        verdict: 'approved',
        rationale: 'Looks good',
      });
      expect((judgeRes.data as Record<string, string>).status).toBe('approved');

      // Step 3: Apply
      const { body: applyRes } = await json(app, 'POST', `/api/v1/proposals/${proposalId}/apply`);
      const appliedChangeId = (applyRes.data as Record<string, string>).id;
      expect((applyRes.data as Record<string, string>).status).toBe('applied');

      // Step 4: Rollback
      const { body: rollbackRes } = await json(app, 'POST', `/api/v1/applied-changes/${appliedChangeId}/rollback`, {
        reason: 'Metrics went wrong',
      });
      expect((rollbackRes.data as Record<string, string>).status).toBe('rolled_back');
    });
  });

  // =========================================================================
  // THY-11 Envelope compliance
  // =========================================================================
  describe('THY-11 envelope compliance', () => {
    it('success responses have { ok: true, data }', async () => {
      const cycleId = await createCycle(app);
      const { body } = await json(app, 'POST', `/api/v1/cycles/${cycleId}/proposals`, sampleProposalBody());
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('data');
    });

    it('error responses have { ok: false, error: { code, message } }', async () => {
      const { body } = await json(app, 'POST', '/api/v1/proposals/nonexistent/judgment', {
        verdict: 'approved',
        rationale: 'test',
      });
      expect(body).toHaveProperty('ok', false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });
});
