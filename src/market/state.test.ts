import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { ZoneManager } from './zones';
import { StallManager } from './stalls';
import { SlotManager } from './slots';
import { assembleMarketState } from './state';
import { randomUUID } from 'crypto';

function setup() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('village-1', 'Test Village', '', 'repo', 'active', '{}', 1, now, now);

  return {
    db,
    zones: new ZoneManager(db),
    stalls: new StallManager(db),
    slots: new SlotManager(db),
  };
}

describe('assembleMarketState', () => {
  let db: Database;
  let zones: ZoneManager;
  let stalls: StallManager;
  let slots: SlotManager;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    zones = s.zones;
    stalls = s.stalls;
    slots = s.slots;
  });

  it('should throw if village not found', () => {
    expect(() => assembleMarketState(db, 'village-missing')).toThrow('Village not found');
  });

  it('should return empty market state for village with no data', () => {
    const state = assembleMarketState(db, 'village-1');
    expect(state.zones).toHaveLength(0);
    expect(state.stalls).toHaveLength(0);
    expect(state.event_slots).toHaveLength(0);
    expect(state.orders).toHaveLength(0);
    expect(state.metrics).toBeNull();
    expect(state.assembled_at).toBeTruthy();
  });

  it('should include zones in state', () => {
    zones.create('village-1', { name: 'Z1', type: 'main_street', capacity: 100 }, 'admin');
    zones.create('village-1', { name: 'Z2', type: 'stage', capacity: 50 }, 'admin');
    const state = assembleMarketState(db, 'village-1');
    expect(state.zones).toHaveLength(2);
  });

  it('should include stalls in state', () => {
    const zone = zones.create('village-1', { name: 'Z', type: 'main_street', capacity: 100 }, 'admin');
    stalls.create('village-1', { zone_id: zone.id, name: 'S1' }, 'admin');
    stalls.create('village-1', { zone_id: zone.id, name: 'S2' }, 'admin');
    const state = assembleMarketState(db, 'village-1');
    expect(state.stalls).toHaveLength(2);
  });

  it('should include event_slots in state', () => {
    slots.create('village-1', {
      title: 'Show', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z',
    }, 'admin');
    const state = assembleMarketState(db, 'village-1');
    expect(state.event_slots).toHaveLength(1);
  });

  it('should only include active orders (pending + confirmed)', () => {
    const zone = zones.create('village-1', { name: 'Z', type: 'main_street', capacity: 100 }, 'admin');
    const stall = stalls.create('village-1', { zone_id: zone.id, name: 'S' }, 'admin');

    const now = new Date().toISOString();
    // pending order
    db.prepare(`INSERT INTO orders (id, village_id, stall_id, slot_id, buyer, type, amount, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `order-${randomUUID()}`, 'village-1', stall.id, null, 'buyer-1', 'purchase', 10, 'pending', 1, now, now,
    );
    // confirmed order
    db.prepare(`INSERT INTO orders (id, village_id, stall_id, slot_id, buyer, type, amount, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `order-${randomUUID()}`, 'village-1', stall.id, null, 'buyer-2', 'purchase', 20, 'confirmed', 1, now, now,
    );
    // completed order (should be excluded)
    db.prepare(`INSERT INTO orders (id, village_id, stall_id, slot_id, buyer, type, amount, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `order-${randomUUID()}`, 'village-1', stall.id, null, 'buyer-3', 'purchase', 30, 'completed', 1, now, now,
    );

    const state = assembleMarketState(db, 'village-1');
    expect(state.orders).toHaveLength(2);
  });

  it('should include latest metrics snapshot', () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO market_metrics (id, village_id, timestamp, total_visitors, active_stalls, active_events, revenue, incidents, satisfaction, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `mmetric-${randomUUID()}`, 'village-1', '2026-03-16T20:00:00Z', 100, 10, 3, 500, 0, 0.85, '{}', now,
    );
    db.prepare(`INSERT INTO market_metrics (id, village_id, timestamp, total_visitors, active_stalls, active_events, revenue, incidents, satisfaction, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `mmetric-${randomUUID()}`, 'village-1', '2026-03-16T21:00:00Z', 150, 12, 4, 800, 1, 0.9, '{}', now,
    );

    const state = assembleMarketState(db, 'village-1');
    expect(state.metrics).not.toBeNull();
    expect(state.metrics?.total_visitors).toBe(150);
    expect(state.metrics?.timestamp).toBe('2026-03-16T21:00:00Z');
  });

  it('should assemble full market state with all entities', () => {
    const zone = zones.create('village-1', { name: 'Main', type: 'main_street', capacity: 100 }, 'admin');
    stalls.create('village-1', { zone_id: zone.id, name: 'Tea' }, 'admin');
    const slot = slots.create('village-1', {
      zone_id: zone.id, title: 'Dance', start_time: '2026-03-16T22:00:00Z', end_time: '2026-03-16T23:00:00Z', capacity: 10,
    }, 'admin');
    slots.book(slot.id, 'village-1', 'guest-1', 'admin');

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO market_metrics (id, village_id, timestamp, total_visitors, active_stalls, active_events, revenue, incidents, satisfaction, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `mmetric-${randomUUID()}`, 'village-1', now, 50, 1, 1, 100, 0, 0.8, '{}', now,
    );

    const state = assembleMarketState(db, 'village-1');
    expect(state.zones).toHaveLength(1);
    expect(state.stalls).toHaveLength(1);
    expect(state.event_slots).toHaveLength(1);
    expect(state.orders).toHaveLength(1); // booking order from slot.book
    expect(state.metrics).not.toBeNull();
    expect(state.assembled_at).toBeTruthy();
  });
});
