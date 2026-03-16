/**
 * WorldChange — 13 種世界狀態變更操作的 Zod discriminated union。
 *
 * 每個 variant 代表一個原子性的治理變更，用於 applyChange / judgeChange 管線。
 */
import { z } from 'zod';
import { PermissionEnum } from './constitution';

// ---------------------------------------------------------------------------
// 13 WorldChange variants
// ---------------------------------------------------------------------------

const ConstitutionSupersedeChange = z.object({
  type: z.literal('constitution.supersede'),
  rules: z.array(z.object({
    id: z.string().optional(),
    description: z.string().min(1),
    enforcement: z.enum(['hard', 'soft']),
    scope: z.array(z.string()).default(['*']),
  })).min(1),
  allowed_permissions: z.array(PermissionEnum).min(1),
  budget_limits: z.object({
    max_cost_per_action: z.number().min(0),
    max_cost_per_day: z.number().min(0),
    max_cost_per_loop: z.number().min(0),
    max_cost_per_month: z.number().min(0).default(0),
  }),
  actor: z.string(),
});

const LawProposeChange = z.object({
  type: z.literal('law.propose'),
  proposed_by: z.string(),
  category: z.string(),
  content: z.record(z.unknown()),
  risk_level: z.enum(['low', 'medium', 'high']),
});

const LawEnactChange = z.object({
  type: z.literal('law.enact'),
  law_id: z.string(),
  approved_by: z.string(),
});

const LawRepealChange = z.object({
  type: z.literal('law.repeal'),
  law_id: z.string(),
  actor: z.string(),
});

const ChiefAppointChange = z.object({
  type: z.literal('chief.appoint'),
  name: z.string(),
  role: z.string(),
  permissions: z.array(PermissionEnum),
  skills: z.array(z.string()).default([]),
  personality: z.object({
    risk_tolerance: z.enum(['conservative', 'moderate', 'aggressive']),
    communication_style: z.enum(['concise', 'detailed', 'minimal']),
    decision_speed: z.enum(['fast', 'deliberate', 'cautious']),
  }).optional(),
});

const ChiefDismissChange = z.object({
  type: z.literal('chief.dismiss'),
  chief_id: z.string(),
  actor: z.string(),
});

const ChiefUpdatePermissionsChange = z.object({
  type: z.literal('chief.update_permissions'),
  chief_id: z.string(),
  permissions: z.array(PermissionEnum),
});

const SkillRegisterChange = z.object({
  type: z.literal('skill.register'),
  name: z.string(),
  definition: z.object({
    description: z.string(),
    prompt_template: z.string(),
    tools_required: z.array(z.string()),
    constraints: z.array(z.string()),
    examples: z.array(z.unknown()),
  }),
});

const SkillRevokeChange = z.object({
  type: z.literal('skill.revoke'),
  skill_id: z.string(),
  actor: z.string(),
});

const BudgetAdjustChange = z.object({
  type: z.literal('budget.adjust'),
  max_cost_per_action: z.number().min(0).optional(),
  max_cost_per_day: z.number().min(0).optional(),
  max_cost_per_loop: z.number().min(0).optional(),
});

const CycleStartChange = z.object({
  type: z.literal('cycle.start'),
  chief_id: z.string(),
  trigger: z.enum(['manual', 'scheduled', 'event']),
  max_iterations: z.number().min(1).default(10),
  timeout_ms: z.number().min(1000).default(30000),
});

const CycleEndChange = z.object({
  type: z.literal('cycle.end'),
  cycle_id: z.string(),
  reason: z.string().optional(),
});

const VillageUpdateChange = z.object({
  type: z.literal('village.update'),
  name: z.string().optional(),
  description: z.string().optional(),
  target_repo: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const WorldChangeSchema = z.discriminatedUnion('type', [
  ConstitutionSupersedeChange,
  LawProposeChange,
  LawEnactChange,
  LawRepealChange,
  ChiefAppointChange,
  ChiefDismissChange,
  ChiefUpdatePermissionsChange,
  SkillRegisterChange,
  SkillRevokeChange,
  BudgetAdjustChange,
  CycleStartChange,
  CycleEndChange,
  VillageUpdateChange,
]);

export type WorldChange = z.infer<typeof WorldChangeSchema>;
