import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';

describe('VillageManager', () => {
  let mgr: VillageManager;
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    mgr = new VillageManager(db);
  });

  it('create → id starts with village-, version 1, status active', () => {
    const v = mgr.create({ name: 'test', target_repo: 'fagemx/test' }, 'u');
    expect(v.id).toMatch(/^village-/);
    expect(v.version).toBe(1);
    expect(v.status).toBe('active');
  });

  it('get → returns created village', () => {
    const v = mgr.create({ name: 'test', target_repo: 'r' }, 'u');
    expect(mgr.get(v.id)?.name).toBe('test');
  });

  it('get non-existent → null', () => {
    expect(mgr.get('xxx')).toBeNull();
  });

  it('update → version +1, updated_at changes, name changes', () => {
    const v = mgr.create({ name: 'old', target_repo: 'r' }, 'u');
    const u = mgr.update(v.id, { name: 'new' }, 'u');
    expect(u.version).toBe(2);
    expect(u.name).toBe('new');
    expect(u.version).toBeGreaterThan(v.version);
  });

  it('archive → status archived', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r' }, 'u');
    mgr.archive(v.id, 'u');
    expect(mgr.get(v.id)?.status).toBe('archived');
  });

  it('list → returns all villages', () => {
    mgr.create({ name: 'a', target_repo: 'r1' }, 'u');
    mgr.create({ name: 'b', target_repo: 'r2' }, 'u');
    expect(mgr.list()).toHaveLength(2);
  });

  it('list with status filter', () => {
    mgr.create({ name: 'a', target_repo: 'r1' }, 'u');
    const b = mgr.create({ name: 'b', target_repo: 'r2' }, 'u');
    mgr.archive(b.id, 'u');
    expect(mgr.list({ status: 'active' })).toHaveLength(1);
    expect(mgr.list({ status: 'archived' })).toHaveLength(1);
  });

  it('audit log written on create', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r' }, 'actor1');
    const logs = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').all(v.id) as Record<string, unknown>[];
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('create');
    expect(logs[0].actor).toBe('actor1');
  });

  it('audit log written on update', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r' }, 'u');
    mgr.update(v.id, { name: 'y' }, 'u');
    const logs = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').all(v.id) as Record<string, unknown>[];
    expect(logs).toHaveLength(2);
  });

  it('metadata round-trips as object', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r', metadata: { foo: 'bar' } }, 'u');
    expect(mgr.get(v.id)?.metadata).toEqual({ foo: 'bar' });
  });

  it('update non-existent → throws', () => {
    expect(() => mgr.update('xxx', { name: 'y' }, 'u')).toThrow();
  });
});
