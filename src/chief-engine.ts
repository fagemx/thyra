import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import { CreateChiefInput as CreateChiefSchema } from './schemas/chief';
import type { CreateChiefInputRaw, UpdateChiefInput, ChiefPersonality, ChiefProfile, ChiefProfileName, GovernanceActionInput, ChiefBudgetConfig } from './schemas/chief';
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

export interface Chief {
  id: string;
  village_id: string;
  name: string;
  role: string;
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

    // THY-09: permissions ⊆ constitution.allowed_permissions
    for (const perm of input.permissions) {
      if (!constitution.allowed_permissions.includes(perm)) {
        throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}" not in constitution's allowed_permissions`);
      }
    }

    // THY-14: only verified skills
    this.validateSkillBindings(input.skills, villageId);

    // THY-09 pattern: Chief budget_config.max_monthly <= Constitution max_cost_per_month
    if (input.budget_config?.max_monthly !== undefined && constitution.budget_limits.max_cost_per_month > 0) {
      if (input.budget_config.max_monthly > constitution.budget_limits.max_cost_per_month) {
        throw new Error(`BUDGET_EXCEEDS_CONSTITUTION: chief max_monthly (${input.budget_config.max_monthly}) exceeds constitution max_cost_per_month (${constitution.budget_limits.max_cost_per_month})`);
      }
    }

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
      pause_reason: null,
      paused_at: null,
      last_heartbeat_at: null,
      current_run_id: null,
      current_run_status: 'idle',
      timeout_count: 0,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO chiefs (id, village_id, name, role, version, status, skills, pipelines, permissions, personality, constraints, profile, adapter_type, context_mode, adapter_config, budget_config, pause_reason, paused_at, last_heartbeat_at, current_run_id, current_run_status, timeout_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chief.id, villageId, chief.name, chief.role, chief.version, chief.status,
      JSON.stringify(chief.skills), JSON.stringify(chief.pipelines),
      JSON.stringify(chief.permissions),
      JSON.stringify(chief.personality), JSON.stringify(chief.constraints),
      chief.profile, chief.adapter_type, chief.context_mode,
      JSON.stringify(chief.adapter_config),
      chief.budget_config ? JSON.stringify(chief.budget_config) : null,
      chief.pause_reason, chief.paused_at,
      chief.last_heartbeat_at, chief.current_run_id, chief.current_run_status, chief.timeout_count,
      chief.created_at, chief.updated_at,
    );

    appendAudit(this.db, 'chief', chief.id, 'create', chief, actor);
    return chief;
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

  update(id: string, input: UpdateChiefInput, actor: string): Chief {
    const existing = this.get(id);
    if (!existing) throw new Error('Chief not found');

    if (input.permissions) {
      const constitution = this.constitutionStore.getActive(existing.village_id);
      if (!constitution) throw new Error('No active constitution');
      for (const perm of input.permissions) {
        if (!constitution.allowed_permissions.includes(perm)) {
          throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}"`);
        }
      }
    }

    if (input.skills) {
      this.validateSkillBindings(input.skills, existing.village_id);
    }

    // 解析 profile 更新：profile 變更時重新計算 personality/constraints
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

    const now = new Date().toISOString();
    const updated: Chief = {
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
      personality: resolvedPersonality,
      constraints: resolvedConstraints,
      profile: resolvedProfile,
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE chiefs SET name=?, role=?, version=?, skills=?, pipelines=?, permissions=?,
        personality=?, constraints=?, profile=?, adapter_type=?, context_mode=?, adapter_config=?,
        budget_config=?, pause_reason=?, paused_at=?,
        updated_at=? WHERE id=? AND version=?
    `).run(
      updated.name, updated.role, updated.version,
      JSON.stringify(updated.skills), JSON.stringify(updated.pipelines),
      JSON.stringify(updated.permissions),
      JSON.stringify(updated.personality), JSON.stringify(updated.constraints),
      updated.profile, updated.adapter_type, updated.context_mode,
      JSON.stringify(updated.adapter_config),
      updated.budget_config ? JSON.stringify(updated.budget_config) : null,
      updated.pause_reason, updated.paused_at,
      now, id, existing.version,
    );
    if ((result as { changes: number }).changes === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    appendAudit(this.db, 'chief', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  deactivate(id: string, actor: string): void {
    const chief = this.get(id);
    if (!chief) throw new Error('Chief not found');
    const result = this.db.prepare('UPDATE chiefs SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run('inactive', new Date().toISOString(), id, chief.version);
    if ((result as { changes: number }).changes === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
    appendAudit(this.db, 'chief', id, 'deactivate', { previous_status: chief.status }, actor);
  }

  /** 自動暫停 chief（月預算超限） */
  pauseChief(id: string, reason: string): Chief {
    const chief = this.get(id);
    if (!chief) throw new Error('Chief not found');
    if (chief.status !== 'active') throw new Error('Chief is not active, cannot pause');
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'UPDATE chiefs SET status = ?, pause_reason = ?, paused_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
    ).run('paused', reason, now, now, id, chief.version);
    if ((result as { changes: number }).changes === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }
    appendAudit(this.db, 'chief', id, 'pause', { reason, previous_status: chief.status }, 'system');
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
    if ((result as { changes: number }).changes === 0) {
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
  markRunning(id: string, runId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE chiefs SET current_run_status = 'running', current_run_id = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
    ).run(runId, now, now, id);
  }

  /** 標記 chief 執行完成（running -> idle），重置 timeout_count */
  markIdle(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE chiefs SET current_run_status = 'idle', current_run_id = NULL, timeout_count = 0, updated_at = ? WHERE id = ?"
    ).run(now, id);
  }

  /** 標記 chief 超時（running -> timeout），遞增 timeout_count */
  markTimeout(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE chiefs SET current_run_status = 'timeout', timeout_count = timeout_count + 1, updated_at = ? WHERE id = ?"
    ).run(now, id);
  }

  /** 更新心跳時間戳（adapter invoke 期間呼叫） */
  updateHeartbeat(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE chiefs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, id);
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
      id: row.id as string,
      village_id: row.village_id as string,
      name: row.name as string,
      role: row.role as string,
      version: row.version as number,
      status: row.status as Chief['status'],
      skills: JSON.parse((row.skills as string) || '[]') as Chief['skills'],
      pipelines: JSON.parse((row.pipelines as string) || '[]') as string[],
      permissions: JSON.parse((row.permissions as string) || '[]') as Chief['permissions'],
      personality: JSON.parse((row.personality as string) || '{}') as Chief['personality'],
      constraints: JSON.parse((row.constraints as string) || '[]') as Chief['constraints'],
      profile: (row.profile as ChiefProfileName | null) ?? null,
      adapter_type: (row.adapter_type as AdapterType | null) ?? 'local',
      context_mode: (row.context_mode as ContextMode | null) ?? 'fat',
      adapter_config: JSON.parse((row.adapter_config as string) || '{}') as Record<string, unknown>,
      budget_config: row.budget_config ? JSON.parse(row.budget_config as string) as ChiefBudgetConfig : null,
      pause_reason: (row.pause_reason as string | null) ?? null,
      paused_at: (row.paused_at as string | null) ?? null,
      last_heartbeat_at: (row.last_heartbeat_at as string | null) ?? null,
      current_run_id: (row.current_run_id as string | null) ?? null,
      current_run_status: (row.current_run_status as Chief['current_run_status'] | null) ?? 'idle',
      timeout_count: (row.timeout_count as number | null) ?? 0,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
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
