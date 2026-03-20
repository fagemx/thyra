import { z } from 'zod';

export const ChecklistItemSchema = z.object({
  item: z.string(),
  passed: z.boolean(),
  note: z.string().optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const PromotionChecklistSchema = z.object({
  id: z.string(),
  targetLayer: z.enum(['project-plan', 'thyra-runtime']),
  results: z.array(ChecklistItemSchema),
  verdict: z.enum(['ready', 'partial', 'not_ready']),
  createdAt: z.string(),
  version: z.number().int().default(1),
});
export type PromotionChecklist = z.infer<typeof PromotionChecklistSchema>;
