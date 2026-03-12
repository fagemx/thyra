import { z } from 'zod';

/** Edda query endpoint 的輸入驗證 */
export const EddaQueryInput = z.object({
  q: z.string().optional(),
  domain: z.string().optional(),
  keyword: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  include_superseded: z.boolean().optional(),
  branch: z.string().optional(),
});

export type EddaQueryInput = z.infer<typeof EddaQueryInput>;

/** Edda decide endpoint 的輸入驗證 */
export const EddaDecideInput = z.object({
  domain: z.string().min(1),
  aspect: z.string().min(1),
  value: z.string().min(1),
  reason: z.string().optional(),
});

export type EddaDecideInput = z.infer<typeof EddaDecideInput>;
