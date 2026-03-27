import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit, dbChanges } from './db';
import { CreateChiefInput as CreateChiefSchema, ChiefCoreRow, ChiefExtendedRow, ChiefConfigRevisionRow } from './schemas/chief';
import type { CreateChiefInputRaw, UpdateChiefInput, ChiefPersonality, ChiefProfile, ChiefProfileName, GovernanceActionInput, ChiefBudgetConfig, PrecedentConfig, RoleType } from './schemas/chief';
import { GOVERNANCE_PERMISSIONS } from './schemas/chief';
import type { AdapterType, ContextMode } from './schemas/heartbeat';
import type { ConstitutionStore } from './constitution-store';
import type { SkillRegistry } from './skill-registry';
import { buildSkillPrompt } from './skill-registry';
import type { Permission } from './schemas/constitution';
import type { SkillBinding as SkillBindingType } from './schemas/skill';
import type { GoalWithAncestry } from './goal-store';

export type { ChiefPersonality, ChiefProfile, ChiefProfileName } from './schemas/chief';

export interface ChiefConstraint {
  type: 'must' | 'must_not' | 'prefer' | 'avoid';
  description: string;
}

/** Chief config snapshot — 存可修改的 config 欄位，排除 runtime/identity 欄位 */
export interface ChiefConfigSnapshot {
  name: string;
  role: string;
  skills: SkillBindingType[];
  pipelines: string[];
  permissions: Permission[];
  personality: ChiefPersonality;
  constraints: ChiefConstraint[];
  profile: ChiefProfileName | null;
  adapter_type: AdapterType;
  context_mode: ContextMode;
  adapter_config: Record<string, unknown>;
  budget_config: ChiefBudgetConfig | null;
  use_precedents: boolean;
  precedent_config: PrecedentConfig | null;
}

/** Chief config revision — 版本記錄 (#227) */
export interface ChiefConfigRevision {
  id: string;
  chief_id: string;
  version: number;
  config_snapshot: ChiefConfigSnapshot;
  changed_by: string | null;
  change_reason: string | null;
  created_at: string;
}

export interface Chief {
  id: string;
  village_id: string;
  name: string;
  role: string;
  role_type: RoleType;
  parent_chief_id: string | null;
  version: number;
  status: 'active' | 'inactive' | 'paused';
  skills: SkillBindingType[];
  pipelines: string[];
  permissions: Permission[];
  personality: ChiefPersonality;
  constraints: ChiefConstraint[];
  profile: ChiefProfileName | null;
  adapter_type: AdapterType;
  context_mode: ContextMode;
  adapter_config: Record<string, unknown>;
  budget_config: ChiefBudgetConfig | null;
  use_precedents: boolean;
  precedent_config: PrecedentConfig | null;
  pause_reason: string | null;
  paused_at: string | null;
  last_heartbeat_at: string | null;
  current_run_id: string | null;
  current_run_status: 'idle' | 'running' | 'timeout';
  timeout_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * 預設人格 profile 定義。
 * 每個 profile 包含 personality 設定 + 預設 constraints + 描述。
 * 可透過 CHIEF_PROFILES map 查詢，供 buildChiefPrompt 使用。
 */
export const CHIEF_PROFILES: ReadonlyMap<ChiefProfileName, ChiefProfile> = new Map<ChiefProfileName, ChiefProfile>([
  ['conservative', {
    name: 'conservative',
    description: 'Risk-averse profile. Prioritizes safety, compliance, and thorough validation before any action.',
    personality: { risk_tolerance: 'conservative', communication_style: 'detailed', decision_speed: 'cautious' },
    default_constraints: [
      { type: 'must', description: 'validate all inputs before processing' },
      { type: 'must', description: 'check compliance with all active laws before acting' },
      { type: 'avoid', description: 'taking actions with estimated cost above 50% of budget remaining' },
    ],
  }],
  ['aggressive', {
    name: 'aggressive',
    description: 'Action-oriented profile. Biases toward speed and throughput, accepting higher risk for faster results.',
    personality: { risk_tolerance: 'aggressive', communication_style: 'concise', decision_speed: 'fast' },
    default_constraints: [
      { type: 'prefer', description: 'dispatching tasks immediately when conditions are met' },
      { type: 'avoid', description: 'waiting when there are actionable items in the queue' },
    ],
  }],
  ['balanced', {
    name: 'balanced',
    description: 'Default balanced profile. Weighs risk and reward evenly, communicates concisely, decides at moderate speed.',
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    default_constraints: [],
  }],
  ['analyst', {
    name: 'analyst',
    description: 'Analysis-focused profile. Prioritizes data gathering, detailed reporting, and evidence-based decisions.',
    personality: { risk_tolerance: 'conservative', communication_style: 'detailed', decision_speed: 'deliberate' },
    default_constraints: [
      { type: 'must', description: 'cite evidence for every recommendation' },
      { type: 'prefer', description: 'gathering additional data before making decisions' },
      { type: 'avoid', description: 'acting without sufficient observational data' },
    ],
  }],
  ['executor', {
    name: 'executor',
    description: 'Execution-focused profile. Focuses on task completion with moderate risk tolerance and minimal communication overhead.',
    personality: { risk_tolerance: 'moderate', communication_style: 'minimal', decision_speed: 'fast' },
    default_constraints: [
      { type: 'prefer', description: 'completing current tasks before starting new ones' },
      { type: 'must', description: 'report task outcomes immediately after execution' },
    ],
  }],
]);

/**
 * 解析 profile 名稱，回傳對應的 ChiefProfile。
 * 若 profile 名稱不存在，拋出錯誤。
 */
export function resolveProfile(profileName: ChiefProfileName): ChiefProfile {
  const profile = CHIEF_PROFILES.get(profileName);
  if (!profile) {
    throw new Error(`Unknown chief profile: "${profileName}"`);
  }
  return profile;
}

/**
 * 取得所有可用 profile 列表。
 */
export function listProfiles(): ChiefProfile[] {
  return Array.from(CHIEF_PROFILES.values());
}

export class ChiefEngine {
  constructor(
    private db: Database,
    private constitutionStore: ConstitutionStore,
    private skillRegistry: SkillRegistry,
  ) {}

  create(villageId: string, rawInput: CreateChiefInputRaw, actor: string): Chief {
    const input = CreateChiefSchema.parse(rawInput);

    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) {
      throw new Error('No active constitution. Cannot create Chief without a constitution framework.');
    }

    this.validateCreateInput(input, villageId, constitution);

    // 解析 profile：profile 提供預設值，只有用戶明確指定的 personality/constraints 覆蓋
    // 需要檢查 rawInput 來判斷哪些欄位是用戶明確提供的
    const rawPersonality = (rawInput as Record<string, unknown>).personality as Partial<ChiefPersonality> | undefined;
    const resolved = this.resolveProfileDefaults(input.profile, input.personality, input.constraints, rawPersonality);

    const now = new Date().toISOString();
    const chief: Chief = {
      id: `chief-${randomUUID()}`,
      village_id: villageId,
      name: input.name,
      role: input.role,
      role_type: input.role_type,
      parent_chief_id: input.parent_chief_id ?? null,
      version: 1,
      status: 'active',
      skills: input.skills,
      pipelines: input.pipelines,
      permissions: input.permissions,
      personality: resolved.personality,
      constraints: resolved.constraints,
      profile: input.profile ?? null,
      adapter_type: input.adapter_type,
      context_mode: input.context_mode,
      adapter_config: input.adapter_config,
      budget_config: input.budget_config ?? null,
      use_precedents: input.use_precedents,
      precedent_config: input.precedent_config ?? null,
      pause_reason: null,
      paused_at: null,
      last_heartbeat_at: null,
      current_run_id: null,
      current_run_status: 'idle',
      timeout_count: 0,
      created_at: now,
      updated_at: now,
    };

    this.insertChief(chief, villageId);

    appendAudit(this.db, 'chief', chief.id, 'create', chief, actor);
    return chief;
  }

  /** 驗證 create 輸入的業務規則 */
  private validateCreateInput(
    input: ReturnType<typeof CreateChiefSchema.parse>,
    villageId: string,
    constitution: import('./constitution-store').Constitution,
  ): void {
    // THY-09: permissions ⊆ constitution.allowed_permissions
    for (const perm of input.permissions) {
      if (!constitution.allowed_permissions.includes(perm)) {
        throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}" not in constitution's allowed_permissions`);
      }
    }

    // #214: Worker cannot have governance permissions
    if (input.role_type === 'worker') {
      const forbidden = input.permissions.filter(p =>
        (GOVERNANCE_PERMISSIONS as readonly string[]).includes(p),
      );
      if (forbidden.length > 0) {
        throw new Error(`WORKER_GOVERNANCE_FORBIDDEN: workers cannot have governance permissions [${forbidden.join(', ')}]`);
      }
    }

    // #214: Validate parent_chief_id
    if (input.parent_chief_id) {
      const parent = this.get(input.parent_chief_id);
      if (!parent) throw new Error('PARENT_NOT_FOUND: parent_chief_id does not exist');
      if (parent.village_id !== villageId) throw new Error('PARENT_WRONG_VILLAGE: parent chief must be in the same village');
      if (parent.role_type === 'worker') throw new Error('PARENT_IS_WORKER: a worker cannot be parent of another chief/worker');
    }

    // THY-14: only verified skills
    this.validateSkillBindings(input.skills, villageId);

    // THY-09 pattern: Chief budget_config.max_monthly <= Constitution max_cost_per_month
    if (input.budget_config?.max_monthly !== undefined && constitution.budget_limits.max_cost_per_month > 0) {
      if (input.budget_config.max_monthly > constitution.budget_limits.max_cost_per_month) {
        throw new Error(`BUDGET_EXCEEDS_CONSTITUTION: chief max_monthly (${input.budget_config.max_monthly}) exceeds constitution max_cost_per_month (${constitution.budget_limits.max_cost_per_month})`);
      }
    }
  }

  /** INSERT chief 到 DB */
  private insertChief(chief: Chief, villageId: string): void {
    this.db.prepare(`
      INSERT INTO chiefs (id, village_id, name, role, role_type, parent_chief_id, version, status, skills, pipelines, permissions, personality, constraints, profile, adapter_type, context_mode, adapter_config, budget_config, use_precedents, precedent_config, pause_reason, paused_at, last_heartbeat_at, current_run_id, current_run_status, timeout_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chief.id, villageId, chief.name, chief.role, chief.role_type, chief.parent_chief_id,
      chief.version, chief.status,
      JSON.stringify(chief.skills), JSON.stringify(chief.pipelines),
      JSON.stringify(chief.permissions),
      JSON.stringify(chief.personality), JSON.stringify(chief.constraints),
      chief.profile, chief.adapter_type, chief.context_mode,
      JSON.stringify(chief.adapter_config),
      chief.budget_config ? JSON.stringify(chief.budget_config) : null,
      chief.use_precedents ? 1 : 0,
      chief.precedent_config ? JSON.stringify(chief.precedent_config) : null,
      chief.pause_reason, chief.paused_at,
      chief.last_heartbeat_at, chief.current_run_id, chief.current_run_status, chief.timeout_count,
      chief.created_at, chief.updated_at,
    );
  }

  get(id: string): Chief | null {
    const row = this.db.prepare('SELECT * FROM chiefs WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string, opts?: { status?: string }): Chief[] {
    let sql = 'SELECT * FROM chiefs WHERE village_id = ?';
    const params: string[] = [villageId];
    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  /** #214: 列出 top-level chiefs（排除 workers） */
  listTopLevel(villageId: string, opts?: { status?: string }): Chief[] {
    let sql = "SELECT * FROM chiefs WHERE village_id = ? AND role_type != 'worker'";
    const params: string[] = [villageId];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    sql += ' ORDER BY created_at DESC';
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map((r) => this.deserialize(r));
  }

  /** #214: 列出某 chief 的直屬下級 */
  listTeam(chiefId: string): Chief[] {
    return (this.db.prepare('SELECT * FROM chiefs WHERE parent_chief_id = ? ORDER BY created_at DESC').all(chiefId) as Record<string, unknown>[]).map((r) => this.deserialize(r));
  }

  update(id: string, input: UpdateChiefInput, actor: string, changeReason?: string): Chief {
    const existing = this.get(id);
    if (!existing) throw new Error('Chief not found');

    this.validateUpdateInput(input, existing);

    // 解析 profile 更新：profile 變更時重新計算 personality/constraints
    const { personality: resolvedPersonality, constraints: resolvedConstraints, profile: resolvedProfile } =
      this.resolveUpdateProfile(input, existing);

    const now = new Date().toISOString();
    const updated = this.mergeUpdateFields(existing, input, resolvedPersonality, resolvedConstraints, resolvedProfile, now);

    this.persistUpdate(updated, id, existing.version, now);

    // #227: 自動存 revision（存 update 前的 config）
    this.saveRevision(existing, actor, changeReason);

    appendAudit(this.db, 'chief', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  /** 驗證 update 輸入的業務規則 */
  private validateUpdateInput(input: UpdateChiefInput, existing: Chief): void {
    if (input.permissions) {
      const constitution = this.constitutionStore.getActive(existing.village_id);
      if (!constitution) throw new Error('No active constitution');
      for (const perm of input.permissions) {
        if (!constitution.allowed_permissions.includes(perm)) {
          throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}"`);
        }
      }
    }

    // #214: Worker governance permission check on update
    if (input.permissions && existing.role_type === 'worker') {
      const forbidden = input.permissions.filter(p => (GOVERNANCE_PERMISSIONS as readonly string[]).includes(p));
      if (forbidden.length > 0) throw new Error(`WORKER_GOVERNANCE_FORBIDDEN: workers cannot have governance permissions [${forbidden.join(', ')}]`);
    }

    if (input.skills) {
      this.validateSkillBindings(input.skills, existing.village_id);
    }
  }

  /** 解析 update 時的 profile / personality / constraints */
  private resolveUpdateProfile(
    input: UpdateChiefInput,
    existing: Chief,
  ): { personality: ChiefPersonality; constraints: ChiefConstraint[]; profile: ChiefProfileName | null } {
    let resolvedPersonality = input.personality ?? existing.personality;
    let resolvedConstraints = input.constraints ?? existing.constraints;
    const resolvedProfile = input.profile !== undefined ? input.profile : existing.profile;

    if (input.profile !== undefined) {
      const resolved = this.resolveProfileDefaults(
        input.profile,
        input.personality ?? existing.personality,
        input.constraints ?? existing.constraints,
        input.personality,
      );
      resolvedPersonality = resolved.personality;
      resolvedConstraints = resolved.constraints;
    }

    return { personality: resolvedPersonality, constraints: resolvedConstraints, profile: resolvedProfile };
  }

  /** 合併 update 欄位到 Chief 物件 */
  private mergeUpdateFields(
    existing: Chief,
    input: UpdateChiefInput,
    personality: ChiefPersonality,
    constraints: ChiefConstraint[],
    profile: ChiefProfileName | null,
    now: string,
  ): Chief {
    return {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.skills !== undefined && { skills: input.skills }),
      ...(input.pipelines !== undefined && { pipelines: input.pipelines }),
      ...(input.permissions !== undefined && { permissions: input.permissions }),
      ...(input.adapter_type !== undefined && { adapter_type: input.adapter_type }),
      ...(input.context_mode !== undefined && { context_mode: input.context_mode }),
      ...(input.adapter_config !== undefined && { adapter_config: input.adapter_config }),
      ...(input.budget_config !== undefined && { budget_config: input.budget_config }),
      ...(input.use_precedents !== undefined && { use_precedents: input.use_precedents }),
      ...(input.precedent_config !== undefined && { precedent_config: input.precedent_config }),
      personality,
      constraints,
      profile,
      version: existing.version + 1,
      updated_at: now,
    };
  }

  /** 寫入 update 到 DB with optimistic locking */
  private persistUpdate(updated: Chief, id: string, existingVersion: number, now: string): void {
    const result = this.db.prepare(`
      UPDATE chiefs SET name=?, role=?, version=?, skills=?, pipelines=?, permissions=?,
        personality=?, constraints=?, profile=?, adapter_type=?, context_mode=?, adapter_config=?,
        budget_config=?, use_precedents=?, precedent_config=?, pause_reason=?, paused_at=?,
        updated_at=? WHERE id=? AND version=?
    `).run(
      updated.name, updated.role, updated.version,
      JSON.stringify(updated.skills), JSON.stringify(updated.pipelines),
      JSON.stringify(updated.permissions),
      JSON.stringify(updated.personality), JSON.stringify(updated.constraints),
      updated.profile, updated.adapter_type, updated.context_mode,
      JSON.stringify(updated.adapter_config),
      updated.budget_config ? JSON.stringify(updated.budget_config) : null,
      updated.use_precedents ? 1 : 0,
      updated.precedent_config ? JSON.stringify(updated.precedent_config) : null,
      updated.pause_reason, updated.paused_at,
      now, id, existingVersion,
    );
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
  }

  deactivate(id: string, actor: string): void {
    const chief = this.get(id);
    if (!chief) throw new Error('Chief not found');
    const result = this.db.prepare('UPDATE chiefs SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run('inactive', new Date().toISOString(), id, chief.version);
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
    appendAudit(this.db, 'chief', id, 'deactivate', { previous_status: chief.status }, actor);
  }

  /** 暫停 chief（月預算超限或人工介入） */
  pauseChief(id: string, reason: string, actor = 'system'): Chief {
    const chief = this.get(id);
    if (!chief) throw new Error('Chief not found');
    if (chief.status !== 'active') throw new Error('Chief is not active, cannot pause');
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'UPDATE chiefs SET status = ?, pause_reason = ?, paused_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
    ).run('paused', reason, now, now, id, chief.version);
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
    appendAudit(this.db, 'chief', id, 'pause', { reason, previous_status: chief.status }, actor);
    const updated = this.get(id);
    if (!updated) throw new Error('Chief not found after pause');
    return updated;
  }

  /** 人類恢復暫停的 chief */
  resumeChief(id: string, actor: string): Chief {
    const chief = this.get(id);
    if (!chief) throw new Error('Chief not found');
    if (chief.status !== 'paused') throw new Error('CHIEF_NOT_PAUSED: chief must be paused to resume');
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'UPDATE chiefs SET status = ?, pause_reason = NULL, paused_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
    ).run('active', now, id, chief.version);
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
    appendAudit(this.db, 'chief', id, 'resume', { resumed_by: actor, previous_pause_reason: chief.pause_reason }, actor);
    const updated = this.get(id);
    if (!updated) throw new Error('Chief not found after resume');
    return updated;
  }

  // -----------------------------------------------------------------------
  // Run tracking methods (#231: stale heartbeat detection)
  // -----------------------------------------------------------------------

  /** 標記 chief 開始執行（idle -> running） */
  markRunning(id: string, runId: string, version: number): void {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE chiefs SET current_run_status = 'running', current_run_id = ?, last_heartbeat_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ).run(runId, now, now, id, version);
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
  }

  /** 標記 chief 執行完成（running -> idle），重置 timeout_count */
  markIdle(id: string, version: number): void {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE chiefs SET current_run_status = 'idle', current_run_id = NULL, timeout_count = 0, version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ).run(now, id, version);
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
  }

  /** 標記 chief 超時（running -> timeout），遞增 timeout_count */
  markTimeout(id: string, version: number): void {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE chiefs SET current_run_status = 'timeout', timeout_count = timeout_count + 1, version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ).run(now, id, version);
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
  }

  /** 更新心跳時間戳（adapter invoke 期間呼叫） */
  updateHeartbeat(id: string, version: number): void {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE chiefs SET last_heartbeat_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ).run(now, now, id, version);
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
  }

  /** 查詢 running 但心跳超時的 chiefs */
  getStaleRunning(thresholdMs: number): Chief[] {
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    const rows = this.db.prepare(
      "SELECT * FROM chiefs WHERE current_run_status = 'running' AND last_heartbeat_at < ? AND status = 'active'"
    ).all(cutoff) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * 解析 profile 預設值。
   * 如果指定 profile，使用 profile 的 personality 作為基礎，
   * 並將 profile 的 default_constraints 與用戶指定的 constraints 合併。
   * 只有用戶明確指定的 personality 欄位會覆蓋 profile 預設值。
   *
   * @param rawPersonality 用戶原始輸入的 personality 物件（Zod parse 前），
   *   用於判斷哪些欄位是用戶明確指定的。
   */
  private resolveProfileDefaults(
    profileName: ChiefProfileName | undefined,
    inputPersonality: ChiefPersonality,
    inputConstraints: ChiefConstraint[],
    rawPersonality?: Partial<ChiefPersonality>,
  ): { personality: ChiefPersonality; constraints: ChiefConstraint[] } {
    if (!profileName) {
      return { personality: inputPersonality, constraints: inputConstraints };
    }

    const profile = resolveProfile(profileName);

    // Profile personality 作為基底，只有用戶明確指定的欄位覆蓋
    // rawPersonality 代表用戶實際傳入的值（未經 Zod default）
    const explicitFields = rawPersonality ?? {};
    const personality: ChiefPersonality = {
      risk_tolerance: explicitFields.risk_tolerance ?? profile.personality.risk_tolerance,
      communication_style: explicitFields.communication_style ?? profile.personality.communication_style,
      decision_speed: explicitFields.decision_speed ?? profile.personality.decision_speed,
    };

    // 合併：用戶 constraints + profile default_constraints（去重）
    const existingDescs = new Set(inputConstraints.map(c => `${c.type}:${c.description}`));
    const mergedConstraints = [...inputConstraints];
    for (const dc of profile.default_constraints) {
      const key = `${dc.type}:${dc.description}`;
      if (!existingDescs.has(key)) {
        mergedConstraints.push(dc);
      }
    }

    return { personality, constraints: mergedConstraints };
  }

  /**
   * 驗證 Chief 是否有權執行治理動作（T2 governance action）
   * - Chief 必須 active
   * - Chief 必須有 dispatch_task 權限
   * - Constitution 必須 active
   * 回傳驗證後的 Chief + Constitution（供 route 層做 risk assessment）
   */
  validateGovernanceAction(chiefId: string, action: GovernanceActionInput): {
    chief: Chief;
    constitution: import('./constitution-store').Constitution;
  } {
    const chief = this.get(chiefId);
    if (!chief) throw new Error('Chief not found');
    if (chief.status !== 'active') throw new Error('CHIEF_INACTIVE: chief must be active to execute governance actions');

    if (!chief.permissions.includes('dispatch_task')) {
      throw new Error('PERMISSION_DENIED: chief lacks dispatch_task permission for governance actions');
    }

    const constitution = this.constitutionStore.getActive(chief.village_id);
    if (!constitution) throw new Error('No active constitution');

    // create_project 需要 project payload
    if (action.action_type === 'create_project' && !action.project) {
      throw new Error('VALIDATION: create_project action requires project payload');
    }

    // cancel_task / adjust_priority 需要 task_id
    if ((action.action_type === 'cancel_task' || action.action_type === 'adjust_priority') && !action.task_id) {
      throw new Error('VALIDATION: cancel_task and adjust_priority actions require task_id');
    }

    // adjust_priority 需要 priority
    if (action.action_type === 'adjust_priority' && action.priority === undefined) {
      throw new Error('VALIDATION: adjust_priority action requires priority');
    }

    return { chief, constitution };
  }

  // -----------------------------------------------------------------------
  // Config revision methods (#227: chief config versioning with rollback)
  // -----------------------------------------------------------------------

  /** 從 Chief 提取 config snapshot（排除 runtime/identity 欄位） */
  private extractConfigSnapshot(chief: Chief): ChiefConfigSnapshot {
    return {
      name: chief.name,
      role: chief.role,
      skills: chief.skills,
      pipelines: chief.pipelines,
      permissions: chief.permissions,
      personality: chief.personality,
      constraints: chief.constraints,
      profile: chief.profile,
      adapter_type: chief.adapter_type,
      context_mode: chief.context_mode,
      adapter_config: chief.adapter_config,
      budget_config: chief.budget_config,
      use_precedents: chief.use_precedents,
      precedent_config: chief.precedent_config,
    };
  }

  /** 存 config revision（update 成功後呼叫） */
  private saveRevision(chief: Chief, actor: string, reason?: string): string {
    const revisionId = `rev-${randomUUID()}`;
    const snapshot = this.extractConfigSnapshot(chief);
    this.db.prepare(`
      INSERT INTO chief_config_revisions (id, chief_id, version, config_snapshot, changed_by, change_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId,
      chief.id,
      chief.version,
      JSON.stringify(snapshot),
      actor,
      reason ?? null,
      new Date().toISOString(),
    );
    return revisionId;
  }

  /** 列出 chief 的版本歷史 */
  listRevisions(chiefId: string, limit = 50): ChiefConfigRevision[] {
    const rows = this.db.prepare(
      'SELECT * FROM chief_config_revisions WHERE chief_id = ? ORDER BY version DESC LIMIT ?'
    ).all(chiefId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.deserializeRevision(r));
  }

  /** 取得特定版本的 revision */
  getRevision(chiefId: string, version: number): ChiefConfigRevision | null {
    const row = this.db.prepare(
      'SELECT * FROM chief_config_revisions WHERE chief_id = ? AND version = ?'
    ).get(chiefId, version) as Record<string, unknown> | null;
    return row ? this.deserializeRevision(row) : null;
  }

  /** 回溯到某版本 — 建新 revision（append-only），不刪歷史 */
  rollbackToRevision(chiefId: string, version: number, actor: string): Chief {
    const revision = this.getRevision(chiefId, version);
    if (!revision) {
      throw new Error(`REVISION_NOT_FOUND: no revision at version ${version} for chief ${chiefId}`);
    }

    const snapshot = revision.config_snapshot;
    // 呼叫 update() 套用舊 config — 會自動觸發新 revision
    return this.update(
      chiefId,
      {
        name: snapshot.name,
        role: snapshot.role,
        skills: snapshot.skills,
        pipelines: snapshot.pipelines,
        permissions: snapshot.permissions,
        personality: snapshot.personality,
        constraints: snapshot.constraints,
        profile: snapshot.profile ?? undefined,
        adapter_type: snapshot.adapter_type,
        context_mode: snapshot.context_mode,
        adapter_config: snapshot.adapter_config,
        budget_config: snapshot.budget_config ?? undefined,
        use_precedents: snapshot.use_precedents,
        precedent_config: snapshot.precedent_config ?? undefined,
      },
      actor,
      `rollback to version ${version}`,
    );
  }

  private deserializeRevision(row: Record<string, unknown>): ChiefConfigRevision {
    const parsed = ChiefConfigRevisionRow.parse(row);
    return {
      id: parsed.id,
      chief_id: parsed.chief_id,
      version: parsed.version,
      config_snapshot: JSON.parse(parsed.config_snapshot) as ChiefConfigSnapshot,
      changed_by: parsed.changed_by ?? null,
      change_reason: parsed.change_reason ?? null,
      created_at: parsed.created_at,
    };
  }

  private validateSkillBindings(bindings: SkillBindingType[], villageId: string): void {
    for (const b of bindings) {
      const skill = this.skillRegistry.get(b.skill_id);
      if (!skill) throw new Error(`Skill ${b.skill_id} not found`);
      if (skill.status !== 'verified') {
        throw new Error(`SKILL_NOT_VERIFIED: "${skill.name}" is ${skill.status}, must be verified (THY-14)`);
      }
      if (skill.village_id && skill.village_id !== villageId) {
        // Check if skill is shared to this village via skill_shares
        const shareRow = this.db.prepare(`
          SELECT id FROM skill_shares
          WHERE skill_id = ? AND to_village_id = ? AND status = 'active'
        `).get(b.skill_id, villageId);
        if (!shareRow) {
          throw new Error(`Skill "${skill.name}" belongs to another village`);
        }
      }
    }
  }

  private deserialize(row: Record<string, unknown>): Chief {
    return {
      ...this.deserializeCore(row),
      ...this.deserializeExtended(row),
    };
  }

  private deserializeCore(row: Record<string, unknown>): Pick<Chief, 'id' | 'village_id' | 'name' | 'role' | 'role_type' | 'parent_chief_id' | 'version' | 'status' | 'skills' | 'pipelines' | 'permissions' | 'personality' | 'constraints' | 'profile' | 'created_at' | 'updated_at'> {
    const parsed = ChiefCoreRow.parse(row);
    return {
      id: parsed.id,
      village_id: parsed.village_id,
      name: parsed.name,
      role: parsed.role,
      role_type: (parsed.role_type as RoleType | null) ?? 'chief',
      parent_chief_id: parsed.parent_chief_id ?? null,
      version: parsed.version,
      status: parsed.status,
      skills: JSON.parse(parsed.skills || '[]') as Chief['skills'],
      pipelines: JSON.parse(parsed.pipelines || '[]') as string[],
      permissions: JSON.parse(parsed.permissions || '[]') as Chief['permissions'],
      personality: JSON.parse(parsed.personality || '{}') as Chief['personality'],
      constraints: JSON.parse(parsed.constraints || '[]') as Chief['constraints'],
      profile: (parsed.profile as ChiefProfileName | null) ?? null,
      created_at: parsed.created_at,
      updated_at: parsed.updated_at,
    };
  }

  private deserializeExtended(row: Record<string, unknown>): Pick<Chief, 'adapter_type' | 'context_mode' | 'adapter_config' | 'budget_config' | 'use_precedents' | 'precedent_config' | 'pause_reason' | 'paused_at' | 'last_heartbeat_at' | 'current_run_id' | 'current_run_status' | 'timeout_count'> {
    const parsed = ChiefExtendedRow.parse(row);
    return {
      adapter_type: (parsed.adapter_type as AdapterType | null) ?? 'local',
      context_mode: (parsed.context_mode as ContextMode | null) ?? 'fat',
      adapter_config: JSON.parse(parsed.adapter_config || '{}') as Record<string, unknown>,
      budget_config: parsed.budget_config ? JSON.parse(parsed.budget_config) as ChiefBudgetConfig : null,
      use_precedents: parsed.use_precedents === 1 || parsed.use_precedents === true,
      precedent_config: parsed.precedent_config ? JSON.parse(parsed.precedent_config) as PrecedentConfig : null,
      pause_reason: parsed.pause_reason ?? null,
      paused_at: parsed.paused_at ?? null,
      last_heartbeat_at: parsed.last_heartbeat_at ?? null,
      current_run_id: parsed.current_run_id ?? null,
      current_run_status: (parsed.current_run_status as Chief['current_run_status'] | null) ?? 'idle',
      timeout_count: parsed.timeout_count ?? 0,
    };
  }
}

/**
 * Build a complete system prompt from Chief config + Skills.
 * Optionally includes goal hierarchy context (issue #225).
 */
export function buildChiefPrompt(chief: Chief, skillRegistry: SkillRegistry, goals?: GoalWithAncestry[]): string {
  const lines: string[] = [];

  lines.push(`You are "${chief.name}", a ${chief.role}.`);
  lines.push('');

  // Profile 描述（如果有）
  if (chief.profile) {
    const profile = CHIEF_PROFILES.get(chief.profile);
    if (profile) {
      lines.push(`## Profile: ${profile.name}`);
      lines.push(profile.description);
      lines.push('');
    }
  }

  // Personality
  const p = chief.personality;
  const personalityMap: Record<string, Record<string, string>> = {
    risk_tolerance: {
      conservative: 'You are risk-averse. When in doubt, choose the safer option.',
      moderate: 'You balance risk and reward. Take calculated risks when evidence supports them.',
      aggressive: 'You are willing to take calculated risks for better outcomes.',
    },
    communication_style: {
      concise: 'Be concise and direct. Lead with conclusions.',
      detailed: 'Provide thorough explanations with evidence.',
      minimal: 'Only communicate essential information.',
    },
    decision_speed: {
      fast: 'Make decisions quickly. Bias toward action.',
      deliberate: 'Take time to consider options. Balance speed with thoroughness.',
      cautious: 'Be thorough and methodical. Double-check before acting.',
    },
  };

  lines.push('## Personality');
  lines.push(personalityMap.risk_tolerance[p.risk_tolerance]);
  lines.push(personalityMap.communication_style[p.communication_style]);
  lines.push(personalityMap.decision_speed[p.decision_speed]);
  lines.push('');

  // Constraints
  if (chief.constraints.length > 0) {
    lines.push('## Constraints');
    const prefixMap = {
      must: 'You MUST',
      must_not: 'You MUST NOT',
      prefer: 'You should prefer to',
      avoid: 'You should avoid',
    };
    for (const c of chief.constraints) {
      lines.push(`- ${prefixMap[c.type]}: ${c.description}`);
    }
    lines.push('');
  }

  // Skills
  if (chief.skills.length > 0) {
    const skillPrompt = buildSkillPrompt(chief.skills, skillRegistry);
    if (skillPrompt) {
      lines.push('## Skills');
      lines.push(skillPrompt);
    }
  }

  // Pipelines
  if (chief.pipelines.length > 0) {
    lines.push('## Pipelines');
    lines.push('You are bound to the following execution pipelines:');
    for (const pipeline of chief.pipelines) {
      lines.push(`- ${pipeline}`);
    }
    lines.push('');
  }

  // Goals (issue #225)
  if (goals && goals.length > 0) {
    lines.push('## Goals');
    for (const { goal, ancestry } of goals) {
      const ancestors = ancestry.slice(1).reverse();
      for (let i = 0; i < ancestors.length; i++) {
        const indent = '  '.repeat(i);
        const ancestor = ancestors[i];
        const metricStr = ancestor.metrics.length > 0
          ? ` (${ancestor.metrics.map((m: GoalWithAncestry['goal']['metrics'][number]) => `${m.name}: ${m.current ?? '?'}/${m.target}${m.unit}`).join(', ')})`
          : '';
        lines.push(`${indent}${ancestor.level} goal: ${ancestor.title}${metricStr}`);
      }
      const myIndent = '  '.repeat(ancestors.length);
      const myMetricStr = goal.metrics.length > 0
        ? ` (${goal.metrics.map((m: GoalWithAncestry['goal']['metrics'][number]) => `${m.name}: ${m.current ?? '?'}/${m.target}${m.unit}`).join(', ')})`
        : '';
      lines.push(`${myIndent}-> My goal: ${goal.title}${myMetricStr}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
