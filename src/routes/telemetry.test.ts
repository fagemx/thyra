import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { telemetryRoutes } from './telemetry';
import { CycleTelemetryCollector } from '../cycle-telemetry';
import type { CycleTelemetry, TelemetrySummary } from '../schemas/cycle-telemetry';

function setupDb(): Database {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function saveTelemetryWithOps(
  db: Database,
  cycleId: string,
  chiefId: string,
  villageId: string,
  totalDurationMs: number,
  operations: CycleTelemetry['operations'],
): void {
  const telemetry: CycleTelemetry = {
    id: `tel-${cycleId}`,
    cycle_id: cycleId,
    chief_id: chiefId,
    village_id: villageId,
    total_duration_ms: totalDurationMs,
    operations,
    created_at: new Date().toISOString(),
  };
  CycleTelemetryCollector.save(db, telemetry);
}

describe('telemetry routes', () => {
  let db: Database;
  let app: ReturnType<typeof telemetryRoutes>;

  beforeEach(() => {
    db = setupDb();
    app = telemetryRoutes(db);
  });

  // -------------------------------------------------------------------------
  // GET /api/villages/:id/telemetry
  // -------------------------------------------------------------------------
  it('GET /api/villages/:id/telemetry returns entries', async () => {
    saveTelemetryWithOps(db, 'cycle-1', 'chief-1', 'village-1', 100, [
      { name: 'get_state', duration_ms: 10, status: 'ok' },
      { name: 'decide', duration_ms: 90, status: 'ok' },
    ]);

    const res = await app.request('/api/villages/village-1/telemetry');
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; data: CycleTelemetry[] };
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].cycle_id).toBe('cycle-1');
    expect(body.data[0].operations).toHaveLength(2);
  });

  it('GET /api/villages/:id/telemetry with chief_id filter', async () => {
    saveTelemetryWithOps(db, 'cycle-2', 'chief-A', 'village-2', 50, []);
    saveTelemetryWithOps(db, 'cycle-3', 'chief-B', 'village-2', 60, []);

    const res = await app.request('/api/villages/village-2/telemetry?chief_id=chief-A');
    const body = await res.json() as { ok: boolean; data: CycleTelemetry[] };

    expect(body.data).toHaveLength(1);
    expect(body.data[0].chief_id).toBe('chief-A');
  });

  it('GET /api/villages/:id/telemetry with limit', async () => {
    for (let i = 0; i < 5; i++) {
      saveTelemetryWithOps(db, `cycle-${10 + i}`, 'chief-10', 'village-10', 100, []);
    }

    const res = await app.request('/api/villages/village-10/telemetry?limit=2');
    const body = await res.json() as { ok: boolean; data: CycleTelemetry[] };

    expect(body.data).toHaveLength(2);
  });

  it('GET /api/villages/:id/telemetry returns empty for unknown village', async () => {
    const res = await app.request('/api/villages/nonexistent/telemetry');
    const body = await res.json() as { ok: boolean; data: CycleTelemetry[] };

    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // GET /api/villages/:id/telemetry/summary
  // -------------------------------------------------------------------------
  it('GET /api/villages/:id/telemetry/summary computes correctly', async () => {
    saveTelemetryWithOps(db, 'cycle-20', 'chief-20', 'village-20', 100, [
      { name: 'get_state', duration_ms: 10, status: 'ok' },
      { name: 'decide', duration_ms: 80, status: 'ok', metadata: { cost_cents: 0.5 } },
      { name: 'apply', duration_ms: 10, status: 'ok' },
    ]);
    saveTelemetryWithOps(db, 'cycle-21', 'chief-20', 'village-20', 200, [
      { name: 'get_state', duration_ms: 20, status: 'ok' },
      { name: 'decide', duration_ms: 160, status: 'ok', metadata: { cost_cents: 1.0 } },
      { name: 'apply', duration_ms: 20, status: 'error', metadata: { error: 'rejected' } },
    ]);

    const res = await app.request('/api/villages/village-20/telemetry/summary');
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; data: TelemetrySummary };
    expect(body.ok).toBe(true);
    expect(body.data.cycle_count).toBe(2);
    expect(body.data.avg_duration_ms).toBe(150);
    expect(body.data.max_duration_ms).toBe(200);
    expect(body.data.total_cost_cents).toBeCloseTo(1.5);
    expect(body.data.slowest_operation?.name).toBe('decide');
    expect(body.data.operation_breakdown.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/villages/:id/telemetry/summary returns zeros for empty village', async () => {
    const res = await app.request('/api/villages/empty-village/telemetry/summary');
    const body = await res.json() as { ok: boolean; data: TelemetrySummary };

    expect(body.ok).toBe(true);
    expect(body.data.cycle_count).toBe(0);
    expect(body.data.avg_duration_ms).toBe(0);
    expect(body.data.slowest_operation).toBeNull();
  });
});
