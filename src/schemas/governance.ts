import { z } from 'zod';

// --- Brief endpoint ---

export const BriefInput = z.object({
  /** 簡報深度：summary 只含基本統計，detailed 含完整列表 */
  depth: z.enum(['summary', 'detailed']).default('summary'),
});
export type BriefInput = z.infer<typeof BriefInput>;

// --- Ask endpoint ---

export const AskInput = z.object({
  /** 問題文字 */
  question: z.string().min(1).max(2000),
  /** 可選：指定 chief 回答（default = 所有 active chiefs） */
  chief_id: z.string().optional(),
});
export type AskInput = z.infer<typeof AskInput>;

export const AskTopic = z.enum([
  'constitution',
  'chiefs',
  'laws',
  'budget',
  'loops',
  'skills',
  'general',
]);
export type AskTopic = z.infer<typeof AskTopic>;

// --- Command endpoint ---

export const CommandInput = z.object({
  /** 指令類型 */
  action: z.string().min(1).max(200),
  /** 指令描述 */
  description: z.string().min(1).max(2000),
  /** 預估成本 */
  estimated_cost: z.number().min(0).default(0),
  /** 理由 */
  reason: z.string().min(1).max(2000),
  /** 回滾計畫 */
  rollback_plan: z.string().min(1).max(2000),
  /** 發起者 */
  initiated_by: z.string().min(1).default('human'),
  /** 額外 metadata */
  metadata: z.record(z.unknown()).optional(),
});
export type CommandInput = z.infer<typeof CommandInput>;
