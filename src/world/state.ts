import type { Database } from 'bun:sqlite';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';
import type { Law } from '../law-engine';
import type { Skill } from '../skill-registry';
import type { LoopCycle } from '../loop-runner';

/** 某個 village 在某一時刻的完整狀態快照 */
export interface WorldState {
  /** Village 基本資訊 */
  village: Village;

  /** 當前生效的 constitution（null = 尚未設立） */
  constitution: Constitution | null;

  /** 活躍的 chief 列表 */
  chiefs: Chief[];

  /** 活躍的 law 列表 */
  active_laws: Law[];

  /** Village 可用的 verified skills（含 shared） */
  skills: Skill[];

  /** 正在執行的 loop cycles */
  running_cycles: LoopCycle[];

  /** 快照組裝時間 (ISO 8601) */
  assembled_at: string;
}

/**
 * 從 DB 組裝某個 village 的完整狀態快照。
 * 純讀取函數，不寫 audit_log。
 * 與 evaluateVillage() 一致的 pattern：直接接受 Database handle。
 */
export function assembleWorldState(db: Database, villageId: string): WorldState {
  // 1. 查詢 village
  const villageRow = db.prepare(
    'SELECT * FROM villages WHERE id = ?'
  ).get(villageId) as Record<string, unknown> | null;
  if (!villageRow) throw new Error(`Village not found: ${villageId}`);
  const village = deserializeVillage(villageRow);

  // 2. 查詢 active constitution
  const constRow = db.prepare(
    'SELECT * FROM constitutions WHERE village_id = ? AND status = ? ORDER BY version DESC LIMIT 1'
  ).get(villageId, 'active') as Record<string, unknown> | null;
  const constitution = constRow ? deserializeConstitution(constRow) : null;

  // 3. 查詢 active chiefs
  const chiefRows = db.prepare(
    'SELECT * FROM chiefs WHERE village_id = ? AND status = ? ORDER BY created_at DESC'
  ).all(villageId, 'active') as Record<string, unknown>[];
  const chiefs = chiefRows.map(deserializeChief);

  // 4. 查詢 active laws
  const lawRows = db.prepare(
    'SELECT * FROM laws WHERE village_id = ? AND status = ? ORDER BY created_at DESC'
  ).all(villageId, 'active') as Record<string, unknown>[];
  const active_laws = lawRows.map(deserializeLaw);

  // 5. 查詢 available verified skills (owned + global + shared)
  // 邏輯與 SkillRegistry.getAvailable() 一致
  const skillRows = db.prepare(`
    SELECT * FROM skills
    WHERE (village_id = ? OR village_id IS NULL)
      AND status = 'verified'
    UNION
    SELECT s.* FROM skills s
      INNER JOIN skill_shares ss ON ss.skill_id = s.id
    WHERE ss.to_village_id = ?
      AND ss.status = 'active'
      AND s.status = 'verified'
    ORDER BY name, version DESC
  `).all(villageId, villageId) as Record<string, unknown>[];
  const skills = skillRows.map(deserializeSkill);

  // 6. 查詢 running loop cycles
  const cycleRows = db.prepare(
    'SELECT * FROM loop_cycles WHERE village_id = ? AND status = ? ORDER BY created_at DESC'
  ).all(villageId, 'running') as Record<string, unknown>[];
  const running_cycles = cycleRows.map(deserializeCycle);

  return {
    village,
    constitution,
    chiefs,
    active_laws,
    skills,
    running_cycles,
    assembled_at: new Date().toISOString(),
  };
}

// --- Deserialize 函數 ---
// 邏輯來源標記於各函數上方，與各模組的 private deserialize 方法一致。

/** 來源: village-manager.ts L99-111 */
function deserializeVillage(row: Record<string, unknown>): Village {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    target_repo: row.target_repo as string,
    status: row.status as Village['status'],
    metadata: JSON.parse((row.metadata as string) || '{}'),
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** 來源: constitution-store.ts L152-165 */
function deserializeConstitution(row: Record<string, unknown>): Constitution {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    version: row.version as number,
    status: row.status as Constitution['status'],
    created_at: row.created_at as string,
    created_by: row.created_by as string,
    rules: JSON.parse((row.rules as string) || '[]'),
    allowed_permissions: JSON.parse((row.allowed_permissions as string) || '[]'),
    budget_limits: JSON.parse((row.budget_limits as string) || '{}'),
    superseded_by: (row.superseded_by as string) || null,
  };
}

/** 來源: chief-engine.ts L183-198 */
function deserializeChief(row: Record<string, unknown>): Chief {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    name: row.name as string,
    role: row.role as string,
    version: row.version as number,
    status: row.status as Chief['status'],
    skills: JSON.parse((row.skills as string) || '[]'),
    permissions: JSON.parse((row.permissions as string) || '[]'),
    personality: JSON.parse((row.personality as string) || '{}'),
    constraints: JSON.parse((row.constraints as string) || '[]'),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** 來源: law-engine.ts L238-254 */
function deserializeLaw(row: Record<string, unknown>): Law {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    proposed_by: row.proposed_by as string,
    approved_by: (row.approved_by as string) || null,
    version: row.version as number,
    status: row.status as Law['status'],
    category: row.category as string,
    content: JSON.parse((row.content as string) || '{}'),
    risk_level: row.risk_level as Law['risk_level'],
    evidence: JSON.parse((row.evidence as string) || '{}'),
    effectiveness: row.effectiveness ? JSON.parse(row.effectiveness as string) : null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** 來源: skill-registry.ts L184-197 */
function deserializeSkill(row: Record<string, unknown>): Skill {
  return {
    id: row.id as string,
    name: row.name as string,
    version: row.version as number,
    status: row.status as Skill['status'],
    village_id: (row.village_id as string) || null,
    definition: JSON.parse(row.definition as string),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    verified_at: (row.verified_at as string) || null,
    verified_by: (row.verified_by as string) || null,
  };
}

/** 來源: loop-runner.ts L660-681 */
function deserializeCycle(row: Record<string, unknown>): LoopCycle {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    chief_id: row.chief_id as string,
    trigger: row.trigger as LoopCycle['trigger'],
    status: row.status as LoopCycle['status'],
    version: row.version as number,
    budget_remaining: row.budget_remaining as number,
    cost_incurred: row.cost_incurred as number,
    iterations: row.iterations as number,
    max_iterations: row.max_iterations as number,
    timeout_ms: row.timeout_ms as number,
    actions: JSON.parse((row.actions as string) || '[]'),
    laws_proposed: JSON.parse((row.laws_proposed as string) || '[]'),
    laws_enacted: JSON.parse((row.laws_enacted as string) || '[]'),
    abort_reason: (row.abort_reason as string) || null,
    intent: row.intent ? JSON.parse(row.intent as string) : null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
