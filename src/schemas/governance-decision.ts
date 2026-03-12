import { z } from 'zod';

// governance.decision.v1 — Thyra ↔ Edda 決策記錄格式

export const DecisionTypeEnum = z.enum([
  'law_enacted',
  'law_repealed',
  'chief_assigned',
  'risk_override',
  'budget_adjusted',
  'territory_created',
]);

export type DecisionType = z.infer<typeof DecisionTypeEnum>;

export const GovernanceDecisionSchema = z.object({
  version: z.literal('governance.decision.v1'),
  event_id: z.string().regex(/^evt_/, 'event_id must start with evt_ prefix'),
  occurred_at: z.string().datetime({ message: 'occurred_at must be ISO 8601 timestamp' }),
  village_id: z.string().min(1),
  decision_type: DecisionTypeEnum,
  domain: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
  reason: z.string().optional(),
  refs: z.array(z.string()).optional(),
});

export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;

/** 產生 evt_ 前綴的唯一 ID */
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `evt_${timestamp}_${random}`;
}

/** 建立一筆合法的 governance decision 事件 */
export function createGovernanceDecision(
  input: Omit<GovernanceDecision, 'version' | 'event_id' | 'occurred_at'> & {
    event_id?: string;
    occurred_at?: string;
  },
): GovernanceDecision {
  const record: GovernanceDecision = {
    version: 'governance.decision.v1',
    event_id: input.event_id ?? generateEventId(),
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    village_id: input.village_id,
    decision_type: input.decision_type,
    domain: input.domain,
    key: input.key,
    value: input.value,
    reason: input.reason,
    refs: input.refs,
  };

  // 用 Zod 驗證，確保產出的事件一定合法
  return GovernanceDecisionSchema.parse(record);
}
