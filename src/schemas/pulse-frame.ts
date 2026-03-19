import { z } from 'zod';

// --- WorldMode (from shared-types.md §6.1) ---
export const WorldModeSchema = z.enum([
  'setup', 'open', 'peak', 'managed', 'cooldown', 'closed',
]);
export type WorldMode = z.infer<typeof WorldModeSchema>;

// --- CycleMode (from shared-types.md §6.2) ---
export const CycleModeSchema = z.enum(['normal', 'peak', 'incident', 'shutdown']);
export type CycleMode = z.infer<typeof CycleModeSchema>;

// --- Stability ---
export const StabilitySchema = z.enum(['stable', 'unstable', 'critical']);
export type Stability = z.infer<typeof StabilitySchema>;

// --- Concern (from shared-types.md §6.7) ---
export const ConcernSchema = z.object({
  kind: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  targetId: z.string().optional(),
  summary: z.string(),
});
export type Concern = z.infer<typeof ConcernSchema>;

// --- SubScores (5 normalized metrics) ---
export const SubScoresSchema = z.object({
  congestionHealth: z.number().min(0).max(100),
  supplyHealth: z.number().min(0).max(100),
  conversionHealth: z.number().min(0).max(100),
  frictionHealth: z.number().min(0).max(100),
  fairnessHealth: z.number().min(0).max(100),
});
export type SubScores = z.infer<typeof SubScoresSchema>;

// --- PulseFrame (from shared-types.md §6.8 + pulse spec §13) ---
export const PulseFrameSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  cycleId: z.string().optional(),

  healthScore: z.number().min(0).max(100),
  mode: WorldModeSchema,
  stability: StabilitySchema,
  subScores: SubScoresSchema,

  dominantConcerns: z.array(ConcernSchema),
  latestAppliedChangeId: z.string().optional(),
  openOutcomeWindowCount: z.number().int().min(0),
  pendingProposalCount: z.number().int().min(0),

  metrics: z.record(z.number()),
  timestamp: z.string(),
  version: z.number().default(1),
});
export type PulseFrame = z.infer<typeof PulseFrameSchema>;
