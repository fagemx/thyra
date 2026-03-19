/**
 * outcome-window.test.ts — OutcomeWindow lifecycle 測試
 *
 * 測試範圍:
 * - 建立 OutcomeWindow（create）
 * - 狀態機 open -> evaluating -> closed (OUTCOME-01)
 * - 不可跳過 evaluating（open -> closed 被拒絕）
 * - 不可從 closed 轉換
 * - listByWorld + status filter
 * - 每次 transition 寫 audit_log (THY-07)
 * - baselineSnapshot 正確保存 (JSON round-trip)
 * - THY-04: id, created_at, version
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { OutcomeWindowManager } from './outcome-window';
import type { CreateOutcomeWindowInput } from '../schemas/outcome-window';

function createTestDb(): Database {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function makeInput(overrides?: Partial<CreateOutcomeWindowInput>): CreateOutcomeWindowInput {
  return {
    worldId: 'world_test1',
    appliedChangeId: 'ac_test1',
    proposalId: 'prop_test1',
    cycleId: 'cycle_test1',
    baselineSnapshot: { visitors: 100, revenue: 500, satisfaction: 0.85 },
    ...overrides,
  };
}

describe('OutcomeWindowManager', () => {
  let db: Database;
  let manager: OutcomeWindowManager;

  beforeEach(() => {
    db = createTestDb();
    manager = new OutcomeWindowManager(db);
  });

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('should create a new OutcomeWindow with status open', () => {
      const window = manager.create(makeInput());

      expect(window.id).toMatch(/^ow_/);
      expect(window.worldId).toBe('world_test1');
      expect(window.appliedChangeId).toBe('ac_test1');
      expect(window.proposalId).toBe('prop_test1');
      expect(window.cycleId).toBe('cycle_test1');
      expect(window.status).toBe('open');
      expect(window.baselineSnapshot).toEqual({
        visitors: 100,
        revenue: 500,
        satisfaction: 0.85,
      });
      expect(window.openedAt).toBeTruthy();
      expect(window.evaluatedAt).toBeNull();
      expect(window.closedAt).toBeNull();
      expect(window.version).toBe(1);
      expect(window.created_at).toBeTruthy();
    });

    it('should write audit_log on create (THY-07)', () => {
      const window = manager.create(makeInput());

      const audits = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'outcome_window' AND entity_id = ? AND action = 'create'",
      ).all(window.id) as Array<{ actor: string; payload: string }>;

      expect(audits).toHaveLength(1);
      expect(audits[0].actor).toBe('system');
      const payload = JSON.parse(audits[0].payload);
      expect(payload.worldId).toBe('world_test1');
    });

    it('should preserve baselineSnapshot through JSON round-trip', () => {
      const snapshot = { metric_a: 0.001, metric_b: -42.5, metric_c: 99999 };
      const window = manager.create(makeInput({ baselineSnapshot: snapshot }));

      const fetched = manager.get(window.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.baselineSnapshot).toEqual(snapshot);
    });
  });

  // -------------------------------------------------------------------------
  // Get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('should return null for non-existent id', () => {
      expect(manager.get('ow_nonexistent')).toBeNull();
    });

    it('should return the window by id', () => {
      const created = manager.create(makeInput());
      const fetched = manager.get(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(created.id);
    });
  });

  // -------------------------------------------------------------------------
  // listByWorld
  // -------------------------------------------------------------------------

  describe('listByWorld', () => {
    it('should return all windows for a world', () => {
      manager.create(makeInput({ worldId: 'w1', appliedChangeId: 'ac1' }));
      manager.create(makeInput({ worldId: 'w1', appliedChangeId: 'ac2' }));
      manager.create(makeInput({ worldId: 'w2', appliedChangeId: 'ac3' }));

      const w1Windows = manager.listByWorld('w1');
      expect(w1Windows).toHaveLength(2);

      const w2Windows = manager.listByWorld('w2');
      expect(w2Windows).toHaveLength(1);
    });

    it('should filter by status', () => {
      const w1 = manager.create(makeInput({ worldId: 'w1', appliedChangeId: 'ac1' }));
      manager.create(makeInput({ worldId: 'w1', appliedChangeId: 'ac2' }));

      // Transition first window to evaluating
      manager.transition(w1.id, 'evaluating');

      const openWindows = manager.listByWorld('w1', 'open');
      expect(openWindows).toHaveLength(1);

      const evalWindows = manager.listByWorld('w1', 'evaluating');
      expect(evalWindows).toHaveLength(1);
      expect(evalWindows[0].id).toBe(w1.id);
    });

    it('should return empty array for non-existent world', () => {
      expect(manager.listByWorld('nonexistent')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Transition — OUTCOME-01
  // -------------------------------------------------------------------------

  describe('transition', () => {
    it('should transition open -> evaluating', () => {
      const window = manager.create(makeInput());
      const updated = manager.transition(window.id, 'evaluating');

      expect(updated.status).toBe('evaluating');
      expect(updated.evaluatedAt).toBeTruthy();
      expect(updated.closedAt).toBeNull();
      expect(updated.version).toBe(2);
    });

    it('should transition evaluating -> closed', () => {
      const window = manager.create(makeInput());
      manager.transition(window.id, 'evaluating');
      const closed = manager.transition(window.id, 'closed');

      expect(closed.status).toBe('closed');
      expect(closed.closedAt).toBeTruthy();
      expect(closed.version).toBe(3);
    });

    it('should reject open -> closed (OUTCOME-01: cannot skip evaluating)', () => {
      const window = manager.create(makeInput());

      expect(() => manager.transition(window.id, 'closed')).toThrow(
        /Invalid transition: open -> closed/,
      );
    });

    it('should reject transitions from closed', () => {
      const window = manager.create(makeInput());
      manager.transition(window.id, 'evaluating');
      manager.transition(window.id, 'closed');

      expect(() => manager.transition(window.id, 'open')).toThrow(
        /Invalid transition: closed -> open/,
      );
      expect(() => manager.transition(window.id, 'evaluating')).toThrow(
        /Invalid transition: closed -> evaluating/,
      );
    });

    it('should reject open -> open (self-transition)', () => {
      const window = manager.create(makeInput());

      expect(() => manager.transition(window.id, 'open')).toThrow(
        /Invalid transition: open -> open/,
      );
    });

    it('should throw for non-existent window', () => {
      expect(() => manager.transition('ow_nonexistent', 'evaluating')).toThrow(
        /OutcomeWindow not found/,
      );
    });

    it('should write audit_log on every transition (THY-07)', () => {
      const window = manager.create(makeInput());
      manager.transition(window.id, 'evaluating');
      manager.transition(window.id, 'closed');

      const audits = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'outcome_window' AND entity_id = ? AND action = 'transition' ORDER BY created_at",
      ).all(window.id) as Array<{ payload: string; actor: string }>;

      expect(audits).toHaveLength(2);
      expect(audits[0].actor).toBe('system');

      const t1 = JSON.parse(audits[0].payload);
      expect(t1.from).toBe('open');
      expect(t1.to).toBe('evaluating');

      const t2 = JSON.parse(audits[1].payload);
      expect(t2.from).toBe('evaluating');
      expect(t2.to).toBe('closed');
    });
  });

  // -------------------------------------------------------------------------
  // Full lifecycle
  // -------------------------------------------------------------------------

  describe('full lifecycle', () => {
    it('should complete full open -> evaluating -> closed cycle', () => {
      const window = manager.create(makeInput());
      expect(window.status).toBe('open');
      expect(window.version).toBe(1);

      const evaluating = manager.transition(window.id, 'evaluating');
      expect(evaluating.status).toBe('evaluating');
      expect(evaluating.evaluatedAt).toBeTruthy();
      expect(evaluating.version).toBe(2);

      const closed = manager.transition(window.id, 'closed');
      expect(closed.status).toBe('closed');
      expect(closed.closedAt).toBeTruthy();
      expect(closed.version).toBe(3);

      // Audit: create + 2 transitions = 3 audit entries
      const totalAudits = db.prepare(
        "SELECT COUNT(*) as count FROM audit_log WHERE entity_type = 'outcome_window' AND entity_id = ?",
      ).get(window.id) as { count: number };
      expect(totalAudits.count).toBe(3);
    });
  });
});
