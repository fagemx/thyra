import { z } from 'zod';

// CONTRACT PROMO-03: originalHandoffId always populated — z.string() required, not optional
export const PromotionRollbackMemoSchema = z.object({
  id: z.string(),
  originalHandoffId: z.string(),
  fromLayer: z.enum(['project-plan', 'thyra-runtime']),
  toLayer: z.literal('arch-spec'),

  reason: z.string(),
  discoveredProblems: z.array(z.string()),
  specsNeedingReview: z.array(z.string()),
  whatStillValid: z.array(z.string()),
  whatInvalidated: z.array(z.string()),

  eddaRecordId: z.string().optional(),
  createdAt: z.string(),
});

export type PromotionRollbackMemo = z.infer<typeof PromotionRollbackMemoSchema>;
