/**
 * observation-builder.test.ts — ObservationBatch schema + builder 測試
 *
 * 測試涵蓋：
 * - ObservationBatch Zod schema 驗證
 * - 從 state diff 產生觀察
 * - 從 audit log 產生觀察（使用 :memory: SQLite）
 * - 從 external events 產生觀察
 * - 空來源產生空觀察
 * - 多來源聚合
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'bun:sqlite';
import { buildObservationBatch } from './observation-builder';
import type { ExternalEvent } from './observation-builder';
import {
  ObservationBatchSchema,
  ObservationSchema,
  ObservationSourceSchema,
  ObservationScopeSchema,
  ObservationImportanceSchema,
} from '../schemas/observation';
import { observeFromStateDiff } from './observation-sources/state-diff-source';
import { observeFromAuditLog } from './observation-sources/audit-log-source';
import { observeFromExternal } from './observation-sources/external-source';
import type { WorldState } from '../world/state';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';
import type { Law } from '../law-engine';
import type { Skill } from '../skill-registry';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeVillage(overrides: Partial<Village> = {}): Village {
  return {
    id: 'village-1',
    name: 'Test Village',
    description: 'A test village',
    target_repo: 'org/repo',
    status: 'active',
    metadata: {},
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConstitution(overrides: Partial<Constitution> = {}): Constitution {
  return {
    id: 'const-1',
    village_id: 'village-1',
    version: 1,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'human',
    rules: [{ id: 'rule-1', description: 'Rule 1', enforcement: 'hard', scope: ['all'] }],
    allowed_permissions: ['dispatch_task', 'propose_law'],
    budget_limits: { max_cost_per_action: 1, max_cost_per_day: 10, max_cost_per_loop: 5, max_cost_per_month: 0 },
    superseded_by: null,
    ...overrides,
  };
}

function makeChief(overrides: Partial<Chief> = {}): Chief {
  return {
    id: 'chief-1',
    village_id: 'village-1',
    name: 'Alpha',
    role: 'developer',
    role_type: 'chief' as const,
    parent_chief_id: null,
    version: 1,
    status: 'active',
    skills: [],
    pipelines: [],
    permissions: ['dispatch_task'],
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [],
    profile: null,
    adapter_type: 'local' as const,
    context_mode: 'fat' as const,
    adapter_config: {},
    budget_config: null,
    use_precedents: false,
    precedent_config: null,
    pause_reason: null,
    paused_at: null,
    last_heartbeat_at: null,
    current_run_id: null,
    current_run_status: 'idle' as const,
    timeout_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLaw(overrides: Partial<Law> = {}): Law {
  return {
    id: 'law-1',
    village_id: 'village-1',
    proposed_by: 'chief-1',
    approved_by: null,
    version: 1,
    status: 'active',
    category: 'testing',
    content: { description: 'Always write tests', strategy: { min_coverage: 80 } },
    risk_level: 'low',
    evidence: { source: 'observation', reasoning: 'Tests improve quality' },
    effectiveness: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'code-review',
    version: 1,
    status: 'verified',
    village_id: 'village-1',
    definition: {
      description: 'Reviews code',
      prompt_template: 'Review the following code: {{code}}',
      tools_required: [],
      constraints: [],
      examples: [],
    },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    verified_at: '2026-01-01T00:00:00Z',
    verified_by: 'human',
    content: null,
    source_type: 'system',
    source_origin: null,
    source_author: null,
    forked_from: null,
    scope_type: 'global',
    team_id: null,
    tags: [],
    used_count: 0,
    last_used_at: null,
    ...overrides,
  };
}

function makeWorldState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    village: makeVillage(),
    constitution: makeConstitution(),
    chiefs: [makeChief()],
    active_laws: [makeLaw()],
    skills: [makeSkill()],
    running_cycles: [],
    goals: [],
    assembled_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.run(`
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      event_id TEXT
    )
  `);
  return db;
}

function insertAuditLogEntry(
  db: Database,
  entry: {
    entity_type: string;
    entity_id: string;
    action: string;
    payload: string;
    actor: string;
    created_at: string;
  },
): void {
  db.prepare(
    `INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(entry.entity_type, entry.entity_id, entry.action, entry.payload, entry.actor, entry.created_at);
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('ObservationBatch Schema', () => {
  it('ObservationSourceSchema has exactly 5 values', () => {
    const values = ObservationSourceSchema.options;
    expect(values).toHaveLength(5);
    expect(values).toContain('state_diff');
    expect(values).toContain('audit_log');
    expect(values).toContain('external');
    expect(values).toContain('chief_inspection');
    expect(values).toContain('outcome_followup');
  });

  it('ObservationScopeSchema has correct values', () => {
    const values = ObservationScopeSchema.options;
    expect(values).toContain('world');
    expect(values).toContain('zone');
    expect(values).toContain('chief');
    expect(values).toContain('law');
  });

  it('ObservationImportanceSchema has 4 levels', () => {
    const values = ObservationImportanceSchema.options;
    expect(values).toHaveLength(4);
    expect(values).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('ObservationSchema requires id, source, timestamp, scope, importance, summary', () => {
    const valid = ObservationSchema.safeParse({
      id: 'obs_1',
      source: 'state_diff',
      timestamp: '2026-01-01T00:00:00Z',
      scope: 'world',
      importance: 'medium',
      summary: 'Test observation',
    });
    expect(valid.success).toBe(true);

    // 缺少 summary → 失敗
    const missing = ObservationSchema.safeParse({
      id: 'obs_1',
      source: 'state_diff',
      timestamp: '2026-01-01T00:00:00Z',
      scope: 'world',
      importance: 'medium',
    });
    expect(missing.success).toBe(false);
  });

  it('ObservationSchema accepts optional details and targetIds', () => {
    const result = ObservationSchema.safeParse({
      id: 'obs_2',
      source: 'audit_log',
      timestamp: '2026-01-01T00:00:00Z',
      scope: 'chief',
      importance: 'high',
      summary: 'Chief added',
      details: { fields: ['name'] },
      targetIds: ['chief-1'],
    });
    expect(result.success).toBe(true);
  });

  it('ObservationBatchSchema validates a complete batch', () => {
    const result = ObservationBatchSchema.safeParse({
      id: 'obs_batch_1',
      worldId: 'village-1',
      observations: [
        {
          id: 'obs_1',
          source: 'state_diff',
          timestamp: '2026-01-01T00:00:00Z',
          scope: 'world',
          importance: 'low',
          summary: 'No changes',
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      version: 1,
    });
    expect(result.success).toBe(true);
  });

  it('ObservationBatchSchema rejects missing worldId', () => {
    const result = ObservationBatchSchema.safeParse({
      id: 'obs_batch_1',
      observations: [],
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('ObservationBatchSchema defaults version to 1', () => {
    const result = ObservationBatchSchema.parse({
      id: 'obs_batch_1',
      worldId: 'village-1',
      observations: [],
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.version).toBe(1);
  });

  it('ObservationBatchSchema allows optional cycleId', () => {
    const withCycle = ObservationBatchSchema.safeParse({
      id: 'obs_batch_1',
      worldId: 'village-1',
      cycleId: 'cycle-1',
      observations: [],
      createdAt: '2026-01-01T00:00:00Z',
      version: 1,
    });
    expect(withCycle.success).toBe(true);

    const withoutCycle = ObservationBatchSchema.safeParse({
      id: 'obs_batch_1',
      worldId: 'village-1',
      observations: [],
      createdAt: '2026-01-01T00:00:00Z',
      version: 1,
    });
    expect(withoutCycle.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State diff source tests
// ---------------------------------------------------------------------------

describe('observeFromStateDiff', () => {
  it('returns empty array for identical states', () => {
    const state = makeWorldState();
    const result = observeFromStateDiff(state, state);
    expect(result).toEqual([]);
  });

  it('detects chief additions', () => {
    const before = makeWorldState({ chiefs: [] });
    const after = makeWorldState({ chiefs: [makeChief()] });
    const result = observeFromStateDiff(before, after);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const chiefObs = result.find(o => o.scope === 'chief');
    expect(chiefObs).toBeDefined();
    expect(chiefObs?.importance).toBe('high');
    expect(chiefObs?.source).toBe('state_diff');
    expect(chiefObs?.targetIds).toContain('chief-1');
  });

  it('detects law changes', () => {
    const before = makeWorldState({ active_laws: [] });
    const after = makeWorldState({ active_laws: [makeLaw()] });
    const result = observeFromStateDiff(before, after);

    const lawObs = result.find(o => o.scope === 'law');
    expect(lawObs).toBeDefined();
    expect(lawObs?.importance).toBe('medium');
    expect(lawObs?.summary).toContain('Law changes');
  });

  it('detects constitution changes', () => {
    const before = makeWorldState({ constitution: null });
    const after = makeWorldState({ constitution: makeConstitution() });
    const result = observeFromStateDiff(before, after);

    const constObs = result.find(o => o.summary.includes('Constitution'));
    expect(constObs).toBeDefined();
    expect(constObs?.importance).toBe('high');
  });

  it('all observations pass Zod validation', () => {
    const before = makeWorldState({ chiefs: [], active_laws: [] });
    const after = makeWorldState();
    const result = observeFromStateDiff(before, after);

    for (const obs of result) {
      const parsed = ObservationSchema.safeParse(obs);
      expect(parsed.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit log source tests
// ---------------------------------------------------------------------------

describe('observeFromAuditLog', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns empty array when no audit entries', () => {
    const result = observeFromAuditLog(db, 'village-1');
    expect(result).toEqual([]);
  });

  it('converts audit log entries to observations', () => {
    const now = new Date().toISOString();
    insertAuditLogEntry(db, {
      entity_type: 'chief',
      entity_id: 'chief-1',
      action: 'create',
      payload: JSON.stringify({ name: 'Alpha' }),
      actor: 'human',
      created_at: now,
    });

    // sinceTimestamp = 過去一小時，確保能抓到
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const result = observeFromAuditLog(db, 'village-1', since);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('audit_log');
    expect(result[0].scope).toBe('chief');
    expect(result[0].summary).toContain('chief.create');
    expect(result[0].targetIds).toContain('chief-1');
  });

  it('infers importance from action', () => {
    const now = new Date().toISOString();
    insertAuditLogEntry(db, {
      entity_type: 'constitution',
      entity_id: 'const-1',
      action: 'revoke',
      payload: '{}',
      actor: 'human',
      created_at: now,
    });

    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const result = observeFromAuditLog(db, 'village-1', since);

    expect(result[0].importance).toBe('high');
  });

  it('all observations pass Zod validation', () => {
    const now = new Date().toISOString();
    insertAuditLogEntry(db, {
      entity_type: 'law',
      entity_id: 'law-1',
      action: 'create',
      payload: JSON.stringify({ category: 'testing' }),
      actor: 'chief-1',
      created_at: now,
    });

    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const result = observeFromAuditLog(db, 'village-1', since);

    for (const obs of result) {
      expect(ObservationSchema.safeParse(obs).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// External source tests
// ---------------------------------------------------------------------------

describe('observeFromExternal', () => {
  it('returns empty array for empty events', () => {
    const result = observeFromExternal([]);
    expect(result).toEqual([]);
  });

  it('converts external events to observations', () => {
    const events: ExternalEvent[] = [
      {
        id: 'ext-1',
        type: 'karvi.webhook',
        timestamp: '2026-01-01T00:00:00Z',
        data: { status: 'completed' },
      },
    ];

    const result = observeFromExternal(events);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('obs_ext_ext-1');
    expect(result[0].source).toBe('external');
    expect(result[0].summary).toBe('External: karvi.webhook');
    expect(result[0].details).toEqual({ status: 'completed' });
  });

  it('all observations pass Zod validation', () => {
    const events: ExternalEvent[] = [
      { id: 'e1', type: 'timer.tick', timestamp: '2026-01-01T00:00:00Z', data: {} },
      { id: 'e2', type: 'human.action', timestamp: '2026-01-01T00:01:00Z', data: { action: 'approve' } },
    ];

    const result = observeFromExternal(events);
    for (const obs of result) {
      expect(ObservationSchema.safeParse(obs).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildObservationBatch integration tests
// ---------------------------------------------------------------------------

describe('buildObservationBatch', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('builds batch from state diff only (no previous = no diff obs)', () => {
    const batch = buildObservationBatch({
      db,
      worldId: 'village-1',
      previousState: null,
      currentState: makeWorldState(),
      sinceTimestamp: new Date(Date.now() + 60_000).toISOString(), // 未來，確保 audit log 為空
    });

    expect(batch.worldId).toBe('village-1');
    expect(batch.observations).toHaveLength(0);
    expect(batch.version).toBe(1);
    expect(batch.id).toMatch(/^obs_batch_/);
    expect(ObservationBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('builds batch with state diff observations', () => {
    const before = makeWorldState({ chiefs: [] });
    const after = makeWorldState({ chiefs: [makeChief()] });

    const batch = buildObservationBatch({
      db,
      worldId: 'village-1',
      previousState: before,
      currentState: after,
      sinceTimestamp: new Date(Date.now() + 60_000).toISOString(),
    });

    const diffObs = batch.observations.filter(o => o.source === 'state_diff');
    expect(diffObs.length).toBeGreaterThanOrEqual(1);
    expect(ObservationBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('builds batch with audit log observations', () => {
    const now = new Date().toISOString();
    insertAuditLogEntry(db, {
      entity_type: 'village',
      entity_id: 'village-1',
      action: 'create',
      payload: '{}',
      actor: 'system',
      created_at: now,
    });

    const batch = buildObservationBatch({
      db,
      worldId: 'village-1',
      previousState: null,
      currentState: makeWorldState(),
      sinceTimestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    const auditObs = batch.observations.filter(o => o.source === 'audit_log');
    expect(auditObs.length).toBeGreaterThanOrEqual(1);
    expect(ObservationBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('builds batch with external events', () => {
    const events: ExternalEvent[] = [
      { id: 'ext-1', type: 'karvi.task_done', timestamp: '2026-01-01T00:00:00Z', data: { task: 'deploy' } },
    ];

    const batch = buildObservationBatch({
      db,
      worldId: 'village-1',
      previousState: null,
      currentState: makeWorldState(),
      externalEvents: events,
      sinceTimestamp: new Date(Date.now() + 60_000).toISOString(),
    });

    const extObs = batch.observations.filter(o => o.source === 'external');
    expect(extObs).toHaveLength(1);
    expect(ObservationBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('aggregates observations from all sources', () => {
    const now = new Date().toISOString();
    insertAuditLogEntry(db, {
      entity_type: 'law',
      entity_id: 'law-1',
      action: 'create',
      payload: '{}',
      actor: 'chief-1',
      created_at: now,
    });

    const before = makeWorldState({ chiefs: [] });
    const after = makeWorldState({ chiefs: [makeChief()] });
    const events: ExternalEvent[] = [
      { id: 'ext-1', type: 'timer.tick', timestamp: now, data: {} },
    ];

    const batch = buildObservationBatch({
      db,
      worldId: 'village-1',
      previousState: before,
      currentState: after,
      externalEvents: events,
      sinceTimestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    const sources = new Set(batch.observations.map(o => o.source));
    expect(sources.has('state_diff')).toBe(true);
    expect(sources.has('audit_log')).toBe(true);
    expect(sources.has('external')).toBe(true);
    expect(ObservationBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('empty sources produce empty observations array', () => {
    const state = makeWorldState();
    const batch = buildObservationBatch({
      db,
      worldId: 'village-1',
      previousState: state,
      currentState: state,
      sinceTimestamp: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(batch.observations).toHaveLength(0);
    expect(ObservationBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('batch passes full Zod validation with all fields', () => {
    const batch = buildObservationBatch({
      db,
      worldId: 'village-1',
      previousState: null,
      currentState: makeWorldState(),
      sinceTimestamp: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = ObservationBatchSchema.safeParse(batch);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toMatch(/^obs_batch_/);
      expect(result.data.worldId).toBe('village-1');
      expect(result.data.version).toBe(1);
      expect(typeof result.data.createdAt).toBe('string');
    }
  });
});
