import { z } from 'zod';

export const PermissionEnum = z.enum([
  'dispatch_task', 'propose_law', 'enact_law_low',
  'query_edda', 'modify_chief', 'create_branch',
  'merge_pr', 'deploy', 'spend_budget', 'cross_village',
]);

const ConstitutionRuleInput = z.object({
  id: z.string().optional(),
  description: z.string().min(1),
  enforcement: z.enum(['hard', 'soft']),
  scope: z.array(z.string()).default(['*']),
});

const BudgetLimitsInput = z.object({
  max_cost_per_action: z.number().min(0).default(10),
  max_cost_per_day: z.number().min(0).default(100),
  max_cost_per_loop: z.number().min(0).default(50),
  max_cost_per_month: z.number().min(0).default(0), // 0 = unlimited
});

export const CreateConstitutionInput = z.object({
  rules: z.array(ConstitutionRuleInput).min(1),
  allowed_permissions: z.array(PermissionEnum).min(1),
  budget_limits: BudgetLimitsInput.default({}),
});

export type Permission = z.infer<typeof PermissionEnum>;
export type ConstitutionRuleInput = z.infer<typeof ConstitutionRuleInput>;
export type BudgetLimitsInput = z.infer<typeof BudgetLimitsInput>;
export type CreateConstitutionInputRaw = z.input<typeof CreateConstitutionInput>;
export type CreateConstitutionInput = z.infer<typeof CreateConstitutionInput>;
