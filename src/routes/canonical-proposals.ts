/**
 * routes/canonical-proposals.ts — Canonical cycle proposal, judgment, apply, rollback routes
 *
 * POST /api/v1/cycles/:id/proposals         — submit proposal (spec SS11.1)
 * POST /api/v1/proposals/:id/judgment        — judge proposal (spec SS12.1)
 * POST /api/v1/proposals/:id/apply           — apply proposal (spec SS13.1)
 * POST /api/v1/applied-changes/:id/rollback  — rollback change (spec SS13.3)
 *
 * CONTRACT: THY-11 — unified response envelope { ok, data/error }
 * CONTRACT: API-01 — THY-11 envelope on all responses
 * CONTRACT: API-02 — route paths match world-cycle-api.md
 * CONTRACT: THY-07 — audit log on mutations
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../db';
import { appendAudit } from '../db';
import { ChangeKindSchema } from '../schemas/canonical-proposal';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const SubmitProposalInput = z.object({
  kind: ChangeKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  data: z.record(z.unknown()).optional(),
  createdBy: z.object({
    type: z.enum(['chief', 'human', 'system']),
    id: z.string(),
  }),
});

const JudgmentInput = z.object({
  verdict: z.enum(['approved', 'approved_with_constraints', 'rejected', 'simulation_required', 'escalated', 'deferred']),
  rationale: z.string().min(1),
  constraints: z.array(z.string()).optional(),
  layers: z.record(z.unknown()).optional(),
});

const RollbackInput = z.object({
  reason: z.string().min(1),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  world_id: string;
  cycle_id: string;
  status: string;
  kind: string;
  title: string;
  summary: string;
  data: string;
  judgment_report: string | null;
  applied_change_id: string | null;
  snapshot_before_id: string | null;
  snapshot_after_id: string | null;
  created_by: string;
  created_at: string;
  judged_at: string | null;
  applied_at: string | null;
  rolled_back_at: string | null;
  version: number;
}

interface AppliedChangeRow {
  id: string;
  proposal_id: string;
  cycle_id: string;
  world_id: string;
  snapshot_before_id: string | null;
  snapshot_after_id: string | null;
  status: string;
  applied_at: string;
  rolled_back_at: string | null;
  rollback_reason: string | null;
  version: number;
  created_at: string;
}

interface CycleRunRow {
  id: string;
  world_id: string;
  current_stage: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateProposalId(): string {
  return `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateAppliedChangeId(): string {
  return `ac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function proposalRowToResponse(row: ProposalRow): Record<string, unknown> {
  return {
    id: row.id,
    worldId: row.world_id,
    cycleId: row.cycle_id,
    status: row.status,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    data: JSON.parse(row.data) as unknown,
    judgmentReport: row.judgment_report ? JSON.parse(row.judgment_report) as unknown : null,
    appliedChangeId: row.applied_change_id,
    snapshotBeforeId: row.snapshot_before_id,
    snapshotAfterId: row.snapshot_after_id,
    createdBy: JSON.parse(row.created_by) as unknown,
    createdAt: row.created_at,
    judgedAt: row.judged_at,
    appliedAt: row.applied_at,
    rolledBackAt: row.rolled_back_at,
    version: row.version,
  };
}

function appliedChangeRowToResponse(row: AppliedChangeRow): Record<string, unknown> {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    cycleId: row.cycle_id,
    worldId: row.world_id,
    snapshotBeforeId: row.snapshot_before_id,
    snapshotAfterId: row.snapshot_after_id,
    status: row.status,
    appliedAt: row.applied_at,
    rolledBackAt: row.rolled_back_at,
    rollbackReason: row.rollback_reason,
    version: row.version,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Valid status transitions for judgment verdicts
// ---------------------------------------------------------------------------

const JUDGMENT_TRANSITIONS: Record<string, boolean> = {
  proposed: true,
};

const APPLY_TRANSITIONS: Record<string, boolean> = {
  approved: true,
  approved_with_constraints: true,
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function canonicalProposalRoutes(db: Database): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // SS11.1 — Submit Proposal to Cycle
  // -----------------------------------------------------------------------
  app.post('/api/v1/cycles/:id/proposals', async (c) => {
    const cycleId = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = SubmitProposalInput.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    // Verify cycle exists and is open
    const cycle = db.prepare(
      'SELECT id, world_id, current_stage FROM cycle_runs WHERE id = ?'
    ).get(cycleId) as CycleRunRow | null;

    if (!cycle) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Cycle not found' } },
        404,
      );
    }

    if (cycle.current_stage === 'complete' || cycle.current_stage === 'failed') {
      return c.json(
        { ok: false, error: { code: 'CYCLE_CLOSED', message: 'Cannot submit proposals to a closed cycle' } },
        409,
      );
    }

    const id = generateProposalId();
    const timestamp = now();
    const { kind, title, summary, data, createdBy } = parsed.data;

    db.prepare(`
      INSERT INTO canonical_proposals (
        id, world_id, cycle_id, status, kind, title, summary, data,
        created_by, created_at, version
      ) VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id, cycle.world_id, cycleId,
      kind, title, summary,
      JSON.stringify(data ?? {}),
      JSON.stringify(createdBy),
      timestamp,
    );

    // Update cycle_runs proposal_ids
    const cycleRow = db.prepare('SELECT proposal_ids FROM cycle_runs WHERE id = ?').get(cycleId) as { proposal_ids: string };
    const proposalIds = JSON.parse(cycleRow.proposal_ids) as string[];
    proposalIds.push(id);
    db.prepare('UPDATE cycle_runs SET proposal_ids = ? WHERE id = ?').run(JSON.stringify(proposalIds), cycleId);

    // THY-07: audit log
    appendAudit(db, 'canonical_proposal', id, 'submitted', {
      cycleId, worldId: cycle.world_id, kind, title,
    }, 'system');

    const row = db.prepare('SELECT * FROM canonical_proposals WHERE id = ?').get(id) as ProposalRow;
    return c.json({ ok: true, data: proposalRowToResponse(row) }, 201);
  });

  // -----------------------------------------------------------------------
  // SS12.1 — Judge Proposal
  // -----------------------------------------------------------------------
  app.post('/api/v1/proposals/:id/judgment', async (c) => {
    const proposalId = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = JudgmentInput.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const proposal = db.prepare(
      'SELECT * FROM canonical_proposals WHERE id = ?'
    ).get(proposalId) as ProposalRow | null;

    if (!proposal) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Proposal not found' } },
        404,
      );
    }

    if (!JUDGMENT_TRANSITIONS[proposal.status]) {
      return c.json(
        { ok: false, error: { code: 'INVALID_STATE', message: `Cannot judge proposal in status: ${proposal.status}` } },
        409,
      );
    }

    const timestamp = now();
    const judgmentReport = {
      verdict: parsed.data.verdict,
      rationale: parsed.data.rationale,
      constraints: parsed.data.constraints ?? [],
      layers: parsed.data.layers ?? {},
      judgedAt: timestamp,
    };

    // Determine new status based on verdict
    const newStatus = parsed.data.verdict;

    db.prepare(`
      UPDATE canonical_proposals
      SET status = ?, judgment_report = ?, judged_at = ?, version = version + 1
      WHERE id = ?
    `).run(newStatus, JSON.stringify(judgmentReport), timestamp, proposalId);

    // Update cycle_runs judgment_report_ids
    const cycleRow = db.prepare('SELECT judgment_report_ids FROM cycle_runs WHERE id = ?').get(proposal.cycle_id) as { judgment_report_ids: string };
    const reportIds = JSON.parse(cycleRow.judgment_report_ids) as string[];
    reportIds.push(proposalId);
    db.prepare('UPDATE cycle_runs SET judgment_report_ids = ? WHERE id = ?').run(JSON.stringify(reportIds), proposal.cycle_id);

    // THY-07: audit log
    appendAudit(db, 'canonical_proposal', proposalId, 'judged', {
      cycleId: proposal.cycle_id,
      verdict: parsed.data.verdict,
      rationale: parsed.data.rationale,
    }, 'system');

    const updated = db.prepare('SELECT * FROM canonical_proposals WHERE id = ?').get(proposalId) as ProposalRow;
    return c.json({ ok: true, data: proposalRowToResponse(updated) });
  });

  // -----------------------------------------------------------------------
  // SS13.1 — Apply Proposal
  // -----------------------------------------------------------------------
  app.post('/api/v1/proposals/:id/apply', async (c) => {
    const proposalId = c.req.param('id');

    const proposal = db.prepare(
      'SELECT * FROM canonical_proposals WHERE id = ?'
    ).get(proposalId) as ProposalRow | null;

    if (!proposal) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Proposal not found' } },
        404,
      );
    }

    if (!APPLY_TRANSITIONS[proposal.status]) {
      return c.json(
        { ok: false, error: { code: 'INVALID_STATE', message: `Cannot apply proposal in status: ${proposal.status}. Must be approved or approved_with_constraints.` } },
        409,
      );
    }

    const timestamp = now();
    const appliedChangeId = generateAppliedChangeId();

    // Create applied_change record
    db.prepare(`
      INSERT INTO applied_changes (
        id, proposal_id, cycle_id, world_id,
        status, applied_at, version, created_at
      ) VALUES (?, ?, ?, ?, 'applied', ?, 1, ?)
    `).run(appliedChangeId, proposalId, proposal.cycle_id, proposal.world_id, timestamp, timestamp);

    // Update proposal status
    db.prepare(`
      UPDATE canonical_proposals
      SET status = 'applied', applied_change_id = ?, applied_at = ?, version = version + 1
      WHERE id = ?
    `).run(appliedChangeId, timestamp, proposalId);

    // Update cycle_runs applied_change_ids
    const cycleRow = db.prepare('SELECT applied_change_ids FROM cycle_runs WHERE id = ?').get(proposal.cycle_id) as { applied_change_ids: string };
    const changeIds = JSON.parse(cycleRow.applied_change_ids) as string[];
    changeIds.push(appliedChangeId);
    db.prepare('UPDATE cycle_runs SET applied_change_ids = ? WHERE id = ?').run(JSON.stringify(changeIds), proposal.cycle_id);

    // THY-07: audit log
    appendAudit(db, 'applied_change', appliedChangeId, 'applied', {
      proposalId,
      cycleId: proposal.cycle_id,
      worldId: proposal.world_id,
    }, 'system');

    const appliedChange = db.prepare('SELECT * FROM applied_changes WHERE id = ?').get(appliedChangeId) as AppliedChangeRow;
    return c.json({ ok: true, data: appliedChangeRowToResponse(appliedChange) });
  });

  // -----------------------------------------------------------------------
  // SS13.3 — Rollback Applied Change
  // -----------------------------------------------------------------------
  app.post('/api/v1/applied-changes/:id/rollback', async (c) => {
    const appliedChangeId = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = RollbackInput.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const change = db.prepare(
      'SELECT * FROM applied_changes WHERE id = ?'
    ).get(appliedChangeId) as AppliedChangeRow | null;

    if (!change) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Applied change not found' } },
        404,
      );
    }

    if (change.status === 'rolled_back') {
      return c.json(
        { ok: false, error: { code: 'ALREADY_ROLLED_BACK', message: 'This change has already been rolled back' } },
        409,
      );
    }

    const timestamp = now();

    // Update applied_change
    db.prepare(`
      UPDATE applied_changes
      SET status = 'rolled_back', rolled_back_at = ?, rollback_reason = ?, version = version + 1
      WHERE id = ?
    `).run(timestamp, parsed.data.reason, appliedChangeId);

    // Update proposal status to rolled_back
    db.prepare(`
      UPDATE canonical_proposals
      SET status = 'rolled_back', rolled_back_at = ?, version = version + 1
      WHERE id = ?
    `).run(timestamp, change.proposal_id);

    // THY-07: audit log
    appendAudit(db, 'applied_change', appliedChangeId, 'rolled_back', {
      proposalId: change.proposal_id,
      cycleId: change.cycle_id,
      reason: parsed.data.reason,
    }, 'system');

    const updated = db.prepare('SELECT * FROM applied_changes WHERE id = ?').get(appliedChangeId) as AppliedChangeRow;
    return c.json({ ok: true, data: appliedChangeRowToResponse(updated) });
  });

  return app;
}
