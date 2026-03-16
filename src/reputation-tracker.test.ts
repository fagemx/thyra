/**
 * reputation-tracker.test.ts -- Chief 聲望追蹤系統測試 (#216)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { ReputationTracker } from './reputation-tracker';
import { INITIAL_SCORE, SCORE_FLOOR, SCORE_CEILING } from './schemas/reputation';

// ---------------------------------------------------------------------------
// 共用 helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const now = new Date().toISOString();

  // 建立 village
  db.prepare(`
    INSERT INTO villages (id, name, target_repo, version, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run('v1', 'Test Village', 'test/repo', now, now);

  // 建立 chiefs
  db.prepare(`
    INSERT INTO chiefs (id, village_id, name, role, version, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'active', ?, ?)
  `).run('c1', 'v1', 'Economy Chief', 'economy', now, now);

  db.prepare(`
    INSERT INTO chiefs (id, village_id, name, role, version, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'active', ?, ?)
  `).run('c2', 'v1', 'Safety Chief', 'safety', now, now);

  return { db };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReputationTracker', () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = setup());
  });

  // -- Core CRUD --

  describe('getOrCreate', () => {
    it('should initialize with score=100', () => {
      const rep = ReputationTracker.getOrCreate(db, 'c1', 'v1');
      expect(rep.chief_id).toBe('c1');
      expect(rep.village_id).toBe('v1');
      expect(rep.score).toBe(INITIAL_SCORE);
      expect(rep.proposals_applied).toBe(0);
      expect(rep.proposals_rejected).toBe(0);
      expect(rep.rollbacks_triggered).toBe(0);
      expect(rep.updated_at).toBeTruthy();
    });

    it('should return existing record on second call', () => {
      const first = ReputationTracker.getOrCreate(db, 'c1', 'v1');
      const second = ReputationTracker.getOrCreate(db, 'c1', 'v1');
      expect(second.updated_at).toBe(first.updated_at);
    });
  });

  describe('get', () => {
    it('should return null for unknown chief', () => {
      const rep = ReputationTracker.get(db, 'nonexistent');
      expect(rep).toBeNull();
    });
  });

  describe('list', () => {
    it('should return all reputations for village', () => {
      ReputationTracker.getOrCreate(db, 'c1', 'v1');
      ReputationTracker.getOrCreate(db, 'c2', 'v1');
      const list = ReputationTracker.list(db, 'v1');
      expect(list).toHaveLength(2);
    });

    it('should return empty array for village with no reputation data', () => {
      const list = ReputationTracker.list(db, 'v1');
      expect(list).toHaveLength(0);
    });
  });

  // -- Scoring --

  describe('recordProposal', () => {
    it('should increment score by 1 when applied=true', () => {
      ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep).not.toBeNull();
      expect(rep?.score).toBe(INITIAL_SCORE + 1);
    });

    it('should decrement score by 1 when applied=false', () => {
      ReputationTracker.recordProposal(db, 'c1', 'v1', false);
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep).not.toBeNull();
      expect(rep?.score).toBe(INITIAL_SCORE - 1);
    });

    it('should increment proposals_applied counter', () => {
      ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep?.proposals_applied).toBe(2);
      expect(rep?.proposals_rejected).toBe(0);
    });

    it('should increment proposals_rejected counter', () => {
      ReputationTracker.recordProposal(db, 'c1', 'v1', false);
      ReputationTracker.recordProposal(db, 'c1', 'v1', false);
      ReputationTracker.recordProposal(db, 'c1', 'v1', false);
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep?.proposals_rejected).toBe(3);
      expect(rep?.proposals_applied).toBe(0);
    });

    it('should auto-create reputation on first scoring (lazy init)', () => {
      expect(ReputationTracker.get(db, 'c1')).toBeNull();
      ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      expect(ReputationTracker.get(db, 'c1')).not.toBeNull();
    });
  });

  describe('recordRollback', () => {
    it('should decrement score by 2', () => {
      ReputationTracker.recordRollback(db, 'c1', 'v1');
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep?.score).toBe(INITIAL_SCORE - 2);
    });

    it('should increment rollbacks_triggered counter', () => {
      ReputationTracker.recordRollback(db, 'c1', 'v1');
      ReputationTracker.recordRollback(db, 'c1', 'v1');
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep?.rollbacks_triggered).toBe(2);
    });
  });

  // -- Clamping --

  describe('score clamping', () => {
    it('should clamp score at floor 0', () => {
      ReputationTracker.getOrCreate(db, 'c1', 'v1');
      // 100 rejections should bring score to 0, not negative
      for (let i = 0; i < 110; i++) {
        ReputationTracker.recordProposal(db, 'c1', 'v1', false);
      }
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep?.score).toBe(SCORE_FLOOR);
    });

    it('should clamp score at ceiling 200', () => {
      ReputationTracker.getOrCreate(db, 'c1', 'v1');
      // 110 approvals should bring score to 200, not higher
      for (let i = 0; i < 110; i++) {
        ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      }
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep?.score).toBe(SCORE_CEILING);
    });
  });

  // -- Batch --

  describe('recordCycleResult', () => {
    it('should record net score from applied and skipped', () => {
      const result = {
        chief_id: 'c1',
        proposals: [],
        applied: [
          { applied: true, judge_result: { accepted: true, reasons: [] } },
          { applied: true, judge_result: { accepted: true, reasons: [] } },
        ],
        skipped: [
          { proposal: {} as unknown, reason: 'rejected' },
        ],
      };
      ReputationTracker.recordCycleResult(db, 'v1', result);
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep).not.toBeNull();
      // +2 (applied) + -1 (rejected) = net +1
      expect(rep?.score).toBe(INITIAL_SCORE + 1);
      expect(rep?.proposals_applied).toBe(2);
      expect(rep?.proposals_rejected).toBe(1);
    });

    it('should not create record when no proposals', () => {
      const result = {
        chief_id: 'c1',
        proposals: [],
        applied: [],
        skipped: [],
      };
      ReputationTracker.recordCycleResult(db, 'v1', result);
      const rep = ReputationTracker.get(db, 'c1');
      expect(rep).toBeNull();
    });
  });

  // -- Multi-chief isolation --

  describe('multi-chief', () => {
    it('should track chiefs independently', () => {
      ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      ReputationTracker.recordProposal(db, 'c2', 'v1', false);

      const rep1 = ReputationTracker.get(db, 'c1');
      const rep2 = ReputationTracker.get(db, 'c2');

      expect(rep1?.score).toBe(INITIAL_SCORE + 2);
      expect(rep2?.score).toBe(INITIAL_SCORE - 1);
    });
  });

  // -- Audit log --

  describe('audit log', () => {
    it('should write audit log entries for score changes', () => {
      ReputationTracker.recordProposal(db, 'c1', 'v1', true);
      ReputationTracker.recordRollback(db, 'c1', 'v1');

      const audits = db.prepare(`
        SELECT action FROM audit_log
        WHERE entity_type = 'reputation' AND entity_id = 'c1'
        ORDER BY created_at
      `).all() as { action: string }[];

      expect(audits).toHaveLength(2);
      expect(audits[0].action).toBe('proposal_applied');
      expect(audits[1].action).toBe('rollback_triggered');
    });
  });
});
