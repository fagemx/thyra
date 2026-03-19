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
    // fill rate: 0-1 → scale to 0-100 (higher is better)
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
