/**
 * canonical-cycle/outcome-window.ts — OutcomeWindow lifecycle 管理
 *
 * 狀態機: open -> evaluating -> closed (OUTCOME-01: 不可跳過，不可 auto-close)
 * 每次 transition 都寫 audit_log (THY-07)
 *
 * @see docs/plan/world-cycle/TRACK_E_OUTCOME_COLLECTOR.md Step 1
 * @see docs/plan/world-cycle/CONTRACT.md OUTCOME-01
 */

import type { Database } from '../db';
import { nanoid } from 'nanoid';
import { appendAudit } from '../db';
import type {
  CreateOutcomeWindowInput,
  OutcomeWindow,
  OutcomeWindowStatus,
} from '../schemas/outcome-window';

// ---------------------------------------------------------------------------
// Valid transitions — OUTCOME-01: open -> evaluating -> closed, no skip
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<OutcomeWindowStatus, OutcomeWindowStatus[]> = {
  open: ['evaluating'],
  evaluating: ['closed'],
  closed: [],
};

// ---------------------------------------------------------------------------
// DB row -> domain object 轉換
// ---------------------------------------------------------------------------

interface OutcomeWindowRow {
  id: string;
  world_id: string;
  applied_change_id: string;
  proposal_id: string;
  cycle_id: string;
  status: string;
  baseline_snapshot: string;
  opened_at: string;
  evaluated_at: string | null;
  closed_at: string | null;
  version: number;
  created_at: string;
}

function rowToWindow(row: OutcomeWindowRow): OutcomeWindow {
  return {
    id: row.id,
    worldId: row.world_id,
    appliedChangeId: row.applied_change_id,
    proposalId: row.proposal_id,
    cycleId: row.cycle_id,
    status: row.status as OutcomeWindowStatus,
    baselineSnapshot: JSON.parse(row.baseline_snapshot) as Record<string, number>,
    openedAt: row.opened_at,
    evaluatedAt: row.evaluated_at,
    closedAt: row.closed_at,
    version: row.version,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// OutcomeWindowManager
// ---------------------------------------------------------------------------

export class OutcomeWindowManager {
  constructor(private db: Database) {}

  /**
   * 建立新的 OutcomeWindow（初始狀態 open）
   */
  create(input: CreateOutcomeWindowInput): OutcomeWindow {
    const id = `ow_${nanoid(12)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO outcome_windows
        (id, world_id, applied_change_id, proposal_id, cycle_id,
         status, baseline_snapshot, opened_at, evaluated_at, closed_at,
         version, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, NULL, 1, ?)
    `).run(
      id,
      input.worldId,
      input.appliedChangeId,
      input.proposalId,
      input.cycleId,
      JSON.stringify(input.baselineSnapshot),
      now,
      now,
    );

    appendAudit(this.db, 'outcome_window', id, 'create', {
      worldId: input.worldId,
      appliedChangeId: input.appliedChangeId,
      proposalId: input.proposalId,
      cycleId: input.cycleId,
    }, 'system');

    const window = this.get(id);
    if (!window) throw new Error(`Failed to create OutcomeWindow: ${id}`);
    return window;
  }

  /**
   * 取得 OutcomeWindow by id
   */
  get(id: string): OutcomeWindow | null {
    const row = this.db.prepare(
      'SELECT * FROM outcome_windows WHERE id = ?',
    ).get(id) as OutcomeWindowRow | null;

    return row ? rowToWindow(row) : null;
  }

  /**
   * 列出某 world 的 OutcomeWindows，可選 status 過濾
   */
  listByWorld(worldId: string, status?: OutcomeWindowStatus): OutcomeWindow[] {
    if (status) {
      const rows = this.db.prepare(
        'SELECT * FROM outcome_windows WHERE world_id = ? AND status = ? ORDER BY opened_at DESC',
      ).all(worldId, status) as OutcomeWindowRow[];
      return rows.map(rowToWindow);
    }

    const rows = this.db.prepare(
      'SELECT * FROM outcome_windows WHERE world_id = ? ORDER BY opened_at DESC',
    ).all(worldId) as OutcomeWindowRow[];
    return rows.map(rowToWindow);
  }

  /**
   * 狀態轉換 — OUTCOME-01: 不可跳過 evaluating
   *
   * open -> evaluating: 設定 evaluatedAt
   * evaluating -> closed: 設定 closedAt
   */
  transition(id: string, to: OutcomeWindowStatus): OutcomeWindow {
    const window = this.get(id);
    if (!window) {
      throw new Error(`OutcomeWindow not found: ${id}`);
    }

    const allowed = VALID_TRANSITIONS[window.status];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid transition: ${window.status} -> ${to}. ` +
        `Allowed transitions from '${window.status}': [${allowed.join(', ')}]`,
      );
    }

    const now = new Date().toISOString();
    const newVersion = window.version + 1;

    if (to === 'evaluating') {
      this.db.prepare(`
        UPDATE outcome_windows
        SET status = 'evaluating', evaluated_at = ?, version = ?
        WHERE id = ?
      `).run(now, newVersion, id);
    } else if (to === 'closed') {
      this.db.prepare(`
        UPDATE outcome_windows
        SET status = 'closed', closed_at = ?, version = ?
        WHERE id = ?
      `).run(now, newVersion, id);
    }

    appendAudit(this.db, 'outcome_window', id, 'transition', {
      from: window.status,
      to,
    }, 'system');

    const updated = this.get(id);
    if (!updated) throw new Error(`OutcomeWindow disappeared after transition: ${id}`);
    return updated;
  }
}
