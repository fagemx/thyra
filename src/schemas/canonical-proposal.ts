/**
 * CanonicalChangeProposal — 7 層 canonical 提案 schema。
 *
 * Layers: identity, target, intent, diff, governance, expectedOutcome, trace
 * 這是 canonical-cycle 的提案格式，不取代現有 src/world/proposal.ts。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// ChangeProposalStatus: 15 canonical statuses
// ---------------------------------------------------------------------------

export const ChangeProposalStatusSchema = z.enum([
  'draft',
  'proposed',
  'judged',
  'approved',
  'approved_with_constraints',
  'rejected',
  'simulation_required',
  'escalated',
  'deferred',
  'applied',
  'cancelled',
  'rolled_back',
  'outcome_window_open',
  'outcome_closed',
  'archived',
]);
export type ChangeProposalStatus = z.infer<typeof ChangeProposalStatusSchema>;

// ---------------------------------------------------------------------------
// ChangeKind: v0 MVP = 5, full = 11
// ---------------------------------------------------------------------------

export const ChangeKindMVPSchema = z.enum([
  'adjust_stall_capacity',
  'adjust_spotlight_weight',
  'throttle_entry',
  'pause_event',
  'modify_pricing_rule',
]);

export const ChangeKindSchema = z.enum([
  'adjust_stall_capacity',
  'adjust_spotlight_weight',
  'throttle_entry',
  'pause_event',
  'modify_pricing_rule',
  'resume_event',
  'reassign_zone_priority',
  'tighten_safety_threshold',
  'relax_safety_threshold',
  'law_patch',
  'chief_permission_patch',
]);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

// ---------------------------------------------------------------------------
// ProposalAuthor
// ---------------------------------------------------------------------------

export const ProposalAuthorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chief'), chiefId: z.string() }),
  z.object({ type: z.literal('human'), userId: z.string() }),
  z.object({ type: z.literal('system'), source: z.string() }),
]);

// ---------------------------------------------------------------------------
// Layer 2: ChangeTarget
// ---------------------------------------------------------------------------

export const ChangeTargetSchema = z.object({
  scope: z.enum(['world', 'zone', 'stall', 'event', 'entry_gate', 'law', 'chief']),
  objectIds: z.array(z.string()),
  selectors: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  blastRadius: z.enum(['local', 'regional', 'global']),
});

// ---------------------------------------------------------------------------
// Layer 3: ChangeIntent
// ---------------------------------------------------------------------------

export const ChangeIntentSchema = z.object({
  objective: z.string(),
  reason: z.string(),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  timeHorizon: z.enum(['immediate', 'tonight', 'daily', 'weekly']),
  triggerType: z.enum([
    'scheduled_review', 'metric_threshold', 'incident_response',
    'human_request', 'precedent_followup', 'chief_initiative',
  ]),
});

// ---------------------------------------------------------------------------
// Layer 4: ChangeDiff
// ---------------------------------------------------------------------------

export const DiffOperationSchema = z.object({
  op: z.enum(['set', 'inc', 'dec', 'enable', 'disable', 'add', 'remove']),
  path: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  delta: z.number().optional(),
  unit: z.string().optional(),
});

export const ChangeDiffSchema = z.object({
  mode: z.enum(['patch', 'replace', 'append', 'remove']),
  operations: z.array(DiffOperationSchema),
});

// ---------------------------------------------------------------------------
// Layer 5: GovernanceBlock
// ---------------------------------------------------------------------------

export const GovernanceBlockSchema = z.object({
  requestedRiskClass: z.enum(['low', 'medium', 'high', 'critical']),
  autoApplyEligible: z.boolean(),
  simulationRequired: z.boolean(),
  humanApprovalRequired: z.boolean(),
  invariantsChecked: z.array(z.string()).optional(),
  constitutionRefs: z.array(z.string()).optional(),
  lawRefs: z.array(z.string()).optional(),
  precedentRefs: z.array(z.string()).optional(),
  rollbackPlan: z.object({
    strategy: z.enum(['inverse_patch', 'restore_snapshot', 'manual_only']),
    rollbackScope: z.enum(['proposal_only', 'proposal_bundle', 'full_cycle']),
    rollbackWindowMinutes: z.number(),
  }),
});

// ---------------------------------------------------------------------------
// Layer 6: ExpectedOutcomeBlock
// ---------------------------------------------------------------------------

export const WatchedMetricSchema = z.object({
  metric: z.string(),
  direction: z.enum(['up', 'down', 'stable']),
  expectedDelta: z.number().optional(),
  tolerance: z.number().optional(),
});

export const ExpectedOutcomeBlockSchema = z.object({
  hypotheses: z.array(z.string()),
  watchedMetrics: z.array(WatchedMetricSchema),
  expectedDirection: z.enum(['improve', 'stabilize', 'decrease_risk', 'increase_throughput']),
  outcomeWindow: z.object({
    openForMinutes: z.number(),
    evaluationAt: z.string().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// Layer 7: TraceBlock
// ---------------------------------------------------------------------------

export const TraceBlockSchema = z.object({
  sourceObservations: z.array(z.string()),
  sourceIncidents: z.array(z.string()).optional(),
  sourceHumanRequests: z.array(z.string()).optional(),
  sourceCycleSummaries: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Full CanonicalChangeProposal (7 layers)
// ---------------------------------------------------------------------------

export const CanonicalChangeProposalSchema = z.object({
  // Layer 1: Identity
  id: z.string(),
  worldId: z.string(),
  cycleId: z.string(),
  status: ChangeProposalStatusSchema,
  kind: ChangeKindSchema,
  title: z.string(),
  summary: z.string(),

  // Layer 2: Target
  target: ChangeTargetSchema,

  // Layer 3: Intent
  intent: ChangeIntentSchema,

  // Layer 4: Diff
  diff: ChangeDiffSchema,

  // Layer 5: Governance
  governance: GovernanceBlockSchema,

  // Layer 6: ExpectedOutcome
  expectedOutcome: ExpectedOutcomeBlockSchema,

  // Layer 7: Trace
  trace: TraceBlockSchema,

  // Metadata
  createdAt: z.string(),
  createdBy: ProposalAuthorSchema,
  judgedAt: z.string().optional(),
  appliedAt: z.string().optional(),
  outcomeWindowId: z.string().optional(),
  version: z.number().default(1),
});
export type CanonicalChangeProposal = z.infer<typeof CanonicalChangeProposalSchema>;
