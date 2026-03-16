import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { SkillRegistry } from './skill-registry';
import { StaleDetector } from './stale-detector';
import type { EddaBridge } from './edda-bridge';
import type { KarviBridge } from './karvi-bridge';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  const sr = new SkillRegistry(db);
  const ce = new ChiefEngine(db, cs, sr);
  return { db, vm, cs, ce, sr };
}

function createVillageWithConstitution(vm: VillageManager, cs: ConstitutionStore) {
  const village = vm.create({ name: 'Test Village', target_repo: 'test/repo' }, 'test-actor');
  cs.create(village.id, {
    rules: [{ id: 'r1', description: 'test rule', enforcement: 'hard' as const }],
    allowed_permissions: ['dispatch_task', 'enact_law_low'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'test-actor');
  return village;
}

function createActiveChief(ce: ChiefEngine, villageId: string, name = 'TestChief') {
  return ce.create(villageId, {
    name,
    role: 'event coordinator',
    permissions: ['dispatch_task'],
    skills: [],
  }, 'test-actor');
}

/** Simulate a chief that has been running and its heartbeat expired */
function simulateStaleChief(db: Database, chiefId: string, minutesAgo: number) {
  const staleTime = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  db.prepare(
    "UPDATE chiefs SET current_run_status = 'running', current_run_id = 'run-stale-123', last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
  ).run(staleTime, staleTime, chiefId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StaleDetector', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
    ce = s.ce;
  });

  // -----------------------------------------------------------------------
  // 1. No stale chiefs -> empty result
  // -----------------------------------------------------------------------
  it('returns empty result when no stale chiefs exist', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id);

    const detector = new StaleDetector({ db, chiefEngine: ce });
    const result = await detector.cleanup();

    expect(result.timed_out).toHaveLength(0);
    expect(result.auto_paused).toHaveLength(0);
    expect(result.karvi_cancelled).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 2. Detects stale running chief (heartbeat expired)
  // -----------------------------------------------------------------------
  it('detects stale running chief and marks timeout', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);

    // Simulate: chief running with heartbeat 3 minutes ago (> 2 min threshold)
    simulateStaleChief(db, chief.id, 3);

    const detector = new StaleDetector({ db, chiefEngine: ce });
    const result = await detector.cleanup();

    expect(result.timed_out).toContain(chief.id);

    // Chief should be back to idle (single timeout, below auto-pause threshold)
    const updated = ce.get(chief.id);
    expect(updated).not.toBeNull();
    expect(updated!.current_run_status).toBe('idle');
    expect(updated!.timeout_count).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 3. Idle chiefs are not affected
  // -----------------------------------------------------------------------
  it('does not affect idle chiefs', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);
    // Chief is idle (default state)

    const detector = new StaleDetector({ db, chiefEngine: ce });
    const result = await detector.cleanup();

    expect(result.timed_out).toHaveLength(0);
    const unchanged = ce.get(chief.id);
    expect(unchanged!.current_run_status).toBe('idle');
    expect(unchanged!.timeout_count).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 4. Running chief within timeout is not stale
  // -----------------------------------------------------------------------
  it('does not timeout chief with recent heartbeat', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);

    // Simulate: chief running with heartbeat 30 seconds ago (< 2 min threshold)
    const recentTime = new Date(Date.now() - 30 * 1000).toISOString();
    db.prepare(
      "UPDATE chiefs SET current_run_status = 'running', current_run_id = 'run-ok', last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
    ).run(recentTime, recentTime, chief.id);

    const detector = new StaleDetector({ db, chiefEngine: ce });
    const result = await detector.cleanup();

    expect(result.timed_out).toHaveLength(0);
    const unchanged = ce.get(chief.id);
    expect(unchanged!.current_run_status).toBe('running');
  });

  // -----------------------------------------------------------------------
  // 5. Auto-pause after consecutive timeouts
  // -----------------------------------------------------------------------
  it('auto-pauses chief after 3 consecutive timeouts', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);

    // Set timeout_count to 2 (next timeout will be #3 -> auto-pause)
    db.prepare("UPDATE chiefs SET timeout_count = 2 WHERE id = ?").run(chief.id);
    simulateStaleChief(db, chief.id, 3);

    const detector = new StaleDetector({ db, chiefEngine: ce, autoPauseThreshold: 3 });
    const result = await detector.cleanup();

    expect(result.timed_out).toContain(chief.id);
    expect(result.auto_paused).toContain(chief.id);

    const paused = ce.get(chief.id);
    expect(paused).not.toBeNull();
    expect(paused!.status).toBe('paused');
    expect(paused!.pause_reason).toContain('CONSECUTIVE_HEARTBEAT_TIMEOUT');
  });

  // -----------------------------------------------------------------------
  // 6. Timeout count resets on markIdle (successful execution)
  // -----------------------------------------------------------------------
  it('resets timeout_count when markIdle is called', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);

    // Accumulate some timeouts
    db.prepare("UPDATE chiefs SET timeout_count = 2 WHERE id = ?").run(chief.id);

    // Simulate successful execution -> markIdle
    ce.markIdle(chief.id);

    const reset = ce.get(chief.id);
    expect(reset!.timeout_count).toBe(0);
    expect(reset!.current_run_status).toBe('idle');
  });

  // -----------------------------------------------------------------------
  // 7. Cancels Karvi task for stale chief
  // -----------------------------------------------------------------------
  it('cancels Karvi task for stale chief with run_id', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);
    simulateStaleChief(db, chief.id, 3);

    const cancelledTasks: string[] = [];
    const mockKarvi = {
      cancelTask: async (taskId: string) => {
        cancelledTasks.push(taskId);
        return true;
      },
    } as unknown as KarviBridge;

    const detector = new StaleDetector({ db, chiefEngine: ce, karviBridge: mockKarvi });
    const result = await detector.cleanup();

    expect(result.karvi_cancelled).toContain('run-stale-123');
    expect(cancelledTasks).toContain('run-stale-123');
  });

  // -----------------------------------------------------------------------
  // 8. Records timeout to Edda
  // -----------------------------------------------------------------------
  it('records timeout event to Edda', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);
    simulateStaleChief(db, chief.id, 3);

    const eddaRecords: unknown[] = [];
    const mockEdda = {
      recordDecision: async (input: unknown) => {
        eddaRecords.push(input);
        return { event_id: 'edda-123', domain: 'chief', aspect: 'timeout', value: 'test' };
      },
    } as unknown as EddaBridge;

    const detector = new StaleDetector({ db, chiefEngine: ce, eddaBridge: mockEdda });
    await detector.cleanup();

    expect(eddaRecords).toHaveLength(1);
    const record = eddaRecords[0] as Record<string, unknown>;
    expect(record.domain).toBe('chief');
    expect(record.aspect).toBe('timeout');
  });

  // -----------------------------------------------------------------------
  // 9. Audit log entries for timeout
  // -----------------------------------------------------------------------
  it('writes audit_log for timeout detection', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);
    simulateStaleChief(db, chief.id, 3);

    const detector = new StaleDetector({ db, chiefEngine: ce });
    await detector.cleanup();

    const auditRow = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'chief' AND entity_id = ? AND action = 'timeout_detected'"
    ).get(chief.id) as Record<string, unknown> | null;

    expect(auditRow).not.toBeNull();
    expect(auditRow!.actor).toBe('stale-detector');
    const payload = JSON.parse(auditRow!.payload as string) as Record<string, unknown>;
    expect(payload.timeout_count).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 10. Configurable timeout threshold
  // -----------------------------------------------------------------------
  it('respects custom heartbeat timeout threshold', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);

    // Heartbeat 90 seconds ago
    const time = new Date(Date.now() - 90 * 1000).toISOString();
    db.prepare(
      "UPDATE chiefs SET current_run_status = 'running', current_run_id = 'run-1', last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
    ).run(time, time, chief.id);

    // Default 2min threshold: NOT stale
    const detector1 = new StaleDetector({ db, chiefEngine: ce });
    const result1 = await detector1.cleanup();
    expect(result1.timed_out).toHaveLength(0);

    // Custom 1min threshold: IS stale
    const detector2 = new StaleDetector({ db, chiefEngine: ce, heartbeatTimeoutMs: 60 * 1000 });
    const result2 = await detector2.cleanup();
    expect(result2.timed_out).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 11. Paused chiefs are excluded from stale detection
  // -----------------------------------------------------------------------
  it('does not detect paused chiefs as stale', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);

    // Simulate stale AND paused
    simulateStaleChief(db, chief.id, 5);
    ce.pauseChief(chief.id, 'manual-pause');

    const detector = new StaleDetector({ db, chiefEngine: ce });
    const result = await detector.cleanup();

    expect(result.timed_out).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 12. markRunning and updateHeartbeat work correctly
  // -----------------------------------------------------------------------
  it('markRunning sets run status and heartbeat', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);

    ce.markRunning(chief.id, 'run-xyz');

    const updated = ce.get(chief.id);
    expect(updated!.current_run_status).toBe('running');
    expect(updated!.current_run_id).toBe('run-xyz');
    expect(updated!.last_heartbeat_at).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // 13. Karvi cancel failure does not crash cleanup
  // -----------------------------------------------------------------------
  it('handles Karvi cancel failure gracefully', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id);
    simulateStaleChief(db, chief.id, 3);

    const mockKarvi = {
      cancelTask: async () => { throw new Error('Karvi offline'); },
    } as unknown as KarviBridge;

    const detector = new StaleDetector({ db, chiefEngine: ce, karviBridge: mockKarvi });
    const result = await detector.cleanup();

    // Should still complete without crashing
    expect(result.timed_out).toContain(chief.id);
    expect(result.karvi_cancelled).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 14. Multiple stale chiefs in one cleanup
  // -----------------------------------------------------------------------
  it('handles multiple stale chiefs in one pass', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief1 = createActiveChief(ce, village.id, 'StaleChief1');
    const chief2 = createActiveChief(ce, village.id, 'StaleChief2');

    simulateStaleChief(db, chief1.id, 5);
    simulateStaleChief(db, chief2.id, 4);

    const detector = new StaleDetector({ db, chiefEngine: ce });
    const result = await detector.cleanup();

    expect(result.timed_out).toHaveLength(2);
    expect(result.timed_out).toContain(chief1.id);
    expect(result.timed_out).toContain(chief2.id);
  });
});
