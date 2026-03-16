import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { ZoneManager } from './zones';

function setup() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);
  // 建立 village（FK 需要）
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('village-1', 'Test Village', '', 'repo', 'active', '{}', 1, now, now);
  return { db, zones: new ZoneManager(db) };
}

describe('ZoneManager', () => {
  let db: Database;
  let zones: ZoneManager;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    zones = s.zones;
  });

  describe('create', () => {
    it('should create a zone with correct defaults', () => {
      const zone = zones.create('village-1', { name: 'Main Street', type: 'main_street', capacity: 100 }, 'admin');
      expect(zone.id).toMatch(/^zone-/);
      expect(zone.village_id).toBe('village-1');
      expect(zone.name).toBe('Main Street');
      expect(zone.type).toBe('main_street');
      expect(zone.capacity).toBe(100);
      expect(zone.current_load).toBe(0);
      expect(zone.status).toBe('active');
      expect(zone.version).toBe(1);
    });

    it('should write audit log on create', () => {
      const zone = zones.create('village-1', { name: 'Stage', type: 'stage', capacity: 50 }, 'admin');
      const audit = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(zone.id) as Record<string, unknown>;
      expect(audit.action).toBe('create');
      expect(audit.entity_type).toBe('zone');
    });

    it('should reject invalid type', () => {
      expect(() =>
        zones.create('village-1', { name: 'Bad', type: 'invalid' as 'main_street', capacity: 10 }, 'admin'),
      ).toThrow();
    });
  });

  describe('get', () => {
    it('should return zone by id', () => {
      const created = zones.create('village-1', { name: 'Alley', type: 'side_alley', capacity: 30 }, 'admin');
      const found = zones.get(created.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Alley');
    });

    it('should return null for unknown id', () => {
      expect(zones.get('zone-nonexistent')).toBeNull();
    });
  });

  describe('list', () => {
    it('should list zones for a village', () => {
      zones.create('village-1', { name: 'A', type: 'main_street', capacity: 10 }, 'admin');
      zones.create('village-1', { name: 'B', type: 'stage', capacity: 20 }, 'admin');
      const list = zones.list('village-1');
      expect(list).toHaveLength(2);
    });

    it('should return empty for village with no zones', () => {
      expect(zones.list('village-1')).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update zone name and bump version', () => {
      const zone = zones.create('village-1', { name: 'Old', type: 'entrance', capacity: 40 }, 'admin');
      const updated = zones.update(zone.id, { name: 'New' }, 'admin');
      expect(updated.name).toBe('New');
      expect(updated.version).toBe(2);
    });

    it('should throw on unknown zone', () => {
      expect(() => zones.update('zone-nope', { name: 'X' }, 'admin')).toThrow('Zone not found');
    });

    it('should write audit log on update', () => {
      const zone = zones.create('village-1', { name: 'Z', type: 'stage', capacity: 10 }, 'admin');
      zones.update(zone.id, { capacity: 99 }, 'admin');
      const audits = db.prepare('SELECT * FROM audit_log WHERE entity_id = ? AND action = ?').all(zone.id, 'update') as Record<string, unknown>[];
      expect(audits).toHaveLength(1);
    });
  });

  describe('updateLoad', () => {
    it('should increment load', () => {
      const zone = zones.create('village-1', { name: 'Z', type: 'main_street', capacity: 100 }, 'admin');
      const updated = zones.updateLoad(zone.id, 5, 'system');
      expect(updated.current_load).toBe(5);
      expect(updated.version).toBe(2);
    });

    it('should decrement load but not below 0', () => {
      const zone = zones.create('village-1', { name: 'Z', type: 'main_street', capacity: 100 }, 'admin');
      const updated = zones.updateLoad(zone.id, -10, 'system');
      expect(updated.current_load).toBe(0);
    });

    it('should throw on unknown zone', () => {
      expect(() => zones.updateLoad('zone-nope', 1, 'admin')).toThrow('Zone not found');
    });
  });

  describe('close', () => {
    it('should set status to closed', () => {
      const zone = zones.create('village-1', { name: 'Z', type: 'stage', capacity: 50 }, 'admin');
      const closed = zones.close(zone.id, 'admin');
      expect(closed.status).toBe('closed');
    });
  });
});
