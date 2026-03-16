import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { AlertManager } from './alert-manager';
import { VillageManager } from './village-manager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const am = new AlertManager(db, { dedupWindowMs: 5 * 60 * 1000 });
  const village = vm.create({ name: 'Alert Test Village', target_repo: 'test/repo' }, 'test');
  return { db, am, village };
}

// ---------------------------------------------------------------------------
// AlertManager Tests
// ---------------------------------------------------------------------------

describe('AlertManager', () => {
  let am: AlertManager;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    am = s.am;
    villageId = s.village.id;
  });

  // -----------------------------------------------------------------------
  // emit
  // -----------------------------------------------------------------------

  describe('emit', () => {
    it('should create a new alert', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'Budget 80%', 'Budget at 80%');
      expect(alert.id).toMatch(/^alert_/);
      expect(alert.village_id).toBe(villageId);
      expect(alert.type).toBe('budget_warning');
      expect(alert.severity).toBe('warning');
      expect(alert.status).toBe('active');
      expect(alert.title).toBe('Budget 80%');
      expect(alert.occurrence_count).toBe(1);
    });

    it('should dedup within window (same type + village)', () => {
      const a1 = am.emit(villageId, 'budget_warning', 'warning', 'Budget 80%', 'msg1');
      const a2 = am.emit(villageId, 'budget_warning', 'critical', 'Budget 95%', 'msg2');

      // Same ID, occurrence incremented
      expect(a2.id).toBe(a1.id);
      expect(a2.occurrence_count).toBe(2);
      // Severity escalated
      expect(a2.severity).toBe('critical');
    });

    it('should create new alert for different type', () => {
      const a1 = am.emit(villageId, 'budget_warning', 'warning', 'Budget', 'msg1');
      const a2 = am.emit(villageId, 'chief_timeout', 'warning', 'Timeout', 'msg2');
      expect(a2.id).not.toBe(a1.id);
    });

    it('should store details as JSON', () => {
      const alert = am.emit(villageId, 'health_drop', 'critical', 'Drop', 'msg', { delta: 15, current: 45 });
      expect(alert.details.delta).toBe(15);
      expect(alert.details.current).toBe(45);
    });

    it('should create new alert after dedup window expires', () => {
      // Use very short window
      const db2 = new Database(':memory:');
      initSchema(db2);
      const vm2 = new VillageManager(db2);
      const v = vm2.create({ name: 'V2', target_repo: 't/r' }, 'test');
      const am2 = new AlertManager(db2, { dedupWindowMs: 0 }); // 0ms window

      const a1 = am2.emit(v.id, 'budget_warning', 'warning', 'T', 'M');
      const a2 = am2.emit(v.id, 'budget_warning', 'warning', 'T', 'M');
      expect(a2.id).not.toBe(a1.id);
    });
  });

  // -----------------------------------------------------------------------
  // acknowledge
  // -----------------------------------------------------------------------

  describe('acknowledge', () => {
    it('should transition active -> acknowledged', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const acked = am.acknowledge(alert.id, 'operator-1');

      expect(acked.status).toBe('acknowledged');
      expect(acked.acknowledged_by).toBe('operator-1');
      expect(acked.acknowledged_at).toBeTruthy();
    });

    it('should throw for non-existent alert', () => {
      expect(() => am.acknowledge('nonexistent', 'actor')).toThrow('Alert not found');
    });

    it('should throw for already resolved alert', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      am.acknowledge(alert.id, 'actor');
      am.resolve(alert.id, 'actor');
      expect(() => am.acknowledge(alert.id, 'actor')).toThrow('Cannot acknowledge');
    });
  });

  // -----------------------------------------------------------------------
  // resolve
  // -----------------------------------------------------------------------

  describe('resolve', () => {
    it('should transition acknowledged -> resolved', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      am.acknowledge(alert.id, 'actor');
      const resolved = am.resolve(alert.id, 'actor', 'fixed');

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolved_at).toBeTruthy();
    });

    it('should transition active -> resolved directly', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const resolved = am.resolve(alert.id, 'actor');
      expect(resolved.status).toBe('resolved');
    });

    it('should throw for already resolved alert', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      am.resolve(alert.id, 'actor');
      expect(() => am.resolve(alert.id, 'actor')).toThrow('Cannot resolve');
    });
  });

  // -----------------------------------------------------------------------
  // autoResolve
  // -----------------------------------------------------------------------

  describe('autoResolve', () => {
    it('should transition active -> auto_resolved', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      const resolved = am.autoResolve(alert.id, 'utilization dropped');

      expect(resolved.status).toBe('auto_resolved');
      expect(resolved.auto_action_taken).toBe('utilization dropped');
      expect(resolved.resolved_at).toBeTruthy();
    });

    it('should throw for non-active alert', () => {
      const alert = am.emit(villageId, 'budget_warning', 'warning', 'T', 'M');
      am.acknowledge(alert.id, 'actor');
      expect(() => am.autoResolve(alert.id, 'reason')).toThrow('Cannot auto-resolve');
    });
  });

  // -----------------------------------------------------------------------
  // list + countActive
  // -----------------------------------------------------------------------

  describe('list / countActive', () => {
    it('should list alerts filtered by status', () => {
      am.emit(villageId, 'budget_warning', 'warning', 'T1', 'M1');
      const a2 = am.emit(villageId, 'chief_timeout', 'critical', 'T2', 'M2');
      am.acknowledge(a2.id, 'actor');

      const active = am.list(villageId, { status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].type).toBe('budget_warning');

      const acked = am.list(villageId, { status: 'acknowledged' });
      expect(acked).toHaveLength(1);
      expect(acked[0].type).toBe('chief_timeout');
    });

    it('should list alerts filtered by type', () => {
      am.emit(villageId, 'budget_warning', 'warning', 'T1', 'M1');
      am.emit(villageId, 'chief_timeout', 'critical', 'T2', 'M2');

      const budget = am.list(villageId, { type: 'budget_warning' });
      expect(budget).toHaveLength(1);
    });

    it('should count active alerts', () => {
      am.emit(villageId, 'budget_warning', 'warning', 'T1', 'M1');
      am.emit(villageId, 'chief_timeout', 'critical', 'T2', 'M2');
      const a3 = am.emit(villageId, 'health_drop', 'emergency', 'T3', 'M3');
      am.resolve(a3.id, 'actor');

      expect(am.countActive(villageId)).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // findActiveByType
  // -----------------------------------------------------------------------

  describe('findActiveByType', () => {
    it('should find active alerts of a specific type', () => {
      am.emit(villageId, 'budget_warning', 'warning', 'T1', 'M1');
      am.emit(villageId, 'chief_timeout', 'critical', 'T2', 'M2');

      const results = am.findActiveByType(villageId, 'budget_warning');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('budget_warning');
    });
  });
});
