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

export type ShareSkillInputRaw = z.input<typeof ShareSkillInput>;
export type ShareSkillInput = z.infer<typeof ShareSkillInput>;
