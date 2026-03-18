# Track B: Change Proposal Extensions

> Batch 1（依賴 Track A，blocks Track C）
> Repo: `C:\ai_agent\thyra`
> Layer: L1 提案層
> Spec: `docs/world-design-v0/change-proposal-schema-v0.md` §3-9, `docs/world-design-v0/shared-types.md` §6.3-6.6

## 核心設計

Extend the existing `src/world/proposal.ts` with the canonical proposal lifecycle state machine (14 statuses from `shared-types.md` §6.4), ProposalBundle support, simulation hooks, and GovernanceBlock / ExpectedOutcomeBlock per proposal.

The existing `proposal.ts` has a simple `ChangeProposal` with `status: 'pending'`. This track replaces that with the full canonical lifecycle while preserving backward compatibility for existing consumers.

---

## Step 1: ChangeProposal Lifecycle State Machine

> ⚠️ 現有 `src/world/judge.ts` 使用 5 層 pipeline（Safety → Legality → Boundary → Evaluator → Consistency）。
> canonical-cycle spec 定義 4 層 stack（structural → invariants → constitution → contextual）。
> v0 策略：保留現有 5 層 pipeline 不修改。新增的 canonical proposal lifecycle 呼叫現有 judge，
> 不重建判斷層。4-layer spec 作為 future alignment target，不在本 track 實作。

**Files**:
- `src/schemas/change-proposal.ts` (new — canonical Zod schemas)
- `src/canonical-cycle/proposal-lifecycle.ts`

**Reference**: `shared-types.md` §6.4 (ChangeProposalStatus), `change-proposal-schema-v0.md` §3 (lifecycle), §5-9 (schema layers)

**Key changes**:

1. Create `src/schemas/change-proposal.ts`:
```ts
import { z } from 'zod';

// --- ChangeProposalStatus: 14 canonical statuses ---
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

// --- ChangeKind: v0 MVP = 5, full = 11 ---
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

// --- ProposalAuthor ---
export const ProposalAuthorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chief'), chiefId: z.string() }),
  z.object({ type: z.literal('human'), userId: z.string() }),
  z.object({ type: z.literal('system'), source: z.string() }),
]);

// --- ChangeTarget ---
export const ChangeTargetSchema = z.object({
  scope: z.enum(['world', 'zone', 'stall', 'event', 'entry_gate', 'law', 'chief']),
  objectIds: z.array(z.string()),
  selectors: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  blastRadius: z.enum(['local', 'regional', 'global']),
});

// --- ChangeIntent ---
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

// --- ChangeDiff ---
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

// --- GovernanceBlock ---
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

// --- ExpectedOutcomeBlock ---
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

// --- TraceBlock ---
export const TraceBlockSchema = z.object({
  sourceObservations: z.array(z.string()),
  sourceIncidents: z.array(z.string()).optional(),
  sourceHumanRequests: z.array(z.string()).optional(),
  sourceCycleSummaries: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});

// --- Full CanonicalChangeProposal ---
export const CanonicalChangeProposalSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  cycleId: z.string(),
  status: ChangeProposalStatusSchema,
  kind: ChangeKindSchema,
  title: z.string(),
  summary: z.string(),

  target: ChangeTargetSchema,
  intent: ChangeIntentSchema,
  diff: ChangeDiffSchema,

  governance: GovernanceBlockSchema,
  expectedOutcome: ExpectedOutcomeBlockSchema,
  trace: TraceBlockSchema,

  createdAt: z.string(),
  createdBy: ProposalAuthorSchema,
  judgedAt: z.string().optional(),
  appliedAt: z.string().optional(),
  outcomeWindowId: z.string().optional(),
  version: z.number().default(1),
});
export type CanonicalChangeProposal = z.infer<typeof CanonicalChangeProposalSchema>;
```

2. Create `src/canonical-cycle/proposal-lifecycle.ts`:
```ts
import type { ChangeProposalStatus } from '../schemas/change-proposal';

/**
 * Valid status transitions for the canonical proposal lifecycle.
 *
 * Lifecycle: draft → proposed → judged → approved/rejected/... → applied → outcome_window_open → outcome_closed → archived
 * No skipping stages. Transitions are enforced at runtime.
 */
const VALID_TRANSITIONS: Record<ChangeProposalStatus, readonly ChangeProposalStatus[]> = {
  draft: ['proposed', 'cancelled'],
  proposed: ['judged'],
  judged: ['approved', 'approved_with_constraints', 'rejected', 'simulation_required', 'escalated', 'deferred'],
  approved: ['applied', 'cancelled'],
  approved_with_constraints: ['applied', 'cancelled'],
  rejected: ['archived'],
  simulation_required: ['judged', 'cancelled'],
  escalated: ['judged', 'cancelled'],
  deferred: ['proposed', 'cancelled'],
  applied: ['outcome_window_open', 'rolled_back'],
  cancelled: ['archived'],
  rolled_back: ['archived'],
  outcome_window_open: ['outcome_closed'],
  outcome_closed: ['archived'],
  archived: [],
};

/**
 * Validate and execute a status transition.
 * Throws if the transition is not allowed.
 */
export function transitionProposalStatus(
  current: ChangeProposalStatus,
  next: ChangeProposalStatus,
): ChangeProposalStatus {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid proposal transition: ${current} → ${next}. Allowed: [${allowed.join(', ')}]`
    );
  }
  return next;
}

/** Check if a transition is valid without throwing */
export function isValidTransition(
  current: ChangeProposalStatus,
  next: ChangeProposalStatus,
): boolean {
  return VALID_TRANSITIONS[current].includes(next);
}

/** Get all valid next statuses from a given status */
export function getValidNextStatuses(
  current: ChangeProposalStatus,
): readonly ChangeProposalStatus[] {
  return VALID_TRANSITIONS[current];
}
```

**Acceptance criteria**:
- [ ] `ChangeProposalStatusSchema` has exactly 15 values (14 from shared-types + `archived`)
- [ ] `CanonicalChangeProposalSchema.safeParse()` validates all 7 layers (identity, target, intent, diff, governance, expectedOutcome, trace)
- [ ] `transitionProposalStatus('draft', 'proposed')` succeeds
- [ ] `transitionProposalStatus('draft', 'applied')` throws (no skipping)
- [ ] `transitionProposalStatus('archived', 'draft')` throws (terminal state)
- [ ] Verdict values from JUDGE-02: 6 values (approved, approved_with_constraints, rejected, simulation_required, escalated, deferred)
- [ ] 4-layer judgment integration point (structural → invariants → constitution → contextual) via JUDGE-01 — validated at judge step

```bash
bun run build   # zero errors
```

**Git commit**: `feat(canonical-cycle): add ChangeProposal lifecycle state machine and canonical schema`

---

## Step 2: ProposalBundle + Simulation Hooks + Tests

**Files**:
- `src/schemas/proposal-bundle.ts`
- `src/canonical-cycle/proposal-bundle.ts`
- `src/canonical-cycle/simulation-hook.ts`
- `src/canonical-cycle/proposal-lifecycle.test.ts`

**Reference**: `change-proposal-schema-v0.md` §18 (ProposalBundle), §10 (GovernanceBlock simulation), `shared-types.md` §6.6 (SimulationPlan)

**Key changes**:

1. Create `src/schemas/proposal-bundle.ts`:
```ts
import { z } from 'zod';

export const ProposalBundleSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  cycleId: z.string(),
  chiefId: z.string(),
  proposalIds: z.array(z.string()),
  strategySummary: z.string(),
  priority: z.enum(['normal', 'urgent', 'critical']),
  createdAt: z.string(),
  version: z.number().default(1),
});
export type ProposalBundle = z.infer<typeof ProposalBundleSchema>;
```

2. Create `src/canonical-cycle/proposal-bundle.ts`:
```ts
import type { ProposalBundle } from '../schemas/proposal-bundle';
import type { CanonicalChangeProposal } from '../schemas/change-proposal';

/**
 * Create a ProposalBundle from related proposals.
 * A bundle groups proposals that should be judged together to avoid local optima.
 */
export function createProposalBundle(
  worldId: string,
  cycleId: string,
  chiefId: string,
  proposals: CanonicalChangeProposal[],
  strategySummary: string,
  priority: 'normal' | 'urgent' | 'critical' = 'normal',
): ProposalBundle {
  if (proposals.length === 0) {
    throw new Error('ProposalBundle must contain at least one proposal');
  }
  return {
    id: `bundle_${Date.now()}`,
    worldId,
    cycleId,
    chiefId,
    proposalIds: proposals.map(p => p.id),
    strategySummary,
    priority,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}
```

3. Create `src/canonical-cycle/simulation-hook.ts`:
```ts
import type { WorldState } from '../world/state';
import type { CanonicalChangeProposal } from '../schemas/change-proposal';
import type { JudgeResult } from '../world/judge';

export interface SimulationResult {
  proposalId: string;
  simulatedState: WorldState;
  predictedEffects: Array<{
    metric: string;
    predicted: number;
    confidence: number;
  }>;
  warnings: string[];
  wouldPass: boolean;
}

/**
 * Dry-run judgment: run the full judge pipeline without applying.
 * Returns what would happen if this proposal were approved.
 */
export function simulateProposal(
  currentState: WorldState,
  proposal: CanonicalChangeProposal,
  judgeFn: (state: WorldState, proposal: CanonicalChangeProposal) => JudgeResult,
): SimulationResult {
  const judgeResult = judgeFn(currentState, proposal);

  return {
    proposalId: proposal.id,
    simulatedState: currentState, // In full impl: apply diff to clone
    predictedEffects: [],          // Placeholder for metric prediction
    warnings: judgeResult.warnings,
    wouldPass: judgeResult.allowed,
  };
}
```

4. Test file `src/canonical-cycle/proposal-lifecycle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { transitionProposalStatus, isValidTransition, getValidNextStatuses } from './proposal-lifecycle';
import { CanonicalChangeProposalSchema, ChangeProposalStatusSchema } from '../schemas/change-proposal';
import { ProposalBundleSchema } from '../schemas/proposal-bundle';
import { createProposalBundle } from './proposal-bundle';

describe('ProposalLifecycle', () => {
  // --- Valid transitions ---
  it('draft → proposed is valid', () => {
    expect(transitionProposalStatus('draft', 'proposed')).toBe('proposed');
  });

  it('proposed → judged is valid', () => {
    expect(transitionProposalStatus('proposed', 'judged')).toBe('judged');
  });

  it('judged → approved is valid', () => {
    expect(transitionProposalStatus('judged', 'approved')).toBe('approved');
  });

  it('applied → outcome_window_open is valid', () => {
    expect(transitionProposalStatus('applied', 'outcome_window_open'))
      .toBe('outcome_window_open');
  });

  // --- Invalid transitions ---
  it('draft → applied throws (no skipping)', () => {
    expect(() => transitionProposalStatus('draft', 'applied')).toThrow();
  });

  it('archived → draft throws (terminal state)', () => {
    expect(() => transitionProposalStatus('archived', 'draft')).toThrow();
  });

  it('proposed → applied throws (must go through judged)', () => {
    expect(() => transitionProposalStatus('proposed', 'applied')).toThrow();
  });

  // --- All 6 verdicts reachable from judged ---
  it('judged can transition to all 6 verdict statuses', () => {
    const verdicts = [
      'approved', 'approved_with_constraints', 'rejected',
      'simulation_required', 'escalated', 'deferred',
    ] as const;
    for (const v of verdicts) {
      expect(isValidTransition('judged', v)).toBe(true);
    }
  });

  // --- Schema validation ---
  it('ChangeProposalStatus has 15 values', () => {
    const values = ChangeProposalStatusSchema.options;
    expect(values).toHaveLength(15);
  });
});

describe('ProposalBundle', () => {
  it('creates bundle from proposals', () => {
    const bundle = createProposalBundle('w1', 'c1', 'chief_1', [
      { id: 'cp_1' } as any, // Minimal mock for test
    ], 'Reduce north gate congestion');
    expect(ProposalBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it('rejects empty proposal list', () => {
    expect(() => createProposalBundle('w1', 'c1', 'chief_1', [], 'Empty'))
      .toThrow('at least one proposal');
  });
});
```

**Acceptance criteria**:
- [ ] All valid transitions pass, all invalid transitions throw
- [ ] Full canonical lifecycle path works: draft → proposed → judged → approved → applied → outcome_window_open → outcome_closed → archived
- [ ] ProposalBundle requires at least 1 proposal
- [ ] ProposalBundle passes Zod validation
- [ ] Simulation hook runs judgment without applying changes
- [ ] Tests cover: valid transitions, invalid transitions rejected, all 6 verdicts, bundle creation, bundle empty rejection
- [ ] No `any` in production code (test mocks are acceptable)

```bash
bun run build                                             # zero errors
bun test src/canonical-cycle/proposal-lifecycle.test.ts    # all pass
```

**Git commit**: `feat(canonical-cycle): add ProposalBundle, simulation hooks, and lifecycle tests`

---

## Track Completion Checklist

- [ ] Step 1: ChangeProposal lifecycle state machine + canonical schema
- [ ] Step 2: ProposalBundle + simulation hooks + tests
- [ ] `bun run build` zero errors
- [ ] `bun test` — all proposal lifecycle tests pass
- [ ] Proposal lifecycle enforces valid transitions (no skipping stages)
- [ ] 4-layer judgment stack order defined (JUDGE-01)
- [ ] Verdict is one of 6 values (JUDGE-02)
- [ ] ProposalBundle groups related proposals
- [ ] GovernanceBlock + ExpectedOutcomeBlock per proposal
- [ ] Existing `src/world/proposal.ts` not broken (additive change)
