import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { ZoneManager } from './zones';
import { StallManager } from './stalls';

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
  const zone = zones.create('village-1', { name: 'Main', type: 'main_street', capacity: 100 }, 'admin');

  return { db, stalls: new StallManager(db), zoneId: zone.id };
}

describe('StallManager', () => {
  let db: Database;
  let stalls: StallManager;
  let zoneId: string;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    stalls = s.stalls;
    zoneId = s.zoneId;
  });

  describe('create', () => {
    it('should create a stall with correct defaults', () => {
      const stall = stalls.create('village-1', { zone_id: zoneId, name: 'Tea Shop' }, 'admin');
      expect(stall.id).toMatch(/^stall-/);
      expect(stall.zone_id).toBe(zoneId);
      expect(stall.name).toBe('Tea Shop');
      expect(stall.rank).toBe(0);
      expect(stall.status).toBe('active');
      expect(stall.metadata).toEqual({});
      expect(stall.version).toBe(1);
    });

    it('should create stall with owner and category', () => {
      const stall = stalls.create('village-1', {
        zone_id: zoneId, name: 'Craft', owner: 'alice', category: 'handmade',
      }, 'admin');
      expect(stall.owner).toBe('alice');
      expect(stall.category).toBe('handmade');
    });

    it('should store metadata', () => {
      const stall = stalls.create('village-1', {
        zone_id: zoneId, name: 'Food', metadata: { menu: ['ramen', 'gyoza'] },
      }, 'admin');
      expect(stall.metadata).toEqual({ menu: ['ramen', 'gyoza'] });
    });

    it('should write audit log', () => {
      const stall = stalls.create('village-1', { zone_id: zoneId, name: 'S' }, 'admin');
      const audit = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(stall.id) as Record<string, unknown>;
      expect(audit.action).toBe('create');
    });
  });

  describe('get', () => {
    it('should return stall by id', () => {
      const created = stalls.create('village-1', { zone_id: zoneId, name: 'X' }, 'admin');
      const found = stalls.get(created.id);
      expect(found?.name).toBe('X');
    });

    it('should return null for unknown id', () => {
      expect(stalls.get('stall-nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('should list stalls for a village', () => {
      stalls.create('village-1', { zone_id: zoneId, name: 'A' }, 'admin');
      stalls.create('village-1', { zone_id: zoneId, name: 'B' }, 'admin');
      expect(stalls.list('village-1')).toHaveLength(2);
    });

    it('should filter by zone_id', () => {
      stalls.create('village-1', { zone_id: zoneId, name: 'A' }, 'admin');
      const list = stalls.list('village-1', { zone_id: zoneId });
      expect(list).toHaveLength(1);
    });

    it('should filter by status', () => {
      const s = stalls.create('village-1', { zone_id: zoneId, name: 'A' }, 'admin');
      stalls.close(s.id, 'admin');
      expect(stalls.list('village-1', { status: 'closed' })).toHaveLength(1);
      expect(stalls.list('village-1', { status: 'active' })).toHaveLength(0);
    });

    it('should sort by rank when requested', () => {
      const a = stalls.create('village-1', { zone_id: zoneId, name: 'A' }, 'admin');
      stalls.create('village-1', { zone_id: zoneId, name: 'B' }, 'admin');
      stalls.updateRank(a.id, 10, 'admin');
      const sorted = stalls.list('village-1', { sort_by: 'rank' });
      expect(sorted[0].name).toBe('A');
      expect(sorted[0].rank).toBe(10);
    });
  });

  describe('update', () => {
    it('should update stall and bump version', () => {
      const s = stalls.create('village-1', { zone_id: zoneId, name: 'Old' }, 'admin');
      const updated = stalls.update(s.id, { name: 'New' }, 'admin');
      expect(updated.name).toBe('New');
      expect(updated.version).toBe(2);
    });

    it('should throw on unknown stall', () => {
      expect(() => stalls.update('stall-nope', { name: 'X' }, 'admin')).toThrow('Stall not found');
    });
  });

  describe('updateRank', () => {
    it('should adjust rank by delta', () => {
      const s = stalls.create('village-1', { zone_id: zoneId, name: 'S' }, 'admin');
      expect(s.rank).toBe(0);
      const up = stalls.updateRank(s.id, 5, 'admin');
      expect(up.rank).toBe(5);
      const down = stalls.updateRank(s.id, -3, 'admin');
      expect(down.rank).toBe(2);
    });
  });

  describe('spotlight', () => {
    it('should set status to spotlight', () => {
      const s = stalls.create('village-1', { zone_id: zoneId, name: 'S' }, 'admin');
      const lit = stalls.spotlight(s.id, 'admin');
      expect(lit.status).toBe('spotlight');
    });
  });

  describe('close', () => {
    it('should set status to closed', () => {
      const s = stalls.create('village-1', { zone_id: zoneId, name: 'S' }, 'admin');
      const closed = stalls.close(s.id, 'admin');
      expect(closed.status).toBe('closed');
    });
  });
});
