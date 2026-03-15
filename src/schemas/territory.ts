import { z } from 'zod';

export const CreateTerritoryInput = z.object({
  name: z.string().min(1).max(100),
  village_ids: z.array(z.string().min(1)).min(2),
});

export type CreateTerritoryInputRaw = z.input<typeof CreateTerritoryInput>;
export type CreateTerritoryInput = z.infer<typeof CreateTerritoryInput>;

export const AgreementType = z.enum(['resource_sharing', 'law_template', 'chief_lending', 'budget_pool']);

export const CreateAgreementInput = z.object({
  type: AgreementType,
  parties: z.array(z.string().min(1)).min(2),
  terms: z.record(z.unknown()).default({}),
});

export type CreateAgreementInputRaw = z.input<typeof CreateAgreementInput>;
export type CreateAgreementInput = z.infer<typeof CreateAgreementInput>;

export const ShareSkillInput = z.object({
  skill_id: z.string().min(1),
  from_village_id: z.string().min(1),
  to_village_id: z.string().min(1),
});

export const ApproveAgreementInput = z.object({
  village_id: z.string().min(1),
});

export type ShareSkillInputRaw = z.input<typeof ShareSkillInput>;
export type ShareSkillInput = z.infer<typeof ShareSkillInput>;
export type ApproveAgreementInput = z.infer<typeof ApproveAgreementInput>;

// === Territory Policy ===

export const CreateTerritoryPolicyInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  enforcement: z.enum(['hard', 'soft']).default('soft'),
  scope: z.array(z.string().min(1)).default(['*']),
});

export type CreateTerritoryPolicyInputRaw = z.input<typeof CreateTerritoryPolicyInput>;
export type CreateTerritoryPolicyInput = z.infer<typeof CreateTerritoryPolicyInput>;

// === Territory Metrics Query ===

export const TerritoryMetricsQueryInput = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type TerritoryMetricsQueryInput = z.infer<typeof TerritoryMetricsQueryInput>;

// === Territory Audit Query ===

export const TerritoryAuditQueryInput = z.object({
  action: z.string().optional(),
  actor: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type TerritoryAuditQueryInput = z.infer<typeof TerritoryAuditQueryInput>;

// === Add/Remove Village ===

export const AddVillageInput = z.object({
  village_id: z.string().min(1),
});

export type AddVillageInputRaw = z.input<typeof AddVillageInput>;
export type AddVillageInput = z.infer<typeof AddVillageInput>;
