import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema, appendAudit } from './db';
import { CycleMetricsCollector } from './cycle-metrics';
import type { LoopCycle } from './loop-runner';
import type { DecideContext, DecideResult, DecisionReasoning } from './decision-engine';
import { CycleMetricsSchema, DecideSnapshotSchema } from './schemas/cycle-metrics';

// ---------------------------------------------------------------------------
// 測試輔助
// ---------------------------------------------------------------------------

function setupDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);
  return db;
}

/** 建立最小可用的 LoopCycle */
function makeCycle(overrides: Partial<LoopCycle> = {}): LoopCycle {
  return {
    id: 'cycle-test-1',
    village_id: 'village-1',
    chief_id: 'chief-1',
    trigger: 'manual',
    status: 'completed',
    version: 1,
    budget_remaining: 50,
    cost_incurred: 50,
    iterations: 3,
    max_iterations: 10,
    timeout_ms: 300000,
    actions: [],
    laws_proposed: [],
    laws_enacted: [],
    abort_reason: null,
    intent: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** 建立最小 DecideContext */
function makeContext(overrides: Partial<DecideContext> = {}): DecideContext {
  return {
    cycle_id: 'cycle-test-1',
    village_id: 'village-1',
    iteration: 0,
    max_iterations: 10,
    budget: {
      per_action_limit: 10,
      per_day_limit: 100,
      per_loop_limit: 50,
      spent_today: 20,
      spent_this_loop: 10,
    },
    budget_ratio: 0.8,
    last_action: null,
    completed_action_types: [],
    pending_approvals: 0,
    blocked_count: 0,
    recent_rollbacks: 0,
    edda_precedents: [],
    edda_available: false,
    chief: {
      id: 'chief-1',
      village_id: 'village-1',
      name: 'TestChief',
      role: 'content_creator',
      version: 1,
      status: 'active',
      skills: [],
      permissions: ['propose_law'],
      personality: { risk_tolerance: 'moderate' },
      constraints: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    chief_skills: [],
    constitution: {
      id: 'const-1',
      village_id: 'village-1',
      version: 1,
      status: 'active',
      created_at: new Date().toISOString(),
      created_by: 'human',
      rules: [],
      allowed_permissions: ['propose_law'],
      budget_limits: {
        max_cost_per_action: 10,
        max_cost_per_day: 100,
        max_cost_per_loop: 50,
      },
    },
    active_laws: [],
    observations: [],
    intent: null,
    ...overrides,
  } as DecideContext;
}

/** 建立最小 DecideResult */
function makeResult(overrides: Partial<DecideResult> = {}): DecideResult {
  const reasoning: DecisionReasoning = {
    summary: 'No action needed',
    factors: ['test factor'],
    precedent_notes: [],
    law_considerations: [],
    personality_effect: 'TestChief [moderate]',
    confidence: 0.9,
  };
  return {
    action: null,
    law_proposals: [],
    reasoning,
    updated_intent: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// collect() 測試
// ---------------------------------------------------------------------------

describe('CycleMetricsCollector.collect', () => {
  it('空 actions 時所有計數為 0', () => {
    const cycle = makeCycle();
    const metrics = CycleMetricsCollector.collect(cycle);

    expect(metrics.actions_executed).toBe(0);
    expect(metrics.actions_blocked).toBe(0);
    expect(metrics.actions_pending).toBe(0);
  });

  it('正確計數各狀態的 actions', () => {
    const cycle = makeCycle({
      actions: [
        { type: 'research', description: 'd', estimated_cost: 5, risk_level: 'low', status: 'executed', reason: 'r' },
        { type: 'draft', description: 'd', estimated_cost: 5, risk_level: 'low', status: 'executed', reason: 'r' },
        { type: 'review', description: 'd', estimated_cost: 5, risk_level: 'medium', status: 'pending_approval', reason: 'r' },
        { type: 'publish', description: 'd', estimated_cost: 5, risk_level: 'low', status: 'blocked', reason: 'r', blocked_reasons: ['no skill'] },
      ],
    });

    const metrics = CycleMetricsCollector.collect(cycle);
    expect(metrics.actions_executed).toBe(2);
    expect(metrics.actions_blocked).toBe(1);
    expect(metrics.actions_pending).toBe(1);
  });

  it('正確計算 budget_used_ratio', () => {
    const cycle = makeCycle({ cost_incurred: 30, budget_remaining: 70 });
    const metrics = CycleMetricsCollector.collect(cycle);
    expect(metrics.budget_used_ratio).toBeCloseTo(0.3);
  });

  it('budget 全 0 時 ratio 為 0', () => {
    const cycle = makeCycle({ cost_incurred: 0, budget_remaining: 0 });
    const metrics = CycleMetricsCollector.collect(cycle);
    expect(metrics.budget_used_ratio).toBe(0);
  });

  it('正確計數 laws_proposed 和 laws_enacted', () => {
    const cycle = makeCycle({
      laws_proposed: ['law-1', 'law-2', 'law-3'],
      laws_enacted: ['law-1'],
    });
    const metrics = CycleMetricsCollector.collect(cycle);
    expect(metrics.laws_proposed).toBe(3);
    expect(metrics.laws_enacted).toBe(1);
  });

  it('結果通過 Zod schema 驗證', () => {
    const cycle = makeCycle({
      actions: [
        { type: 'research', description: 'd', estimated_cost: 5, risk_level: 'low', status: 'executed', reason: 'r' },
      ],
      cost_incurred: 25,
      budget_remaining: 75,
      laws_proposed: ['law-1'],
    });
    const metrics = CycleMetricsCollector.collect(cycle);
    const parsed = CycleMetricsSchema.safeParse(metrics);
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// record() 測試
// ---------------------------------------------------------------------------

describe('CycleMetricsCollector.record', () => {
  let db: Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('寫入 audit_log 使用正確的 entity_type', () => {
    const metrics = CycleMetricsCollector.collect(makeCycle());
    CycleMetricsCollector.record(db, 'cycle-1', metrics);

    const row = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'cycle_metrics' AND action = 'record'",
    ).get() as Record<string, unknown> | null;

    expect(row).not.toBeNull();
    expect(row!.entity_id).toBe('cycle-1');
    expect(row!.actor).toBe('system');
  });

  it('payload 包含完整 metrics 資料', () => {
    const cycle = makeCycle({
      actions: [
        { type: 'a', description: 'd', estimated_cost: 5, risk_level: 'low', status: 'executed', reason: 'r' },
      ],
      cost_incurred: 40,
      budget_remaining: 60,
    });
    const metrics = CycleMetricsCollector.collect(cycle);
    CycleMetricsCollector.record(db, 'cycle-2', metrics);

    const row = db.prepare(
      "SELECT payload FROM audit_log WHERE entity_type = 'cycle_metrics' AND entity_id = 'cycle-2'",
    ).get() as { payload: string };

    const payload = JSON.parse(row.payload);
    expect(payload.actions_executed).toBe(1);
    expect(payload.budget_used_ratio).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// snapshot() + replay() 測試
// ---------------------------------------------------------------------------

describe('CycleMetricsCollector.snapshot', () => {
  let db: Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('寫入 audit_log 使用 decide_snapshot action', () => {
    const ctx = makeContext();
    const result = makeResult();
    CycleMetricsCollector.snapshot(db, ctx, result, 'v0.1');

    const row = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'cycle_metrics' AND action = 'decide_snapshot'",
    ).get() as Record<string, unknown> | null;

    expect(row).not.toBeNull();
    expect(row!.entity_id).toBe('cycle-test-1');
  });

  it('payload 包含 context_hash 和 schema_version', () => {
    const ctx = makeContext();
    const result = makeResult();
    CycleMetricsCollector.snapshot(db, ctx, result, 'v0.1');

    const row = db.prepare(
      "SELECT payload FROM audit_log WHERE action = 'decide_snapshot'",
    ).get() as { payload: string };

    const snap = JSON.parse(row.payload);
    expect(snap.schema_version).toBe('snapshot.v1');
    expect(snap.engine_version).toBe('v0.1');
    expect(snap.context_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('snapshot payload 通過 Zod schema 驗證', () => {
    const ctx = makeContext();
    const result = makeResult();
    CycleMetricsCollector.snapshot(db, ctx, result, 'v0.1');

    const row = db.prepare(
      "SELECT payload FROM audit_log WHERE action = 'decide_snapshot'",
    ).get() as { payload: string };

    const parsed = DecideSnapshotSchema.safeParse(JSON.parse(row.payload));
    expect(parsed.success).toBe(true);
  });
});

describe('CycleMetricsCollector.replay', () => {
  let db: Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('回傳與原始相同的 context 和 result', () => {
    const ctx = makeContext();
    const result = makeResult();
    CycleMetricsCollector.snapshot(db, ctx, result, 'v0.1');

    // 取得 audit_log id
    const row = db.prepare(
      "SELECT id FROM audit_log WHERE action = 'decide_snapshot'",
    ).get() as { id: number };

    const replayed = CycleMetricsCollector.replay(db, row.id);
    expect(replayed).not.toBeNull();
    expect(replayed!.context.cycle_id).toBe(ctx.cycle_id);
    expect(replayed!.context.village_id).toBe(ctx.village_id);
    expect(replayed!.context.budget_ratio).toBe(ctx.budget_ratio);
    expect(replayed!.result.reasoning.summary).toBe(result.reasoning.summary);
    expect(replayed!.result.reasoning.confidence).toBe(result.reasoning.confidence);
  });

  it('不存在的 id 回傳 null', () => {
    const replayed = CycleMetricsCollector.replay(db, 99999);
    expect(replayed).toBeNull();
  });

  it('非 decide_snapshot 的 audit entry 回傳 null', () => {
    appendAudit(db, 'cycle_metrics', 'c-1', 'record', { test: 1 }, 'system');
    const row = db.prepare(
      "SELECT id FROM audit_log WHERE action = 'record'",
    ).get() as { id: number };

    const replayed = CycleMetricsCollector.replay(db, row.id);
    expect(replayed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hashContext 決定性測試
// ---------------------------------------------------------------------------

describe('CycleMetricsCollector.hashContext', () => {
  it('相同 context 產生相同 hash', () => {
    const ctx = makeContext();
    const hash1 = CycleMetricsCollector.hashContext(ctx);
    const hash2 = CycleMetricsCollector.hashContext(ctx);
    expect(hash1).toBe(hash2);
  });

  it('不同 context 產生不同 hash', () => {
    const ctx1 = makeContext({ cycle_id: 'cycle-a' });
    const ctx2 = makeContext({ cycle_id: 'cycle-b' });
    const hash1 = CycleMetricsCollector.hashContext(ctx1);
    const hash2 = CycleMetricsCollector.hashContext(ctx2);
    expect(hash1).not.toBe(hash2);
  });

  it('hash 為 64 字元 hex 字串', () => {
    const hash = CycleMetricsCollector.hashContext(makeContext());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// getLatestSnapshot 測試
// ---------------------------------------------------------------------------

describe('CycleMetricsCollector.getLatestSnapshot', () => {
  let db: Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('回傳最新的 snapshot', () => {
    const ctx1 = makeContext({ iteration: 0 });
    const ctx2 = makeContext({ iteration: 1 });
    const result = makeResult();

    CycleMetricsCollector.snapshot(db, ctx1, result, 'v0.1');
    CycleMetricsCollector.snapshot(db, ctx2, result, 'v0.1');

    const latest = CycleMetricsCollector.getLatestSnapshot(db, 'cycle-test-1');
    expect(latest).not.toBeNull();
    expect(latest!.context.iteration).toBe(1);
  });

  it('不存在的 cycle_id 回傳 null', () => {
    const latest = CycleMetricsCollector.getLatestSnapshot(db, 'nonexistent');
    expect(latest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// replay 決定性驗證 — 同 context 經 decide 應產生相同 result
// ---------------------------------------------------------------------------

describe('決策快照 replay 決定性', () => {
  let db: Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('snapshot → replay 保留完整 reasoning chain', () => {
    const ctx = makeContext({
      budget_ratio: 0.5,
      observations: [{ type: 'test', value: 42 }],
    });
    const result = makeResult({
      reasoning: {
        summary: 'Test action taken',
        factors: ['budget at 50%', '1 observation'],
        precedent_notes: ['precedent-1'],
        law_considerations: ['law-1: test'],
        personality_effect: 'TestChief [moderate]',
        confidence: 0.85,
      },
    });

    CycleMetricsCollector.snapshot(db, ctx, result, 'v0.1');

    const row = db.prepare(
      "SELECT id FROM audit_log WHERE action = 'decide_snapshot'",
    ).get() as { id: number };

    const replayed = CycleMetricsCollector.replay(db, row.id);
    expect(replayed).not.toBeNull();
    expect(replayed!.result.reasoning.factors).toEqual(['budget at 50%', '1 observation']);
    expect(replayed!.result.reasoning.precedent_notes).toEqual(['precedent-1']);
    expect(replayed!.result.reasoning.confidence).toBe(0.85);
    expect(replayed!.context.observations).toEqual([{ type: 'test', value: 42 }]);
  });

  it('snapshot 的 context_hash 與 replay 後重算一致', () => {
    const ctx = makeContext();
    const result = makeResult();

    CycleMetricsCollector.snapshot(db, ctx, result, 'v0.1');

    const row = db.prepare(
      "SELECT payload FROM audit_log WHERE action = 'decide_snapshot'",
    ).get() as { payload: string };
    const snap = JSON.parse(row.payload);

    // 重算 hash
    const replayRow = db.prepare(
      "SELECT id FROM audit_log WHERE action = 'decide_snapshot'",
    ).get() as { id: number };
    const replayed = CycleMetricsCollector.replay(db, replayRow.id);
    const rehash = CycleMetricsCollector.hashContext(replayed!.context);

    expect(snap.context_hash).toBe(rehash);
  });
});
