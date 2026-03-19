/**
 * precedent-recorder.test.ts — PrecedentRecorder 測試
 *
 * 覆蓋：
 * - 自動收錄觸發：beneficial / harmful / neutral 建立，inconclusive 跳過
 * - PREC-01: proposalId + outcomeReportId 必填
 * - PREC-02: 無 update/delete 方法（append-only）
 * - THY-04: version 欄位
 * - THY-07: audit log 寫入
 * - 欄位完整性、context tags 保留
 * - get / listByWorld 查詢
 *
 * @see docs/plan/world-cycle/TRACK_F_PRECEDENT_RECORDER.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { PrecedentRecordSchema } from '../schemas/precedent-record';
import type { OutcomeReport } from '../schemas/outcome-report';
import { PrecedentRecorder, type PrecedentContext } from './precedent-recorder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutcomeReport(overrides: Partial<OutcomeReport> = {}): OutcomeReport {
  return {
    id: 'report-001',
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
    sideEffects: [
      {
        metric: 'cpu',
        baseline: 200,
        observed: 205,
        delta: 5,
        severity: 'negligible',
        acceptable: true,
      },
    ],
    verdict: 'beneficial',
    recommendation: 'reinforce',
    notes: ['Expected effects: 1/1 matched', 'No side effects detected', 'Verdict: beneficial'],
    createdAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

function makeContext(overrides: Partial<PrecedentContext> = {}): PrecedentContext {
  return {
    worldId: 'world-001',
    worldType: 'midnight_market',
    proposalId: 'prop-001',
    changeKind: 'throttle_entry',
    cycleId: 'cycle-001',
    worldStateDescription: 'Peak hour with 80% zone capacity',
    decisionDescription: 'Throttle north gate entry to 60%',
    tags: ['peak_hour', 'north_gate'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: Database;
let recorder: PrecedentRecorder;

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  recorder = new PrecedentRecorder(db);
});

// ---------------------------------------------------------------------------
// Auto-ingest trigger
// ---------------------------------------------------------------------------

describe('buildFromOutcome — auto-ingest', () => {
  it('should create precedent from beneficial outcome', () => {
    const report = makeOutcomeReport({ verdict: 'beneficial', recommendation: 'reinforce' });
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.outcome).toBe('beneficial');
    expect(result?.recommendation).toBe('reinforce');
  });

  it('should create precedent from harmful outcome', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      primaryObjectiveMet: false,
      sideEffects: [
        {
          metric: 'errors',
          baseline: 10,
          observed: 50,
          delta: 40,
          severity: 'significant',
          acceptable: false,
        },
      ],
    });
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.outcome).toBe('harmful');
    expect(result?.recommendation).toBe('rollback');
  });

  it('should create precedent from neutral outcome', () => {
    const report = makeOutcomeReport({ verdict: 'neutral', recommendation: 'retune' });
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.outcome).toBe('neutral');
  });

  it('should return null for inconclusive outcome', () => {
    const report = makeOutcomeReport({ verdict: 'inconclusive', recommendation: 'watch' });
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PREC-01: proposalId + outcomeReportId required
// ---------------------------------------------------------------------------

describe('PREC-01: traceability', () => {
  it('should reject empty proposalId', () => {
    const report = makeOutcomeReport();
    const context = makeContext({ proposalId: '' });

    expect(() => recorder.buildFromOutcome(report, context)).toThrow();
  });

  it('should reject empty outcomeReportId', () => {
    const report = makeOutcomeReport({ id: '' });
    const context = makeContext();

    expect(() => recorder.buildFromOutcome(report, context)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PREC-02: append-only
// ---------------------------------------------------------------------------

describe('PREC-02: append-only', () => {
  it('should not have update method', () => {
    expect('update' in recorder).toBe(false);
  });

  it('should not have delete method', () => {
    expect('delete' in recorder).toBe(false);
  });

  it('should not have remove method', () => {
    expect('remove' in recorder).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field completeness
// ---------------------------------------------------------------------------

describe('field completeness', () => {
  it('should populate all PrecedentRecord fields', () => {
    const report = makeOutcomeReport();
    const context = makeContext();
    const result = recorder.buildFromOutcome(report, context);

    expect(result).not.toBeNull();
    // Zod parse succeeds = all fields valid
    const parsed = PrecedentRecordSchema.parse(result);
    expect(parsed.id).toBeTruthy();
    expect(parsed.worldId).toBe('world-001');
    expect(parsed.worldType).toBe('midnight_market');
    expect(parsed.proposalId).toBe('prop-001');
    expect(parsed.outcomeReportId).toBe('report-001');
    expect(parsed.changeKind).toBe('throttle_entry');
    expect(parsed.cycleId).toBe('cycle-001');
    expect(parsed.context).toBe('Peak hour with 80% zone capacity');
    expect(parsed.decision).toBe('Throttle north gate entry to 60%');
    expect(parsed.outcome).toBe('beneficial');
    expect(parsed.recommendation).toBe('reinforce');
    expect(Array.isArray(parsed.lessonsLearned)).toBe(true);
    expect(parsed.lessonsLearned.length).toBeGreaterThan(0);
    expect(parsed.createdAt).toBeTruthy();
  });

  it('should have version field (THY-04)', () => {
    const report = makeOutcomeReport();
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
  });

  it('should preserve context tags', () => {
    const report = makeOutcomeReport();
    const context = makeContext({ tags: ['peak_hour', 'festival_night', 'north_gate'] });
    const result = recorder.buildFromOutcome(report, context);

    expect(result).not.toBeNull();
    expect(result?.contextTags).toEqual(['peak_hour', 'festival_night', 'north_gate']);
  });
});

// ---------------------------------------------------------------------------
// THY-07: audit log
// ---------------------------------------------------------------------------

describe('THY-07: audit log', () => {
  it('should write audit log on creation', () => {
    const report = makeOutcomeReport();
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();

    if (!result) throw new Error('Expected result');
    const logs = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'precedent_record' AND entity_id = ?",
    ).all(result.id) as Array<{ action: string; actor: string }>;

    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('created');
    expect(logs[0].actor).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// DB persistence: get / listByWorld
// ---------------------------------------------------------------------------

describe('get', () => {
  it('should retrieve a stored precedent by id', () => {
    const report = makeOutcomeReport();
    const created = recorder.buildFromOutcome(report, makeContext());

    expect(created).not.toBeNull();

    const fetched = recorder.get(created?.id ?? '');
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created?.id);
    expect(fetched?.worldId).toBe('world-001');
    expect(fetched?.proposalId).toBe('prop-001');
  });

  it('should return null for non-existent id', () => {
    const result = recorder.get('non-existent');
    expect(result).toBeNull();
  });
});

describe('listByWorld', () => {
  it('should list all precedents for a world', () => {
    const report1 = makeOutcomeReport({ id: 'r1' });
    const report2 = makeOutcomeReport({ id: 'r2', verdict: 'harmful', recommendation: 'rollback' });

    recorder.buildFromOutcome(report1, makeContext());
    recorder.buildFromOutcome(report2, makeContext({ proposalId: 'prop-002' }));

    const list = recorder.listByWorld('world-001');
    expect(list.length).toBe(2);
  });

  it('should filter by changeKind', () => {
    const report = makeOutcomeReport();
    recorder.buildFromOutcome(report, makeContext({ changeKind: 'throttle_entry' }));
    recorder.buildFromOutcome(
      makeOutcomeReport({ id: 'r2' }),
      makeContext({ proposalId: 'p2', changeKind: 'pause_event' }),
    );

    const filtered = recorder.listByWorld('world-001', { changeKind: 'throttle_entry' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].changeKind).toBe('throttle_entry');
  });

  it('should filter by verdict', () => {
    recorder.buildFromOutcome(
      makeOutcomeReport({ verdict: 'beneficial', recommendation: 'reinforce' }),
      makeContext(),
    );
    recorder.buildFromOutcome(
      makeOutcomeReport({ id: 'r2', verdict: 'harmful', recommendation: 'rollback' }),
      makeContext({ proposalId: 'p2' }),
    );

    const filtered = recorder.listByWorld('world-001', { verdict: 'harmful' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].outcome).toBe('harmful');
  });

  it('should filter by contextTag', () => {
    recorder.buildFromOutcome(
      makeOutcomeReport(),
      makeContext({ tags: ['peak_hour', 'north_gate'] }),
    );
    recorder.buildFromOutcome(
      makeOutcomeReport({ id: 'r2' }),
      makeContext({ proposalId: 'p2', tags: ['off_peak'] }),
    );

    const filtered = recorder.listByWorld('world-001', { contextTag: 'peak_hour' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].contextTags).toContain('peak_hour');
  });

  it('should return empty array for world with no precedents', () => {
    const list = recorder.listByWorld('no-such-world');
    expect(list).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractLessons
// ---------------------------------------------------------------------------

describe('extractLessons (via buildFromOutcome)', () => {
  it('should include lessons about matched effects', () => {
    const report = makeOutcomeReport();
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.lessonsLearned.some(l => l.includes('expected effects'))).toBe(true);
  });

  it('should include lessons about significant side effects', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      sideEffects: [
        {
          metric: 'errors',
          baseline: 10,
          observed: 100,
          delta: 90,
          severity: 'significant',
          acceptable: false,
        },
      ],
    });
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.lessonsLearned.some(l => l.includes('Significant side effect'))).toBe(true);
  });

  it('should include verdict-based lesson for harmful outcome', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
    });
    const result = recorder.buildFromOutcome(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.lessonsLearned.some(l => l.includes('harmful'))).toBe(true);
  });
});
