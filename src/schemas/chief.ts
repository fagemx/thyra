import { z } from 'zod';
import { PermissionEnum } from './constitution';
import type { Permission } from './constitution';
import { AdapterTypeEnum, ContextModeEnum } from './heartbeat';

/** Chief 角色類型：chief（治理者）或 worker（純執行者） */
export const RoleTypeEnum = z.enum(['chief', 'worker']);
export type RoleType = z.infer<typeof RoleTypeEnum>;

/** 治理相關權限 — worker 不可擁有 */
export const GOVERNANCE_PERMISSIONS: readonly Permission[] = ['propose_law', 'enact_law_low'] as const;

const SkillBindingInput = z.object({
  skill_id: z.string(),
  skill_version: z.number().int().positive(),
  config: z.record(z.unknown()).optional(),
});

export const ChiefPersonalityInput = z.object({
  risk_tolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  communication_style: z.enum(['concise', 'detailed', 'minimal']).default('concise'),
  decision_speed: z.enum(['fast', 'deliberate', 'cautious']).default('deliberate'),
});

const ChiefConstraintInput = z.object({
  type: z.enum(['must', 'must_not', 'prefer', 'avoid']),
  description: z.string().min(1),
});

/** 預設 profile 名稱 — 可插拔的人格模版 */
export const ChiefProfileNameEnum = z.enum([
  'conservative',
  'aggressive',
  'balanced',
  'analyst',
  'executor',
]);

/** ChiefProfile 定義：人格模版，包含 personality 預設值 + 預設 constraints + 描述 */
export const ChiefProfileSchema = z.object({
  name: ChiefProfileNameEnum,
  description: z.string(),
  personality: ChiefPersonalityInput,
  default_constraints: z.array(ChiefConstraintInput).default([]),
});

/** Chief 月預算配置 — Chief 個人月預算上限（需 <= Constitution max_cost_per_month） */
export const ChiefBudgetConfigInput = z.object({
  max_monthly: z.number().min(0).optional(),
  budget_reset_day: z.number().int().min(1).max(28).default(1),
});

export type ChiefBudgetConfig = z.infer<typeof ChiefBudgetConfigInput>;

/** Precedent query 配置 — 控制 Edda 先例查詢行為 (#222) */
export const PrecedentConfigInput = z.object({
  /** 最大先例數量（預設 3） */
  max_precedents: z.number().int().min(1).max(20).default(3),
  /** 回溯天數（預設 30，client-side 過濾） */
  lookback_days: z.number().int().min(1).max(365).default(30),
  /** 查詢 domain 過濾（預設使用 chief.role） */
  domain_filter: z.string().min(1).max(100).optional(),
});

export type PrecedentConfig = z.infer<typeof PrecedentConfigInput>;

export const CreateChiefInput = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(500),
  /** 角色類型：chief（預設，有治理權）或 worker（純執行，無 propose 權限） */
  role_type: RoleTypeEnum.default('chief'),
  /** 上級 chief ID — worker 必須指定 parent chief */
  parent_chief_id: z.string().optional(),
  skills: z.array(SkillBindingInput).default([]),
  pipelines: z.array(z.string().min(1).max(100)).default([]),
  permissions: z.array(PermissionEnum).default([]),
  personality: ChiefPersonalityInput.default({}),
  constraints: z.array(ChiefConstraintInput).default([]),
  profile: ChiefProfileNameEnum.optional(),
  /** Adapter 類型 — 決定由哪種 adapter 處理此 chief 的心跳 */
  adapter_type: AdapterTypeEnum.default('local'),
  /** Context 傳遞模式 — fat 或 thin */
  context_mode: ContextModeEnum.default('fat'),
  /** Adapter 專屬設定（如 HTTP endpoint URL） */
  adapter_config: z.record(z.unknown()).default({}),
  budget_config: ChiefBudgetConfigInput.optional(),
  /** 是否查詢 Edda 先例來輔助決策（預設 false） (#222) */
  use_precedents: z.boolean().default(false),
  /** 先例查詢配置（use_precedents = true 時生效） (#222) */
  precedent_config: PrecedentConfigInput.optional(),
});

export const UpdateChiefInput = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().min(1).max(500).optional(),
  skills: z.array(SkillBindingInput).optional(),
  pipelines: z.array(z.string().min(1).max(100)).optional(),
  permissions: z.array(PermissionEnum).optional(),
  personality: ChiefPersonalityInput.optional(),
  constraints: z.array(ChiefConstraintInput).optional(),
  profile: ChiefProfileNameEnum.optional(),
  adapter_type: AdapterTypeEnum.optional(),
  context_mode: ContextModeEnum.optional(),
  adapter_config: z.record(z.unknown()).optional(),
  budget_config: ChiefBudgetConfigInput.optional(),
  use_precedents: z.boolean().optional(),
  precedent_config: PrecedentConfigInput.optional(),
});

/**
 * T2 Governance Action — Chief 透過 KarviBridge 執行治理動作
 * 例如建立 project/tasks、調整優先級等
 */
export const GovernanceActionInput = z.object({
  /** 動作類型 */
  action_type: z.enum(['create_project', 'adjust_priority', 'cancel_task']),
  /** 動作描述（用於 risk assessment + audit） */
  description: z.string().min(1).max(1000),
  /** 預估成本（用於 budget check） */
  estimated_cost: z.number().min(0).default(1),
  /** 回滾計畫（SI-3 要求） */
  rollback_plan: z.string().min(1).max(1000),
  /** create_project 的 payload */
  project: z.object({
    title: z.string().min(1),
    repo: z.string().optional(),
    tasks: z.array(z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      depends: z.array(z.string()).optional(),
    })).min(1),
  }).optional(),
  /** adjust_priority / cancel_task 的 target task id */
  task_id: z.string().optional(),
  /** adjust_priority 的新優先級 */
  priority: z.number().int().min(0).max(100).optional(),
});

export type GovernanceActionInput = z.infer<typeof GovernanceActionInput>;
export type GovernanceActionInputRaw = z.input<typeof GovernanceActionInput>;

export type ChiefPersonality = z.infer<typeof ChiefPersonalityInput>;
export type ChiefProfileName = z.infer<typeof ChiefProfileNameEnum>;
export type ChiefProfile = z.infer<typeof ChiefProfileSchema>;
export type CreateChiefInputRaw = z.input<typeof CreateChiefInput>;
export type CreateChiefInput = z.infer<typeof CreateChiefInput>;
export type UpdateChiefInput = z.infer<typeof UpdateChiefInput>;
