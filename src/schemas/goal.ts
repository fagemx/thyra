import { z } from 'zod';

// ---------------------------------------------------------------------------
// Goal Metric
// ---------------------------------------------------------------------------

export const GoalMetricSchema = z.object({
  name: z.string().min(1),
  target: z.number(),
  current: z.number().optional(),
  unit: z.string().min(1),
});

export type GoalMetric = z.infer<typeof GoalMetricSchema>;

// ---------------------------------------------------------------------------
// Goal Level & Status
// ---------------------------------------------------------------------------

export const GoalLevelEnum = z.enum(['world', 'team', 'chief', 'task']);
export type GoalLevel = z.infer<typeof GoalLevelEnum>;

export const GoalStatusEnum = z.enum(['planned', 'active', 'achieved', 'cancelled']);
export type GoalStatus = z.infer<typeof GoalStatusEnum>;

/** 層級排序：world > team > chief > task (數字越小越高) */
export const LEVEL_ORDER: Record<GoalLevel, number> = {
  world: 0,
  team: 1,
  chief: 2,
  task: 3,
};

// ---------------------------------------------------------------------------
/** DB row schema - goals table */
export const GoalRow = z.object({
  id: z.string(),
  village_id: z.string(),
  level: GoalLevelEnum,
  title: z.string(),
  description: z.string(),
  status: GoalStatusEnum,
  parent_id: z.string().nullable(),
  owner_chief_id: z.string().nullable(),
  metrics: z.string(),  // JSON string, parsed after validation
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

// CRUD Inputs
// ---------------------------------------------------------------------------

export const CreateGoalInput = z.object({
  village_id: z.string().min(1),
  level: GoalLevelEnum,
  title: z.string().min(1).max(200),
  description: z.string().max(1000).default(''),
  parent_id: z.string().min(1).optional(),
  owner_chief_id: z.string().min(1).optional(),
  metrics: z.array(GoalMetricSchema).default([]),
});

export const UpdateGoalInput = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: GoalStatusEnum.optional(),
  metrics: z.array(GoalMetricSchema).optional(),
  owner_chief_id: z.string().min(1).nullable().optional(),
});

export type CreateGoalInput = z.infer<typeof CreateGoalInput>;
export type CreateGoalInputRaw = z.input<typeof CreateGoalInput>;
export type UpdateGoalInput = z.infer<typeof UpdateGoalInput>;
