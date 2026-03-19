/**
 * schemas/precedent-record.ts — PrecedentRecord Zod schemas
 *
 * 定義 precedent record 的型別，用於記錄治理決策的先例。
 * 每個 PrecedentRecord 連結到 proposalId + outcomeReportId（PREC-01）。
 * Precedent 是 append-only，不允許修改或刪除（PREC-02）。
 *
 * @see docs/plan/world-cycle/TRACK_F_PRECEDENT_RECORDER.md Step 1
 */

import { z } from 'zod';
import { ChangeKindSchema } from './canonical-proposal';
import { OutcomeVerdictSchema, OutcomeRecommendationSchema } from './outcome-report';

// ---------------------------------------------------------------------------
// PrecedentRecord — 完整的先例記錄
// ---------------------------------------------------------------------------

export const PrecedentRecordSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  worldType: z.string(),
  proposalId: z.string(),           // PREC-01: required
  outcomeReportId: z.string(),      // PREC-01: required
  changeKind: ChangeKindSchema,
  cycleId: z.string(),

  context: z.string(),              // 提案時的世界狀態描述
  decision: z.string(),             // 決策內容
  outcome: OutcomeVerdictSchema,
  recommendation: OutcomeRecommendationSchema,
  lessonsLearned: z.array(z.string()),
  contextTags: z.array(z.string()), // e.g., ["peak_hour", "festival_night"]

  createdAt: z.string(),
  version: z.number().int().default(1),
});
export type PrecedentRecord = z.infer<typeof PrecedentRecordSchema>;

// ---------------------------------------------------------------------------
// CreatePrecedentInput — 建立先例的輸入
// ---------------------------------------------------------------------------

export const CreatePrecedentInputSchema = z.object({
  worldId: z.string().min(1),
  worldType: z.string().min(1),
  proposalId: z.string().min(1),         // PREC-01: cannot be empty
  outcomeReportId: z.string().min(1),    // PREC-01: cannot be empty
  changeKind: ChangeKindSchema,
  cycleId: z.string().min(1),
  context: z.string(),
  decision: z.string(),
  outcome: OutcomeVerdictSchema,
  recommendation: OutcomeRecommendationSchema,
  lessonsLearned: z.array(z.string()),
  contextTags: z.array(z.string()),
});
export type CreatePrecedentInput = z.infer<typeof CreatePrecedentInputSchema>;
