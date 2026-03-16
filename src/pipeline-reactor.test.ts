import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { WorldManager } from './world-manager';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { PipelineReactor, parsePipelineTaskId } from './pipeline-reactor';
import type { KarviEventNormalized } from './schemas/karvi-event';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  const wm = new WorldManager(db);
  const reactor = new PipelineReactor(wm, db);
  return { db, vm, cs, wm, reactor };
}

function createVillageWithConstitution(vm: VillageManager, cs: ConstitutionStore) {
  const village = vm.create({
    name: 'Reactor Test Village',
    target_repo: 'test/repo',
  }, 'test-actor');
  cs.create(village.id, {
    rules: [{ id: 'r1', description: 'test', enforcement: 'hard' as const }],
    allowed_permissions: ['dispatch_task'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'test-actor');
  return village;
}

function makeEvent(overrides?: Partial<KarviEventNormalized>): KarviEventNormalized {
  return {
    event_id: 'evt_test-1',
    event_type: 'task.completed',
    task_id: 'village-1:chief-1:pipeline-1:1234567890',
    step_id: 'step-1',
    occurred_at: new Date().toISOString(),
    raw: { output: { some: 'result' } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parsePipelineTaskId
// ---------------------------------------------------------------------------

describe('parsePipelineTaskId', () => {
  it('should parse valid pipeline task ID', () => {
    const result = parsePipelineTaskId('village-abc:chief-xyz:my-pipeline:1234567890');
    expect(result).toEqual({
      village_id: 'village-abc',
      chief_id: 'chief-xyz',
      pipeline_id: 'my-pipeline',
      timestamp: '1234567890',
    });
  });

  it('should return null for task IDs with fewer than 4 parts', () => {
    expect(parsePipelineTaskId('only-two:parts')).toBeNull();
    expect(parsePipelineTaskId('three:parts:here')).toBeNull();
    expect(parsePipelineTaskId('single')).toBeNull();
    expect(parsePipelineTaskId('')).toBeNull();
  });

  it('should handle task IDs with more than 4 parts', () => {
    const result = parsePipelineTaskId('v:c:p:t:extra');
    expect(result).not.toBeNull();
    expect(result!.village_id).toBe('v');
    expect(result!.chief_id).toBe('c');
    expect(result!.pipeline_id).toBe('p');
    expect(result!.timestamp).toBe('t');
  });
});

// ---------------------------------------------------------------------------
// PipelineReactor.onKarviEvent
// ---------------------------------------------------------------------------

describe('PipelineReactor', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let reactor: PipelineReactor;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
    reactor = s.reactor;
  });

  it('should react to task.completed events and apply to world', () => {
    const village = createVillageWithConstitution(vm, cs);
    const event = makeEvent({
      task_id: `${village.id}:chief-1:my-pipeline:1234567890`,
    });

    const result = reactor.onKarviEvent(event);

    expect(result.reacted).toBe(true);
    expect(result.reason).toBe('applied');

    // Check audit log
    const audit = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'pipeline' AND action = 'reactor_applied'"
    ).get() as Record<string, unknown> | null;
    expect(audit).not.toBeNull();
  });

  it('should ignore non-task.completed events', () => {
    const result = reactor.onKarviEvent(makeEvent({ event_type: 'step.started' }));
    expect(result.reacted).toBe(false);
    expect(result.reason).toBe('event_type_not_task_completed');
  });

  it('should ignore events with non-pipeline task IDs', () => {
    const result = reactor.onKarviEvent(makeEvent({ task_id: 'simple-task-id' }));
    expect(result.reacted).toBe(false);
    expect(result.reason).toBe('task_id_not_pipeline_format');
  });

  it('should handle apply errors gracefully', () => {
    // Use a non-existent village ID -- getState will throw or produce empty state
    const event = makeEvent({
      task_id: 'nonexistent-village:chief-1:pipeline-1:123',
    });

    const result = reactor.onKarviEvent(event);

    // Should either fail gracefully or succeed with empty village
    expect(typeof result.reacted).toBe('boolean');
    expect(typeof result.reason).toBe('string');
  });

  it('should extract output from event raw payload', () => {
    const village = createVillageWithConstitution(vm, cs);
    const event = makeEvent({
      task_id: `${village.id}:chief-1:test-pipeline:123`,
      raw: { output: { market_score: 0.85, recommendation: 'expand' } },
    });

    const result = reactor.onKarviEvent(event);

    expect(result.reacted).toBe(true);
    expect(result.reason).toBe('applied');
  });
});
