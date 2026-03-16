import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { CycleTelemetryCollector, TelemetrySession } from './cycle-telemetry';
import type { CycleTelemetry } from './schemas/cycle-telemetry';

function setupDb(): Database {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

describe('TelemetrySession', () => {
  it('begin/start/end/finish produces valid CycleTelemetry', () => {
    const session = CycleTelemetryCollector.begin('cycle-1', 'chief-1', 'village-1');

    session.start('get_state');
    session.end('get_state', 'ok');

    session.start('decide');
    session.end('decide', 'ok', { model: 'rule-based' });

    const telemetry = session.finish();

    expect(telemetry.id).toMatch(/^tel-/);
    expect(telemetry.cycle_id).toBe('cycle-1');
    expect(telemetry.chief_id).toBe('chief-1');
    expect(telemetry.village_id).toBe('village-1');
    expect(telemetry.total_duration_ms).toBeGreaterThanOrEqual(0);
    expect(telemetry.operations).toHaveLength(2);
    expect(telemetry.operations[0].name).toBe('get_state');
    expect(telemetry.operations[0].status).toBe('ok');
    expect(telemetry.operations[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(telemetry.operations[1].name).toBe('decide');
    expect(telemetry.operations[1].metadata?.model).toBe('rule-based');
    expect(telemetry.created_at).toBeTruthy();
  });

  it('records error status with error metadata', () => {
    const session = new TelemetrySession('cycle-2', 'chief-2', 'village-2');

    session.start('decide');
    session.end('decide', 'error', { error: 'LLM timeout' });

    const telemetry = session.finish();
    expect(telemetry.operations[0].status).toBe('error');
    expect(telemetry.operations[0].metadata?.error).toBe('LLM timeout');
  });

  it('records skipped operations', () => {
    const session = CycleTelemetryCollector.begin('cycle-3', 'chief-3', 'village-3');

    session.start('dispatch_pipeline');
    session.end('dispatch_pipeline', 'skipped', { detail: 'no_karvi_bridge' });

    const telemetry = session.finish();
    expect(telemetry.operations[0].status).toBe('skipped');
    expect(telemetry.operations[0].metadata?.detail).toBe('no_karvi_bridge');
  });

  it('handles end without start gracefully (duration_ms = 0)', () => {
    const session = CycleTelemetryCollector.begin('cycle-4', 'chief-4', 'village-4');

    // end without matching start
    session.end('apply', 'ok');

    const telemetry = session.finish();
    expect(telemetry.operations[0].duration_ms).toBe(0);
  });
});

describe('CycleTelemetryCollector', () => {
  let db: Database;

  beforeEach(() => {
    db = setupDb();
  });

  // -------------------------------------------------------------------------
  // save + list roundtrip
  // -------------------------------------------------------------------------
  it('save and list roundtrip', () => {
    const session = CycleTelemetryCollector.begin('cycle-10', 'chief-10', 'village-10');
    session.start('get_state');
    session.end('get_state', 'ok');
    session.start('decide');
    session.end('decide', 'ok');
    const telemetry = session.finish();

    CycleTelemetryCollector.save(db, telemetry);

    const results = CycleTelemetryCollector.list(db, 'village-10');
    expect(results).toHaveLength(1);
    expect(results[0].cycle_id).toBe('cycle-10');
    expect(results[0].chief_id).toBe('chief-10');
    expect(results[0].operations).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // list with chiefId filter
  // -------------------------------------------------------------------------
  it('list filters by chiefId', () => {
    saveTelemetry(db, 'cycle-20', 'chief-A', 'village-20');
    saveTelemetry(db, 'cycle-21', 'chief-B', 'village-20');

    const resultsA = CycleTelemetryCollector.list(db, 'village-20', { chiefId: 'chief-A' });
    expect(resultsA).toHaveLength(1);
    expect(resultsA[0].chief_id).toBe('chief-A');

    const all = CycleTelemetryCollector.list(db, 'village-20');
    expect(all).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // list respects limit
  // -------------------------------------------------------------------------
  it('list respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      saveTelemetry(db, `cycle-${30 + i}`, 'chief-30', 'village-30');
    }

    const results = CycleTelemetryCollector.list(db, 'village-30', { limit: 3 });
    expect(results).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // summarize: aggregation
  // -------------------------------------------------------------------------
  it('summarize computes correct aggregation', () => {
    saveTelemetryWithOps(db, 'cycle-40', 'chief-40', 'village-40', 100, [
      { name: 'get_state', duration_ms: 10, status: 'ok' },
      { name: 'decide', duration_ms: 80, status: 'ok', metadata: { cost_cents: 0.5 } },
      { name: 'apply', duration_ms: 10, status: 'ok' },
    ]);
    saveTelemetryWithOps(db, 'cycle-41', 'chief-40', 'village-40', 200, [
      { name: 'get_state', duration_ms: 20, status: 'ok' },
      { name: 'decide', duration_ms: 160, status: 'ok', metadata: { cost_cents: 1.0 } },
      { name: 'apply', duration_ms: 20, status: 'error', metadata: { error: 'judge rejected' } },
    ]);

    const summary = CycleTelemetryCollector.summarize(db, 'village-40', { windowHours: 1 });

    expect(summary.cycle_count).toBe(2);
    expect(summary.avg_duration_ms).toBe(150);
    expect(summary.max_duration_ms).toBe(200);
    expect(summary.total_cost_cents).toBeCloseTo(1.5);
    expect(summary.slowest_operation?.name).toBe('decide');
    expect(summary.operation_breakdown).toHaveLength(3);

    const applyBreakdown = summary.operation_breakdown.find(b => b.name === 'apply');
    expect(applyBreakdown?.error_rate).toBe(0.5);
  });

  // -------------------------------------------------------------------------
  // summarize: empty state returns zeros
  // -------------------------------------------------------------------------
  it('summarize returns zeros for empty village', () => {
    const summary = CycleTelemetryCollector.summarize(db, 'village-empty');
    expect(summary.cycle_count).toBe(0);
    expect(summary.avg_duration_ms).toBe(0);
    expect(summary.max_duration_ms).toBe(0);
    expect(summary.total_cost_cents).toBe(0);
    expect(summary.slowest_operation).toBeNull();
    expect(summary.operation_breakdown).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // summarize: window filtering
  // -------------------------------------------------------------------------
  it('summarize respects windowHours', () => {
    // Insert a telemetry entry with old created_at
    const oldDate = new Date(Date.now() - 48 * 3600_000).toISOString();
    db.prepare(`
      INSERT INTO cycle_telemetry (id, cycle_id, chief_id, village_id, total_duration_ms, operations, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('tel-old', 'cycle-old', 'chief-50', 'village-50', 100, '[]', oldDate);

    // Insert a recent one
    saveTelemetry(db, 'cycle-new', 'chief-50', 'village-50');

    const summary24h = CycleTelemetryCollector.summarize(db, 'village-50', { windowHours: 24 });
    expect(summary24h.cycle_count).toBe(1);

    const summary72h = CycleTelemetryCollector.summarize(db, 'village-50', { windowHours: 72 });
    expect(summary72h.cycle_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saveTelemetry(db: Database, cycleId: string, chiefId: string, villageId: string): void {
  const session = CycleTelemetryCollector.begin(cycleId, chiefId, villageId);
  session.start('get_state');
  session.end('get_state', 'ok');
  CycleTelemetryCollector.save(db, session.finish());
}

function saveTelemetryWithOps(
  db: Database,
  cycleId: string,
  chiefId: string,
  villageId: string,
  totalDurationMs: number,
  operations: { name: string; duration_ms: number; status: string; metadata?: Record<string, unknown> }[],
): void {
  const telemetry: CycleTelemetry = {
    id: `tel-${cycleId}`,
    cycle_id: cycleId,
    chief_id: chiefId,
    village_id: villageId,
    total_duration_ms: totalDurationMs,
    operations: operations as CycleTelemetry['operations'],
    created_at: new Date().toISOString(),
  };
  CycleTelemetryCollector.save(db, telemetry);
}
