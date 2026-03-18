/**
 * schemas/reputation.ts -- Chief 聲望系統 Zod schemas (#216)
 *
 * 定義 ChiefReputation 資料結構與預設獎懲常數。
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ChiefReputationSchema = z.object({
  chief_id: z.string(),
  village_id: z.string(),
  score: z.number().int().min(0).max(200).default(100),
  proposals_applied: z.number().int().min(0).default(0),
  proposals_rejected: z.number().int().min(0).default(0),
  rollbacks_triggered: z.number().int().min(0).default(0),
  updated_at: z.string(),
});

export type ChiefReputation = z.infer<typeof ChiefReputationSchema>;

// ---------------------------------------------------------------------------
// 預設獎懲常數
// ---------------------------------------------------------------------------

/** 預設 score 變動值（Phase 1 固定，Phase 2 可配置） */
export const DEFAULT_REWARDS = {
  /** 提案被 judge 通過並 apply */
  proposal_applied: 1,
  /** 提案被 judge 拒絕 */
  proposal_rejected: -1,
  /** 觸發 rollback */
  rollback_triggered: -2,
} as const;

/** 新 chief 的起始 score */
export const INITIAL_SCORE = 100;

/** Score 上下限 */
export const SCORE_FLOOR = 0;
export const SCORE_CEILING = 200;
