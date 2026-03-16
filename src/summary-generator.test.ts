/**
 * summary-generator.test.ts -- Night summary generator 測試
 *
 * 測試 generateNightSummary() 純函數 + recordNightSummary() 副作用。
 */

import { describe, it, expect } from 'vitest';
import { generateNightSummary, recordNightSummary } from './summary-generator';
import type { NightSummaryOpts, MarketMetricsSnapshot } from './summary-generator';
import type { GovernanceCycleResult, ChiefError } from './governance-scheduler';
import type { ChiefCycleResult, ChiefProposal } from './chief-autonomy';
import type { ApplyResult } from './world-manager';
import type { WorldChange } from './schemas/world-change';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProposal(changeType: string, reason = 'test reason'): ChiefProposal {
  return {
    change: { type: changeType } as WorldChange,
    reason,
    confidence: 0.8,
    trigger: 'test',
  };
}

function makeApplyResult(applied: boolean): ApplyResult {
  return {
    applied,
    judge_result: {
      allowed: applied,
      reasons: [],
      safety_check: true,
      legality_check: true,
      boundary_check: true,
      consistency_check: true,
      evaluator_check: true,
      warnings: [],
      requires_approval: false,
    },
    snapshot_before: 'snap-1',
    diff: null,
    state_after: null,
  };
}

function makeChiefResult(opts: {
  proposals?: ChiefProposal[];
  appliedCount?: number;
  skippedProposals?: { proposal: ChiefProposal; reason: string }[];
}): ChiefCycleResult {
  const proposals = opts.proposals ?? [];
  const skipped = opts.skippedProposals ?? [];
  const appliedCount = opts.appliedCount ?? (proposals.length - skipped.length);

  return {
    chief_id: 'chief-1',
    proposals,
    applied: Array.from({ length: appliedCount }, () => makeApplyResult(true)),
    skipped,
  };
}

function makeCycleResult(overrides: Partial<GovernanceCycleResult> = {}): GovernanceCycleResult {
  return {
    cycle_id: 'cycle-1',
    started_at: '2026-03-15T22:00:00.000Z',
    finished_at: '2026-03-15T22:01:00.000Z',
    villages_processed: 1,
    total_proposals: 0,
    total_applied: 0,
    total_rejected: 0,
    total_skipped: 0,
    chief_results: [],
    errors: [],
    pipeline_dispatches: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('summary-generator', () => {
  describe('generateNightSummary', () => {
    it('returns empty summary for 0 cycles', () => {
      const summary = generateNightSummary('village-1', [], { date: '2026-03-15' });

      expect(summary.village_id).toBe('village-1');
      expect(summary.date).toBe('2026-03-15');
      expect(summary.cycles_run).toBe(0);
      expect(summary.proposals_total).toBe(0);
      expect(summary.proposals_applied).toBe(0);
      expect(summary.proposals_rejected).toBe(0);
      expect(summary.key_events).toEqual([]);
      expect(summary.rollbacks).toBe(0);
      expect(summary.precedents_recorded).toBe(0);
      expect(summary.market_delta).toEqual({
        stalls_added: 0,
        stalls_removed: 0,
        revenue_total: 0,
        incidents: 0,
        satisfaction_change: 0,
      });
      expect(summary.generated_at).toBeTruthy();
    });

    it('counts single cycle with all proposals applied', () => {
      const proposals = [
        makeProposal('budget.adjust', 'reduce budget'),
        makeProposal('law.propose', 'new spending law'),
      ];
      const chiefResult = makeChiefResult({ proposals, appliedCount: 2 });

      const cycle = makeCycleResult({
        total_proposals: 2,
        total_applied: 2,
        total_rejected: 0,
        total_skipped: 0,
        chief_results: [chiefResult],
      });

      const summary = generateNightSummary('village-1', [cycle], { date: '2026-03-15' });

      expect(summary.cycles_run).toBe(1);
      expect(summary.proposals_total).toBe(2);
      expect(summary.proposals_applied).toBe(2);
      expect(summary.proposals_rejected).toBe(0);
      expect(summary.key_events.length).toBe(2);
      expect(summary.precedents_recorded).toBe(2);
    });

    it('counts mixed results (applied + rejected + skipped)', () => {
      const p1 = makeProposal('law.propose', 'good law');
      const p2 = makeProposal('budget.adjust', 'bad budget');
      const p3 = makeProposal('chief.update_permissions', 'permission change');

      const chiefResult = makeChiefResult({
        proposals: [p1, p2, p3],
        appliedCount: 1,
        skippedProposals: [{ proposal: p2, reason: 'violates SI-4' }],
      });

      const cycle = makeCycleResult({
        total_proposals: 3,
        total_applied: 1,
        total_rejected: 1,
        total_skipped: 1,
        chief_results: [chiefResult],
      });

      const summary = generateNightSummary('village-1', [cycle], { date: '2026-03-15' });

      expect(summary.proposals_total).toBe(3);
      expect(summary.proposals_applied).toBe(1);
      // rejected = total_rejected + total_skipped
      expect(summary.proposals_rejected).toBe(2);
    });

    it('extracts chief errors as key events', () => {
      const errors: ChiefError[] = [
        { chief_id: 'chief-a', village_id: 'village-1', error: 'timeout' },
        { chief_id: 'chief-b', village_id: 'village-1', error: 'invalid state' },
      ];

      const cycle1 = makeCycleResult({ errors: [errors[0]] });
      const cycle2 = makeCycleResult({
        cycle_id: 'cycle-2',
        errors: [errors[1]],
      });

      const summary = generateNightSummary('village-1', [cycle1, cycle2], { date: '2026-03-15' });

      const errorEvents = summary.key_events.filter((e) => e.type === 'chief_error');
      expect(errorEvents.length).toBe(2);
      expect(errorEvents[0].severity).toBe('critical');
      expect(errorEvents[0].score).toBe(80);
      expect(errorEvents[0].description).toContain('chief-a');
    });

    it('picks top 5 key_events by score when >5 events exist', () => {
      // 產生 7 個不同分數的 proposals
      const proposals = [
        makeProposal('constitution.supersede', 'r1'), // 100
        makeProposal('law.propose', 'r2'),            // 50
        makeProposal('budget.adjust', 'r3'),          // 30
        makeProposal('chief.update_permissions', 'r4'), // 40
        makeProposal('law.propose', 'r5'),            // 50
        makeProposal('budget.adjust', 'r6'),          // 30
        makeProposal('law.propose', 'r7'),            // 50
      ];

      const chiefResult = makeChiefResult({ proposals, appliedCount: 7 });

      const cycle = makeCycleResult({
        total_proposals: 7,
        total_applied: 7,
        chief_results: [chiefResult],
      });

      const summary = generateNightSummary('village-1', [cycle], { date: '2026-03-15' });

      expect(summary.key_events.length).toBe(5);
      // 最高分應為 constitution.supersede (100)
      expect(summary.key_events[0].type).toBe('constitution.supersede');
      expect(summary.key_events[0].score).toBe(100);
      // 不應包含分數最低的兩個 (budget.adjust = 30)
      const scores = summary.key_events.map((e) => e.score);
      expect(Math.min(...scores)).toBeGreaterThanOrEqual(40);
    });

    it('excludes skipped (overlap) cycles from cycles_run', () => {
      const activeCycle = makeCycleResult({
        total_proposals: 2,
        total_applied: 2,
      });
      const skippedCycle = makeCycleResult({
        cycle_id: 'cycle-skip',
        skipped: true,
        skip_reason: 'already_running',
      });

      const summary = generateNightSummary(
        'village-1',
        [activeCycle, skippedCycle],
        { date: '2026-03-15' },
      );

      expect(summary.cycles_run).toBe(1);
      // Skipped cycle proposals not counted
      expect(summary.proposals_total).toBe(2);
    });

    it('computes market_delta with start/end metrics', () => {
      const startMetrics: MarketMetricsSnapshot = {
        active_stalls: 10,
        revenue: 500,
        incidents: 2,
        satisfaction: 0.75,
      };
      const endMetrics: MarketMetricsSnapshot = {
        active_stalls: 13,
        revenue: 1200,
        incidents: 1,
        satisfaction: 0.82,
      };

      const cycle = makeCycleResult();
      const opts: NightSummaryOpts = {
        date: '2026-03-15',
        startMetrics,
        endMetrics,
      };

      const summary = generateNightSummary('village-1', [cycle], opts);

      expect(summary.market_delta.stalls_added).toBe(3);
      expect(summary.market_delta.stalls_removed).toBe(0);
      expect(summary.market_delta.revenue_total).toBe(1200);
      expect(summary.market_delta.incidents).toBe(1);
      expect(summary.market_delta.satisfaction_change).toBe(0.07);
    });

    it('returns zero market_delta without metrics', () => {
      const cycle = makeCycleResult();
      const summary = generateNightSummary('village-1', [cycle], { date: '2026-03-15' });

      expect(summary.market_delta).toEqual({
        stalls_added: 0,
        stalls_removed: 0,
        revenue_total: 0,
        incidents: 0,
        satisfaction_change: 0,
      });
    });

    it('counts rollbacks from law.repeal and chief.dismiss proposals', () => {
      const proposals = [
        makeProposal('law.repeal', 'repeal outdated law'),
        makeProposal('chief.dismiss', 'dismiss inactive chief'),
        makeProposal('law.propose', 'new law'),
      ];
      const chiefResult = makeChiefResult({ proposals, appliedCount: 3 });

      const cycle = makeCycleResult({
        total_proposals: 3,
        total_applied: 3,
        chief_results: [chiefResult],
      });

      const summary = generateNightSummary('village-1', [cycle], { date: '2026-03-15' });

      expect(summary.rollbacks).toBe(2);
    });

    it('generates scheduling_pressure warning when 3+ cycles skipped', () => {
      const skipped = Array.from({ length: 3 }, (_, i) =>
        makeCycleResult({
          cycle_id: `skip-${i}`,
          skipped: true,
          skip_reason: 'already_running',
        }),
      );

      const summary = generateNightSummary('village-1', skipped, { date: '2026-03-15' });

      expect(summary.cycles_run).toBe(0);
      const pressureEvent = summary.key_events.find((e) => e.type === 'scheduling_pressure');
      expect(pressureEvent).toBeDefined();
      expect(pressureEvent?.severity).toBe('warning');
      expect(pressureEvent?.description).toContain('3 cycles skipped');
    });
  });

  describe('recordNightSummary', () => {
    it('writes audit_log entry', async () => {
      const db = new Database(':memory:');
      initSchema(db);

      const summary = generateNightSummary('village-1', [], { date: '2026-03-15' });
      await recordNightSummary(db, summary);

      const rows = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'night_summary'",
      ).all() as Array<{ entity_id: string; action: string; payload: string }>;

      expect(rows.length).toBe(1);
      expect(rows[0].entity_id).toBe('village-1');
      expect(rows[0].action).toBe('generated');

      const payload = JSON.parse(rows[0].payload) as Record<string, unknown>;
      expect(payload.date).toBe('2026-03-15');
      expect(payload.cycles_run).toBe(0);
    });
  });
});
