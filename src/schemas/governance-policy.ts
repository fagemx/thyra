import { z } from 'zod';

// governance.policy.v1 — Thyra 下發策略給 Karvi (budget, permissions, risk thresholds)

export const PolicyTypeEnum = z.enum([
  'budget_limits',
  'permissions_update',
  'risk_threshold',
]);

export type PolicyType = z.infer<typeof PolicyTypeEnum>;

export const BudgetLimitsPayload = z.object({
  max_cost_per_action: z.number().nonnegative(),
  max_cost_per_day: z.number().nonnegative(),
  max_cost_per_loop: z.number().nonnegative(),
});

export const GovernancePolicyPayload = z.object({
  budget_limits: BudgetLimitsPayload.optional(),
  allowed_permissions: z.array(z.string()).optional(),
  risk_thresholds: z.record(z.unknown()).optional(),
});

export const GovernancePolicySchema = z.object({
  version: z.literal('governance.policy.v1'),
  event_id: z.string().startsWith('evt_'),
  occurred_at: z.string(),
  source_village_id: z.string().min(1),
  policy_type: PolicyTypeEnum,
  payload: GovernancePolicyPayload,
});

export type GovernancePolicy = z.infer<typeof GovernancePolicySchema>;
export type GovernancePolicyPayload = z.infer<typeof GovernancePolicyPayload>;
export type BudgetLimitsPayload = z.infer<typeof BudgetLimitsPayload>;

// --- Helper: 建立 governance policy event ---

let counter = 0;

function generateEventId(): string {
  const ts = Date.now().toString(36);
  counter += 1;
  const seq = counter.toString(36).padStart(4, '0');
  return `evt_${ts}_${seq}`;
}

export interface CreateGovernancePolicyOptions {
  source_village_id: string;
  policy_type: PolicyType;
  payload: z.input<typeof GovernancePolicyPayload>;
}

export function createGovernancePolicy(
  opts: CreateGovernancePolicyOptions,
): GovernancePolicy {
  const event: GovernancePolicy = {
    version: 'governance.policy.v1',
    event_id: generateEventId(),
    occurred_at: new Date().toISOString(),
    source_village_id: opts.source_village_id,
    policy_type: opts.policy_type,
    payload: GovernancePolicyPayload.parse(opts.payload),
  };
  // 用 schema 驗證確保正確
  return GovernancePolicySchema.parse(event);
}
