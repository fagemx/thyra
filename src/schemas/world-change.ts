import { z } from 'zod';
import { CreateConstitutionInput } from './constitution';
import { ProposeLawInput } from './law';
import { CreateChiefInput, UpdateChiefInput } from './chief';
import { CreateSkillInput } from './skill';
import { randomUUID } from 'crypto';

// --- RollbackPlan: 結構化回滾計畫 ---

export const RollbackPlanReversibleSchema = z.object({
  strategy: z.literal('reversible'),
  reverse_change_type: z.string().min(1),
  description: z.string().min(1),
});

export const RollbackPlanSupersedeSchema = z.object({
  strategy: z.literal('supersede'),
  description: z.string().min(1),
});

export const RollbackPlanIrreversibleSchema = z.object({
  strategy: z.literal('irreversible'),
  reason: z.string().min(1),
});

export const RollbackPlanNoopSchema = z.object({
  strategy: z.literal('noop'),
});

export const RollbackPlanSchema = z.discriminatedUnion('strategy', [
  RollbackPlanReversibleSchema,
  RollbackPlanSupersedeSchema,
  RollbackPlanIrreversibleSchema,
  RollbackPlanNoopSchema,
]);

export type RollbackPlan = z.infer<typeof RollbackPlanSchema>;

// --- ChangeMetadata: 共用 metadata ---

export const ChangeMetadataSchema = z.object({
  change_id: z.string().regex(/^chg_/, 'change_id must start with chg_'),
  village_id: z.string().min(1),
  proposed_by: z.string().min(1),
  proposed_at: z.string().datetime(),
  description: z.string().min(1),
  estimated_cost: z.number().min(0),
  rollback_plan: RollbackPlanSchema,
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;

// --- WorldChange 各 variant 的 change_type 常數 ---

export const CHANGE_TYPES = [
  'constitution.create',
  'constitution.supersede',
  'constitution.revoke',
  'law.propose',
  'law.approve',
  'law.revoke',
  'law.rollback',
  'chief.create',
  'chief.update',
  'chief.deactivate',
  'skill.register',
  'skill.verify',
  'skill.deprecate',
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

// --- Constitution changes ---

export const ConstitutionCreateChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('constitution.create'),
  payload: CreateConstitutionInput,
});

export const ConstitutionSupersedeChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('constitution.supersede'),
  payload: z.object({
    old_id: z.string().min(1),
    new_input: CreateConstitutionInput,
  }),
});

export const ConstitutionRevokeChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('constitution.revoke'),
  payload: z.object({
    constitution_id: z.string().min(1),
  }),
});

// --- Law changes ---

export const LawProposeChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('law.propose'),
  payload: z.object({
    chief_id: z.string().min(1),
    input: ProposeLawInput,
  }),
});

export const LawApproveChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('law.approve'),
  payload: z.object({
    law_id: z.string().min(1),
  }),
});

export const LawRevokeChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('law.revoke'),
  payload: z.object({
    law_id: z.string().min(1),
  }),
});

export const LawRollbackChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('law.rollback'),
  payload: z.object({
    law_id: z.string().min(1),
    reason: z.string().min(1),
  }),
});

// --- Chief changes ---

export const ChiefCreateChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('chief.create'),
  payload: CreateChiefInput,
});

export const ChiefUpdateChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('chief.update'),
  payload: z.object({
    chief_id: z.string().min(1),
    updates: UpdateChiefInput,
  }),
});

export const ChiefDeactivateChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('chief.deactivate'),
  payload: z.object({
    chief_id: z.string().min(1),
  }),
});

// --- Skill changes ---

export const SkillRegisterChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('skill.register'),
  payload: CreateSkillInput,
});

export const SkillVerifyChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('skill.verify'),
  payload: z.object({
    skill_id: z.string().min(1),
  }),
});

export const SkillDeprecateChangeSchema = ChangeMetadataSchema.extend({
  change_type: z.literal('skill.deprecate'),
  payload: z.object({
    skill_id: z.string().min(1),
  }),
});

// --- WorldChange discriminated union ---

export const WorldChangeSchema = z.discriminatedUnion('change_type', [
  ConstitutionCreateChangeSchema,
  ConstitutionSupersedeChangeSchema,
  ConstitutionRevokeChangeSchema,
  LawProposeChangeSchema,
  LawApproveChangeSchema,
  LawRevokeChangeSchema,
  LawRollbackChangeSchema,
  ChiefCreateChangeSchema,
  ChiefUpdateChangeSchema,
  ChiefDeactivateChangeSchema,
  SkillRegisterChangeSchema,
  SkillVerifyChangeSchema,
  SkillDeprecateChangeSchema,
]);

export type WorldChange = z.infer<typeof WorldChangeSchema>;

// --- Per-variant types ---

export type ConstitutionCreateChange = z.infer<typeof ConstitutionCreateChangeSchema>;
export type ConstitutionSupersedeChange = z.infer<typeof ConstitutionSupersedeChangeSchema>;
export type ConstitutionRevokeChange = z.infer<typeof ConstitutionRevokeChangeSchema>;
export type LawProposeChange = z.infer<typeof LawProposeChangeSchema>;
export type LawApproveChange = z.infer<typeof LawApproveChangeSchema>;
export type LawRevokeChange = z.infer<typeof LawRevokeChangeSchema>;
export type LawRollbackChange = z.infer<typeof LawRollbackChangeSchema>;
export type ChiefCreateChange = z.infer<typeof ChiefCreateChangeSchema>;
export type ChiefUpdateChange = z.infer<typeof ChiefUpdateChangeSchema>;
export type ChiefDeactivateChange = z.infer<typeof ChiefDeactivateChangeSchema>;
export type SkillRegisterChange = z.infer<typeof SkillRegisterChangeSchema>;
export type SkillVerifyChange = z.infer<typeof SkillVerifyChangeSchema>;
export type SkillDeprecateChange = z.infer<typeof SkillDeprecateChangeSchema>;

// --- Helper: 自動產生 change_id + proposed_at ---

/**
 * 建立 WorldChange，自動填入 change_id 和 proposed_at。
 * 呼叫者只需提供 change_type-specific 欄位。
 */
export function createWorldChange(
  fields: Omit<WorldChange, 'change_id' | 'proposed_at'> & {
    change_id?: string;
    proposed_at?: string;
  },
): WorldChange {
  const change = {
    ...fields,
    change_id: fields.change_id ?? `chg_${randomUUID()}`,
    proposed_at: fields.proposed_at ?? new Date().toISOString(),
  };
  // validate 產出物
  return WorldChangeSchema.parse(change);
}
