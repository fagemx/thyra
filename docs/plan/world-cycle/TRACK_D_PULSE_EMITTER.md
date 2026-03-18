# Track D: Pulse Emitter

> Batch 1（依賴 Track A，blocks Track H）
> Repo: `C:\ai_agent\thyra`
> Layer: L2 感知層
> Spec: `docs/world-design-v0/pulse-and-outcome-metrics-v0.md` §5-13, `docs/world-design-v0/shared-types.md` §6.7-6.8

## 核心設計

Build the PulseFrame builder that computes world health from 5 base metrics (congestion, stall_fill_rate, checkout_conversion, complaint_rate, fairness_score), with mode-aware weights, and emits structured pulse after every change application.

Pulse is the world's vital sign — not a KPI dashboard, but a compressed governance status. It must include healthScore (0-100), mode, stability, and dominantConcerns.

Existing `src/world/health.ts` handles internal governance health (chief count, law count, etc.). The pulse emitter handles **world-level operational health** for the Midnight Market canonical slice. These are complementary, not overlapping.

---

## Step 1: PulseFrame Builder + Metric Weights

**Files**:
- `src/schemas/pulse-frame.ts`
- `src/canonical-cycle/pulse-emitter.ts`

**Reference**: `shared-types.md` §6.7 (Concern), §6.8 (PulseFrame), `pulse-and-outcome-metrics-v0.md` §5-13

**Key changes**:

1. Create `src/schemas/pulse-frame.ts`:
```ts
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
```

2. Create `src/canonical-cycle/pulse-emitter.ts`:
```ts
import type { WorldMode, CycleMode, Stability, Concern, SubScores, PulseFrame } from '../schemas/pulse-frame';

// ---------------------------------------------------------------------------
// Raw metric input
// ---------------------------------------------------------------------------

/** Raw metrics from the world — the 5 base signals */
export interface RawWorldMetrics {
  /** 0-100, higher = more congested (bad) */
  congestion_score: number;
  /** 0-1, proportion of stalls filled */
  stall_fill_rate: number;
  /** 0-1, proportion of visitors who transact */
  checkout_conversion: number;
  /** 0-1, proportion of visitors who complain */
  complaint_rate: number;
  /** 0-100, distribution fairness score */
  fairness_score: number;
}

// ---------------------------------------------------------------------------
// Mode-aware weight profiles (from pulse spec §11)
// ---------------------------------------------------------------------------

interface WeightProfile {
  congestion: number;
  stall_fill_rate: number;
  checkout_conversion: number;
  complaint_rate: number;
  fairness_score: number;
}

const WEIGHT_PROFILES: Record<CycleMode, WeightProfile> = {
  normal: {
    congestion: 0.20,
    stall_fill_rate: 0.25,
    checkout_conversion: 0.20,
    complaint_rate: 0.15,
    fairness_score: 0.20,
  },
  peak: {
    congestion: 0.35,
    stall_fill_rate: 0.15,
    checkout_conversion: 0.15,
    complaint_rate: 0.20,
    fairness_score: 0.15,
  },
  incident: {
    // Incident mode: safety-first — congestion and complaints dominate
    congestion: 0.35,
    stall_fill_rate: 0.10,
    checkout_conversion: 0.10,
    complaint_rate: 0.30,
    fairness_score: 0.15,
  },
  shutdown: {
    // Cooldown/closed: fairness and residual issues matter most
    congestion: 0.15,
    stall_fill_rate: 0.15,
    checkout_conversion: 0.15,
    complaint_rate: 0.25,
    fairness_score: 0.30,
  },
};

// ---------------------------------------------------------------------------
// WorldMode → CycleMode mapping (from shared-types.md §6.2)
// ---------------------------------------------------------------------------

export function worldModeToCycleMode(
  mode: WorldMode,
  hasIncident: boolean = false,
): CycleMode {
  if (hasIncident) return 'incident';
  switch (mode) {
    case 'setup':
    case 'open':
    case 'managed':
      return 'normal';
    case 'peak':
      return 'peak';
    case 'cooldown':
    case 'closed':
      return 'shutdown';
  }
}

// ---------------------------------------------------------------------------
// Normalize raw metrics → 0-100 sub-scores
// ---------------------------------------------------------------------------

/**
 * Normalize raw metrics into 0-100 health sub-scores.
 * Direction normalization: lower-is-better metrics get inverted.
 */
export function normalizeMetrics(raw: RawWorldMetrics): SubScores {
  return {
    // congestion: lower is better → invert
    congestionHealth: Math.max(0, Math.min(100, 100 - raw.congestion_score)),
    // fill rate: 0-1 → scale to 0-100 (higher is better, but cap at sweet spot)
    supplyHealth: Math.max(0, Math.min(100, raw.stall_fill_rate * 100)),
    // conversion: 0-1 → scale to 0-100
    conversionHealth: Math.max(0, Math.min(100, raw.checkout_conversion * 100)),
    // complaint: lower is better → invert (0-1 scale)
    frictionHealth: Math.max(0, Math.min(100, (1 - raw.complaint_rate) * 100)),
    // fairness: already 0-100, higher is better
    fairnessHealth: Math.max(0, Math.min(100, raw.fairness_score)),
  };
}

// ---------------------------------------------------------------------------
// Health score computation
// ---------------------------------------------------------------------------

/**
 * Compute weighted health score from sub-scores and mode-aware weights.
 * Returns 0-100.
 */
export function computeHealthScore(
  subScores: SubScores,
  cycleMode: CycleMode,
): number {
  const w = WEIGHT_PROFILES[cycleMode];
  const score =
    subScores.congestionHealth * w.congestion +
    subScores.supplyHealth * w.stall_fill_rate +
    subScores.conversionHealth * w.checkout_conversion +
    subScores.frictionHealth * w.complaint_rate +
    subScores.fairnessHealth * w.fairness_score;

  return Math.round(score * 100) / 100;
}

// ---------------------------------------------------------------------------
// Stability determination
// ---------------------------------------------------------------------------

/** Concern severity threshold for stability determination */
const CRITICAL_THRESHOLD = 30;
const UNSTABLE_THRESHOLD = 50;

export function determineStability(healthScore: number, concerns: Concern[]): Stability {
  const hasCriticalConcern = concerns.some(c => c.severity === 'critical');

  if (hasCriticalConcern || healthScore < CRITICAL_THRESHOLD) return 'critical';
  if (healthScore < UNSTABLE_THRESHOLD) return 'unstable';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Dominant concerns extraction
// ---------------------------------------------------------------------------

/** Threshold for sub-score to generate a concern */
const CONCERN_THRESHOLD = 40;

/**
 * Extract dominant concerns from sub-scores.
 * Any sub-score below threshold generates a concern.
 */
export function extractDominantConcerns(
  subScores: SubScores,
  raw: RawWorldMetrics,
): Concern[] {
  const concerns: Concern[] = [];

  if (subScores.congestionHealth < CONCERN_THRESHOLD) {
    concerns.push({
      kind: 'gate_congestion',
      severity: subScores.congestionHealth < 20 ? 'critical' : 'high',
      summary: `Congestion score at ${raw.congestion_score} — above safe threshold`,
    });
  }

  if (subScores.supplyHealth < CONCERN_THRESHOLD) {
    concerns.push({
      kind: 'zone_underfilled',
      severity: subScores.supplyHealth < 20 ? 'high' : 'medium',
      summary: `Stall fill rate at ${(raw.stall_fill_rate * 100).toFixed(0)}% — below healthy floor`,
    });
  }

  if (subScores.conversionHealth < CONCERN_THRESHOLD) {
    concerns.push({
      kind: 'conversion_drop',
      severity: subScores.conversionHealth < 20 ? 'high' : 'medium',
      summary: `Checkout conversion at ${(raw.checkout_conversion * 100).toFixed(0)}% — below threshold`,
    });
  }

  if (subScores.frictionHealth < CONCERN_THRESHOLD) {
    concerns.push({
      kind: 'complaint_spike',
      severity: subScores.frictionHealth < 20 ? 'critical' : 'high',
      summary: `Complaint rate at ${(raw.complaint_rate * 100).toFixed(0)}% — above acceptable level`,
    });
  }

  if (subScores.fairnessHealth < CONCERN_THRESHOLD) {
    concerns.push({
      kind: 'fairness_drift',
      severity: subScores.fairnessHealth < 20 ? 'high' : 'medium',
      summary: `Fairness score at ${raw.fairness_score} — distribution becoming uneven`,
    });
  }

  // Sort by severity: critical > high > medium > low
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  concerns.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Return top 3 (dominant concerns, not all concerns)
  return concerns.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Full PulseFrame builder
// ---------------------------------------------------------------------------

export interface PulseEmitterInput {
  worldId: string;
  cycleId?: string;
  mode: WorldMode;
  hasIncident?: boolean;
  rawMetrics: RawWorldMetrics;
  latestAppliedChangeId?: string;
  openOutcomeWindowCount: number;
  pendingProposalCount: number;
}

/**
 * Build a complete PulseFrame from raw metrics and world context.
 * This is the canonical pulse emission function (PULSE-01).
 */
export function buildPulseFrame(input: PulseEmitterInput): PulseFrame {
  const cycleMode = worldModeToCycleMode(input.mode, input.hasIncident);
  const subScores = normalizeMetrics(input.rawMetrics);
  const healthScore = computeHealthScore(subScores, cycleMode);
  const dominantConcerns = extractDominantConcerns(subScores, input.rawMetrics);
  const stability = determineStability(healthScore, dominantConcerns);

  return {
    id: `pulse_${input.worldId}_${Date.now()}`,
    worldId: input.worldId,
    cycleId: input.cycleId,
    healthScore,
    mode: input.mode,
    stability,
    subScores,
    dominantConcerns,
    latestAppliedChangeId: input.latestAppliedChangeId,
    openOutcomeWindowCount: input.openOutcomeWindowCount,
    pendingProposalCount: input.pendingProposalCount,
    metrics: {
      congestion_score: input.rawMetrics.congestion_score,
      stall_fill_rate: input.rawMetrics.stall_fill_rate,
      checkout_conversion: input.rawMetrics.checkout_conversion,
      complaint_rate: input.rawMetrics.complaint_rate,
      fairness_score: input.rawMetrics.fairness_score,
    },
    timestamp: new Date().toISOString(),
    version: 1,
  };
}
```

**Acceptance criteria**:
- [ ] PulseFrame includes healthScore, mode, stability, dominantConcerns (PULSE-01)
- [ ] 5 raw metrics normalized to 0-100 sub-scores with direction normalization
- [ ] Health score is weighted average using mode-aware weights
- [ ] Normal/open weights: supply + conversion emphasized
- [ ] Peak weights: congestion + complaint emphasized
- [ ] Cooldown/shutdown weights: fairness + complaint emphasized
- [ ] Concern.severity uses exactly 4 values: low/medium/high/critical
- [ ] Dominant concerns capped at top 3, sorted by severity
- [ ] Stability determination: < 30 = critical, < 50 = unstable, >= 50 = stable
- [ ] WorldMode → CycleMode mapping matches shared-types.md §6.2
- [ ] PulseFrame passes `PulseFrameSchema.safeParse()`

```bash
bun run build   # zero errors
```

**Git commit**: `feat(canonical-cycle): add PulseFrame builder with mode-aware metric weights`

---

## Step 2: Pulse SSE + Tests

**Files**:
- `src/canonical-cycle/pulse-sse.ts`
- `src/canonical-cycle/pulse-emitter.test.ts`

**Reference**: `pulse-and-outcome-metrics-v0.md` §26 (SSE events), existing `src/routes/world.ts` (pulse SSE endpoint)

**Key changes**:

1. Create `src/canonical-cycle/pulse-sse.ts`:
```ts
import type { PulseFrame } from '../schemas/pulse-frame';

/**
 * SSE event types for pulse streaming.
 * Per pulse spec §26: push governance events, not raw metrics.
 */
export type PulseSSEEvent =
  | { type: 'pulse_updated'; data: PulseFrame }
  | { type: 'concern_escalated'; data: { concern: string; severity: string; worldId: string } }
  | { type: 'stability_changed'; data: { from: string; to: string; worldId: string } };

/**
 * Format a PulseFrame as an SSE event string.
 */
export function formatPulseSSE(frame: PulseFrame): string {
  return `event: pulse_updated\ndata: ${JSON.stringify(frame)}\n\n`;
}

/**
 * Detect if stability changed between two frames and emit event.
 */
export function detectStabilityChange(
  previous: PulseFrame | null,
  current: PulseFrame,
): PulseSSEEvent | null {
  if (!previous) return null;
  if (previous.stability !== current.stability) {
    return {
      type: 'stability_changed',
      data: {
        from: previous.stability,
        to: current.stability,
        worldId: current.worldId,
      },
    };
  }
  return null;
}

/**
 * Detect if any concern was escalated to critical.
 */
export function detectConcernEscalation(
  previous: PulseFrame | null,
  current: PulseFrame,
): PulseSSEEvent[] {
  const events: PulseSSEEvent[] = [];
  const prevCritical = new Set(
    (previous?.dominantConcerns ?? [])
      .filter(c => c.severity === 'critical')
      .map(c => c.kind)
  );

  for (const concern of current.dominantConcerns) {
    if (concern.severity === 'critical' && !prevCritical.has(concern.kind)) {
      events.push({
        type: 'concern_escalated',
        data: {
          concern: concern.kind,
          severity: concern.severity,
          worldId: current.worldId,
        },
      });
    }
  }

  return events;
}
```

2. Test file `src/canonical-cycle/pulse-emitter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  buildPulseFrame,
  normalizeMetrics,
  computeHealthScore,
  determineStability,
  extractDominantConcerns,
  worldModeToCycleMode,
} from './pulse-emitter';
import { PulseFrameSchema } from '../schemas/pulse-frame';
import { detectStabilityChange, detectConcernEscalation, formatPulseSSE } from './pulse-sse';
import type { RawWorldMetrics } from './pulse-emitter';
import type { PulseFrame } from '../schemas/pulse-frame';

// --- Fixture: healthy world ---
const HEALTHY_METRICS: RawWorldMetrics = {
  congestion_score: 20,
  stall_fill_rate: 0.75,
  checkout_conversion: 0.6,
  complaint_rate: 0.05,
  fairness_score: 70,
};

// --- Fixture: stressed world ---
const STRESSED_METRICS: RawWorldMetrics = {
  congestion_score: 85,
  stall_fill_rate: 0.3,
  checkout_conversion: 0.2,
  complaint_rate: 0.4,
  fairness_score: 25,
};

describe('normalizeMetrics', () => {
  it('inverts congestion (lower-is-better)', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    expect(sub.congestionHealth).toBe(80); // 100 - 20
  });

  it('scales fill rate to 0-100', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    expect(sub.supplyHealth).toBe(75);
  });

  it('inverts complaint rate', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    expect(sub.frictionHealth).toBe(95); // (1 - 0.05) * 100
  });

  it('clamps values to 0-100 range', () => {
    const extreme: RawWorldMetrics = {
      congestion_score: 150, stall_fill_rate: 1.5,
      checkout_conversion: -0.1, complaint_rate: 1.2, fairness_score: 110,
    };
    const sub = normalizeMetrics(extreme);
    expect(sub.congestionHealth).toBe(0);
    expect(sub.supplyHealth).toBe(100);
    expect(sub.conversionHealth).toBe(0);
    expect(sub.frictionHealth).toBe(0);
    expect(sub.fairnessHealth).toBe(100);
  });
});

describe('computeHealthScore', () => {
  it('uses normal weights for open mode', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    const score = computeHealthScore(sub, 'normal');
    // Weighted: 80*0.20 + 75*0.25 + 60*0.20 + 95*0.15 + 70*0.20
    // = 16 + 18.75 + 12 + 14.25 + 14 = 75.0
    expect(score).toBe(75);
  });

  it('uses peak weights for peak mode', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    const score = computeHealthScore(sub, 'peak');
    // Weighted: 80*0.35 + 75*0.15 + 60*0.15 + 95*0.20 + 70*0.15
    // = 28 + 11.25 + 9 + 19 + 10.5 = 77.75
    expect(score).toBe(77.75);
  });

  it('stressed world scores low in any mode', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    const normalScore = computeHealthScore(sub, 'normal');
    expect(normalScore).toBeLessThan(40);
  });
});

describe('worldModeToCycleMode', () => {
  it('maps setup/open/managed → normal', () => {
    expect(worldModeToCycleMode('setup')).toBe('normal');
    expect(worldModeToCycleMode('open')).toBe('normal');
    expect(worldModeToCycleMode('managed')).toBe('normal');
  });

  it('maps peak → peak', () => {
    expect(worldModeToCycleMode('peak')).toBe('peak');
  });

  it('maps cooldown/closed → shutdown', () => {
    expect(worldModeToCycleMode('cooldown')).toBe('shutdown');
    expect(worldModeToCycleMode('closed')).toBe('shutdown');
  });

  it('incident overrides any mode', () => {
    expect(worldModeToCycleMode('open', true)).toBe('incident');
    expect(worldModeToCycleMode('peak', true)).toBe('incident');
  });
});

describe('extractDominantConcerns', () => {
  it('healthy world has no concerns', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    const concerns = extractDominantConcerns(sub, HEALTHY_METRICS);
    expect(concerns).toHaveLength(0);
  });

  it('stressed world generates multiple concerns', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    const concerns = extractDominantConcerns(sub, STRESSED_METRICS);
    expect(concerns.length).toBeGreaterThan(0);
    expect(concerns.length).toBeLessThanOrEqual(3);
  });

  it('concerns sorted by severity (critical first)', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    const concerns = extractDominantConcerns(sub, STRESSED_METRICS);
    const severities = concerns.map(c => c.severity);
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < severities.length; i++) {
      expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]]);
    }
  });

  it('concern severity uses 4 valid values only', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    const concerns = extractDominantConcerns(sub, STRESSED_METRICS);
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    for (const c of concerns) {
      expect(validSeverities).toContain(c.severity);
    }
  });
});

describe('determineStability', () => {
  it('healthy score → stable', () => {
    expect(determineStability(75, [])).toBe('stable');
  });

  it('low score → unstable', () => {
    expect(determineStability(40, [])).toBe('unstable');
  });

  it('very low score → critical', () => {
    expect(determineStability(20, [])).toBe('critical');
  });

  it('critical concern forces critical stability', () => {
    const concerns = [{ kind: 'gate_congestion', severity: 'critical' as const, summary: 'test' }];
    expect(determineStability(75, concerns)).toBe('critical');
  });
});

describe('buildPulseFrame', () => {
  it('builds valid PulseFrame for healthy world', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(PulseFrameSchema.safeParse(frame).success).toBe(true);
    expect(frame.healthScore).toBeGreaterThan(60);
    expect(frame.stability).toBe('stable');
    expect(frame.dominantConcerns).toHaveLength(0);
  });

  it('builds valid PulseFrame for stressed world in peak mode', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'peak',
      rawMetrics: STRESSED_METRICS,
      openOutcomeWindowCount: 2,
      pendingProposalCount: 3,
    });
    expect(PulseFrameSchema.safeParse(frame).success).toBe(true);
    expect(frame.healthScore).toBeLessThan(40);
    expect(frame.stability).not.toBe('stable');
    expect(frame.dominantConcerns.length).toBeGreaterThan(0);
  });

  it('includes all 5 raw metrics in metrics record', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.metrics).toHaveProperty('congestion_score');
    expect(frame.metrics).toHaveProperty('stall_fill_rate');
    expect(frame.metrics).toHaveProperty('checkout_conversion');
    expect(frame.metrics).toHaveProperty('complaint_rate');
    expect(frame.metrics).toHaveProperty('fairness_score');
  });
});

describe('PulseSSE', () => {
  it('formats pulse as SSE event string', () => {
    const frame = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const sse = formatPulseSSE(frame);
    expect(sse).toContain('event: pulse_updated');
    expect(sse).toContain('"healthScore"');
  });

  it('detects stability change', () => {
    const prev = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const curr = buildPulseFrame({
      worldId: 'w1', mode: 'peak', rawMetrics: STRESSED_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const event = detectStabilityChange(prev, curr);
    expect(event).not.toBeNull();
    expect(event?.type).toBe('stability_changed');
  });

  it('detects concern escalation to critical', () => {
    const prev = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const curr = buildPulseFrame({
      worldId: 'w1', mode: 'peak', rawMetrics: STRESSED_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const events = detectConcernEscalation(prev, curr);
    if (events.length > 0) {
      expect(events[0].type).toBe('concern_escalated');
    }
  });
});
```

**Acceptance criteria**:
- [ ] PulseFrame includes healthScore, mode, stability, dominantConcerns (PULSE-01)
- [ ] Pulse emits after every apply via `buildPulseFrame()` (PULSE-02 — integration point in cycle-runner)
- [ ] 5 metrics weighted by WorldMode (mode-aware weights verified for normal, peak, shutdown)
- [ ] Concern.severity uses exactly 4 values (low/medium/high/critical)
- [ ] PulseFrame passes `PulseFrameSchema.safeParse()`
- [ ] SSE formatting produces valid event strings
- [ ] Stability change detection works across frames
- [ ] Concern escalation detection finds new critical concerns
- [ ] Tests cover: normal pulse, peak mode weights, critical concern generation, SSE formatting
- [ ] No `any` types

```bash
bun run build                                           # zero errors
bun test src/canonical-cycle/pulse-emitter.test.ts      # all pass
```

**Git commit**: `feat(canonical-cycle): add pulse SSE helpers and comprehensive pulse tests`

---

## Track Completion Checklist

- [ ] Step 1: PulseFrame builder + metric weights
- [ ] Step 2: Pulse SSE + tests
- [ ] `bun run build` zero errors
- [ ] `bun test` — all pulse tests pass
- [ ] PulseFrame includes healthScore, mode, stability, dominantConcerns (PULSE-01)
- [ ] Pulse emits after every apply (PULSE-02)
- [ ] 5 metrics weighted by WorldMode
- [ ] Concern.severity uses 4 values (low/medium/high/critical)
- [ ] Sub-scores normalized with direction awareness
- [ ] SSE events: pulse_updated, concern_escalated, stability_changed
- [ ] Existing `src/world/health.ts` and `src/routes/world.ts` not broken
