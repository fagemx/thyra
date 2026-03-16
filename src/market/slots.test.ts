import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { ZoneManager } from './zones';
import { SlotManager } from './slots';

function setup() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('village-1', 'Test Village', '', 'repo', 'active', '{}', 1, now, now);

  const zones = new ZoneManager(db);
  const zone = zones.create('village-1', { name: 'Stage', type: 'stage', capacity: 200 }, 'admin');

  return { db, slots: new SlotManager(db), zoneId: zone.id };
}

describe('SlotManager', () => {
  let db: Database;
  let slots: SlotManager;
  let zoneId: string;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    slots = s.slots;
    zoneId = s.zoneId;
  });

  describe('create', () => {
    it('should create a slot with correct defaults', () => {
      const slot = slots.create('village-1', {
        title: 'Opening Show',
        start_time: '2026-03-16T20:00:00Z',
        end_time: '2026-03-16T21:00:00Z',
        capacity: 50,
      }, 'admin');
      expect(slot.id).toMatch(/^slot-/);
      expect(slot.title).toBe('Opening Show');
      expect(slot.booked).toBe(0);
      expect(slot.status).toBe('open');
      expect(slot.capacity).toBe(50);
      expect(slot.zone_id).toBeNull();
      expect(slot.description).toBe('');
    });

    it('should create slot with zone_id', () => {
      const slot = slots.create('village-1', {
        zone_id: zoneId,
        title: 'Band',
        start_time: '2026-03-16T22:00:00Z',
        end_time: '2026-03-16T23:00:00Z',
      }, 'admin');
      expect(slot.zone_id).toBe(zoneId);
      expect(slot.capacity).toBeNull();
    });

    it('should write audit log', () => {
      const slot = slots.create('village-1', {
        title: 'S', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z',
      }, 'admin');
      const audit = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(slot.id) as Record<string, unknown>;
      expect(audit.action).toBe('create');
      expect(audit.entity_type).toBe('event_slot');
    });
  });

  describe('get', () => {
    it('should return slot by id', () => {
      const created = slots.create('village-1', {
        title: 'X', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z',
      }, 'admin');
      const found = slots.get(created.id);
      expect(found?.title).toBe('X');
    });

    it('should return null for unknown id', () => {
      expect(slots.get('slot-nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('should list slots for a village', () => {
      slots.create('village-1', { title: 'A', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z' }, 'admin');
      slots.create('village-1', { title: 'B', start_time: '2026-03-16T22:00:00Z', end_time: '2026-03-16T23:00:00Z' }, 'admin');
      expect(slots.list('village-1')).toHaveLength(2);
    });

    it('should filter by status', () => {
      const s = slots.create('village-1', { title: 'A', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z' }, 'admin');
      slots.end(s.id, 'admin');
      expect(slots.list('village-1', { status: 'ended' })).toHaveLength(1);
      expect(slots.list('village-1', { status: 'open' })).toHaveLength(0);
    });

    it('should filter by zone_id', () => {
      slots.create('village-1', { zone_id: zoneId, title: 'A', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z' }, 'admin');
      slots.create('village-1', { title: 'B', start_time: '2026-03-16T22:00:00Z', end_time: '2026-03-16T23:00:00Z' }, 'admin');
      expect(slots.list('village-1', { zone_id: zoneId })).toHaveLength(1);
    });
  });

  describe('book', () => {
    it('should increment booked count', () => {
      const slot = slots.create('village-1', {
        title: 'Show', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z', capacity: 3,
      }, 'admin');
      const booked = slots.book(slot.id, 'village-1', 'user-1', 'admin');
      expect(booked.booked).toBe(1);
      expect(booked.status).toBe('open');
    });

    it('should set status to full when capacity reached', () => {
      const slot = slots.create('village-1', {
        title: 'Show', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z', capacity: 2,
      }, 'admin');
      slots.book(slot.id, 'village-1', 'user-1', 'admin');
      const full = slots.book(slot.id, 'village-1', 'user-2', 'admin');
      expect(full.booked).toBe(2);
      expect(full.status).toBe('full');
    });

    it('should throw when slot is full', () => {
      const slot = slots.create('village-1', {
        title: 'Show', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z', capacity: 1,
      }, 'admin');
      slots.book(slot.id, 'village-1', 'user-1', 'admin');
      expect(() => slots.book(slot.id, 'village-1', 'user-2', 'admin')).toThrow('Slot is full');
    });

    it('should throw when slot has ended', () => {
      const slot = slots.create('village-1', {
        title: 'Show', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z',
      }, 'admin');
      slots.end(slot.id, 'admin');
      expect(() => slots.book(slot.id, 'village-1', 'user-1', 'admin')).toThrow('Slot has ended');
    });

    it('should create a booking order', () => {
      const slot = slots.create('village-1', {
        title: 'Show', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z', capacity: 10,
      }, 'admin');
      slots.book(slot.id, 'village-1', 'buyer-1', 'admin');
      const order = db.prepare("SELECT * FROM orders WHERE slot_id = ? AND type = 'booking'").get(slot.id) as Record<string, unknown>;
      expect(order).not.toBeNull();
      expect(order.buyer).toBe('buyer-1');
      expect(order.status).toBe('confirmed');
    });

    it('should allow unlimited bookings when capacity is null', () => {
      const slot = slots.create('village-1', {
        title: 'Open', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z',
      }, 'admin');
      slots.book(slot.id, 'village-1', 'user-1', 'admin');
      slots.book(slot.id, 'village-1', 'user-2', 'admin');
      const updated = slots.get(slot.id);
      expect(updated?.booked).toBe(2);
      expect(updated?.status).toBe('open');
    });
  });

  describe('update', () => {
    it('should update slot title', () => {
      const slot = slots.create('village-1', {
        title: 'Old', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z',
      }, 'admin');
      const updated = slots.update(slot.id, { title: 'New' }, 'admin');
      expect(updated.title).toBe('New');
      expect(updated.version).toBe(2);
    });

    it('should throw on unknown slot', () => {
      expect(() => slots.update('slot-nope', { title: 'X' }, 'admin')).toThrow('EventSlot not found');
    });
  });

  describe('end', () => {
    it('should set status to ended', () => {
      const slot = slots.create('village-1', {
        title: 'S', start_time: '2026-03-16T20:00:00Z', end_time: '2026-03-16T21:00:00Z',
      }, 'admin');
      const ended = slots.end(slot.id, 'admin');
      expect(ended.status).toBe('ended');
    });
  });
});
