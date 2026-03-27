import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit, dbChanges } from './db';
import { CreateGoalInput as CreateGoalSchema, UpdateGoalInput as UpdateGoalSchema, LEVEL_ORDER } from './schemas/goal';
import type { CreateGoalInputRaw, UpdateGoalInput, GoalLevel, GoalStatus, GoalMetric } from './schemas/goal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Goal {
  id: string;
  village_id: string;
  level: GoalLevel;
  title: string;
  description: string;
  status: GoalStatus;
  parent_id: string | null;
  owner_chief_id: string | null;
  metrics: GoalMetric[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface GoalWithAncestry {
  goal: Goal;
  ancestry: Goal[];
}

// ---------------------------------------------------------------------------
// GoalStore
// ---------------------------------------------------------------------------

export class GoalStore {
  constructor(private db: Database) {}

  create(villageId: string, rawInput: CreateGoalInputRaw, actor: string): Goal {
    const input = CreateGoalSchema.parse(rawInput);

    if (input.village_id !== villageId) {
      throw new Error('VALIDATION: village_id in body must match route parameter');
    }

    // Validate parent if specified
    if (input.parent_id) {
      const parent = this.get(input.parent_id);
      if (!parent) throw new Error('PARENT_NOT_FOUND: parent goal does not exist');
      if (parent.village_id !== villageId) {
        throw new Error('CROSS_VILLAGE: parent goal must be in same village');
      }
      // Parent level must be higher (lower number)
      if (LEVEL_ORDER[parent.level] >= LEVEL_ORDER[input.level]) {
        throw new Error(
          `LEVEL_ORDER: parent level "${parent.level}" must be higher than child level "${input.level}"`
        );
      }
    }

    // Validate owner_chief_id if specified
    if (input.owner_chief_id) {
      if (input.level !== 'chief' && input.level !== 'task') {
        throw new Error('VALIDATION: owner_chief_id only valid for level "chief" or "task"');
      }
      const chiefRow = this.db.prepare(
        'SELECT id, village_id FROM chiefs WHERE id = ?'
      ).get(input.owner_chief_id) as Record<string, unknown> | null;
      if (!chiefRow) throw new Error('CHIEF_NOT_FOUND: owner chief does not exist');
      if (chiefRow.village_id !== villageId) {
        throw new Error('CROSS_VILLAGE: owner chief must be in same village');
      }
    }

    const now = new Date().toISOString();
    const goal: Goal = {
      id: `goal-${randomUUID()}`,
      village_id: villageId,
      level: input.level,
      title: input.title,
      description: input.description,
      status: 'planned',
      parent_id: input.parent_id ?? null,
      owner_chief_id: input.owner_chief_id ?? null,
      metrics: input.metrics,
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO goals (id, village_id, level, title, description, status, parent_id, owner_chief_id, metrics, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      goal.id, goal.village_id, goal.level, goal.title, goal.description,
      goal.status, goal.parent_id, goal.owner_chief_id,
      JSON.stringify(goal.metrics), goal.version, goal.created_at, goal.updated_at,
    );

    appendAudit(this.db, 'goal', goal.id, 'create', goal, actor);
    return goal;
  }

  get(id: string): Goal | null {
    const row = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  update(id: string, rawInput: UpdateGoalInput, actor: string): Goal {
    const input = UpdateGoalSchema.parse(rawInput);
    const existing = this.get(id);
    if (!existing) throw new Error('Goal not found');

    const now = new Date().toISOString();
    const updated: Goal = {
      ...existing,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.metrics !== undefined && { metrics: input.metrics }),
      ...(input.owner_chief_id !== undefined && { owner_chief_id: input.owner_chief_id }),
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE goals SET title=?, description=?, status=?, metrics=?, owner_chief_id=?,
        version=?, updated_at=? WHERE id=? AND version=?
    `).run(
      updated.title, updated.description, updated.status,
      JSON.stringify(updated.metrics), updated.owner_chief_id,
      updated.version, updated.updated_at, id, existing.version,
    );

    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    appendAudit(this.db, 'goal', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  list(villageId: string, filters?: { status?: GoalStatus; level?: GoalLevel; owner_chief_id?: string }): Goal[] {
    let sql = 'SELECT * FROM goals WHERE village_id = ?';
    const params: string[] = [villageId];

    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.level) {
      sql += ' AND level = ?';
      params.push(filters.level);
    }
    if (filters?.owner_chief_id) {
      sql += ' AND owner_chief_id = ?';
      params.push(filters.owner_chief_id);
    }

    sql += ' ORDER BY level, created_at';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * 取得 goal 的完整祖先鏈（從自身到根）。
   * 使用 SQLite WITH RECURSIVE CTE。
   */
  getAncestry(goalId: string): Goal[] {
    const rows = this.db.prepare(`
      WITH RECURSIVE ancestors(id, village_id, level, title, description, status, parent_id, owner_chief_id, metrics, version, created_at, updated_at, depth) AS (
        SELECT id, village_id, level, title, description, status, parent_id, owner_chief_id, metrics, version, created_at, updated_at, 0
        FROM goals WHERE id = ?
        UNION ALL
        SELECT g.id, g.village_id, g.level, g.title, g.description, g.status, g.parent_id, g.owner_chief_id, g.metrics, g.version, g.created_at, g.updated_at, a.depth + 1
        FROM goals g
        INNER JOIN ancestors a ON g.id = a.parent_id
      )
      SELECT id, village_id, level, title, description, status, parent_id, owner_chief_id, metrics, version, created_at, updated_at
      FROM ancestors
      ORDER BY depth ASC
    `).all(goalId) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * 取得某 chief 擁有的所有 goals。
   */
  getChiefGoals(chiefId: string): Goal[] {
    const rows = this.db.prepare(
      'SELECT * FROM goals WHERE owner_chief_id = ? ORDER BY level, created_at'
    ).all(chiefId) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * 取得某 chief 的所有 goals 及其祖先鏈。
   */
  getChiefGoalAncestry(chiefId: string): GoalWithAncestry[] {
    const chiefGoals = this.getChiefGoals(chiefId);
    return chiefGoals.map((goal) => ({
      goal,
      ancestry: this.getAncestry(goal.id),
    }));
  }

  /**
   * 取得 village 的目標樹（flat list，UI 可用 parent_id 重建樹）。
   */
  getTree(villageId: string): Goal[] {
    const rows = this.db.prepare(
      "SELECT * FROM goals WHERE village_id = ? AND status IN ('planned','active') ORDER BY level, created_at"
    ).all(villageId) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  private deserialize(row: Record<string, unknown>): Goal {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      level: row.level as GoalLevel,
      title: row.title as string,
      description: row.description as string,
      status: row.status as GoalStatus,
      parent_id: (row.parent_id as string) || null,
      owner_chief_id: (row.owner_chief_id as string) || null,
      metrics: JSON.parse((row.metrics as string) || '[]') as GoalMetric[],
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
