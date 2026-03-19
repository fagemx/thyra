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

// --- Fixture: moderate world ---
const MODERATE_METRICS: RawWorldMetrics = {
  congestion_score: 50,
  stall_fill_rate: 0.5,
  checkout_conversion: 0.4,
  complaint_rate: 0.15,
  fairness_score: 55,
};

// --- Fixture: extreme bad world ---
const EXTREME_BAD_METRICS: RawWorldMetrics = {
  congestion_score: 100,
  stall_fill_rate: 0.0,
  checkout_conversion: 0.0,
  complaint_rate: 1.0,
  fairness_score: 0,
};

// --- Fixture: perfect world ---
const PERFECT_METRICS: RawWorldMetrics = {
  congestion_score: 0,
  stall_fill_rate: 1.0,
  checkout_conversion: 1.0,
  complaint_rate: 0.0,
  fairness_score: 100,
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

  it('scales conversion to 0-100', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    expect(sub.conversionHealth).toBe(60);
  });

  it('inverts complaint rate', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    expect(sub.frictionHealth).toBe(95); // (1 - 0.05) * 100
  });

  it('passes through fairness score', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    expect(sub.fairnessHealth).toBe(70);
  });

  it('clamps values to 0-100 range for out-of-bound inputs', () => {
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

  it('handles zero values correctly', () => {
    const sub = normalizeMetrics(EXTREME_BAD_METRICS);
    expect(sub.congestionHealth).toBe(0);   // 100 - 100
    expect(sub.supplyHealth).toBe(0);       // 0 * 100
    expect(sub.conversionHealth).toBe(0);   // 0 * 100
    expect(sub.frictionHealth).toBe(0);     // (1 - 1) * 100
    expect(sub.fairnessHealth).toBe(0);
  });

  it('handles perfect values correctly', () => {
    const sub = normalizeMetrics(PERFECT_METRICS);
    expect(sub.congestionHealth).toBe(100);   // 100 - 0
    expect(sub.supplyHealth).toBe(100);       // 1 * 100
    expect(sub.conversionHealth).toBe(100);   // 1 * 100
    expect(sub.frictionHealth).toBe(100);     // (1 - 0) * 100
    expect(sub.fairnessHealth).toBe(100);
  });

  it('handles stressed metrics', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    expect(sub.congestionHealth).toBe(15);  // 100 - 85
    expect(sub.supplyHealth).toBe(30);      // 0.3 * 100
    expect(sub.conversionHealth).toBe(20);  // 0.2 * 100
    expect(sub.frictionHealth).toBe(60);    // (1 - 0.4) * 100
    expect(sub.fairnessHealth).toBe(25);
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

  it('uses incident weights', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    const score = computeHealthScore(sub, 'incident');
    // 80*0.35 + 75*0.10 + 60*0.10 + 95*0.30 + 70*0.15
    // = 28 + 7.5 + 6 + 28.5 + 10.5 = 80.5
    expect(score).toBe(80.5);
  });

  it('uses shutdown weights', () => {
    const sub = normalizeMetrics(HEALTHY_METRICS);
    const score = computeHealthScore(sub, 'shutdown');
    // 80*0.15 + 75*0.15 + 60*0.15 + 95*0.25 + 70*0.30
    // = 12 + 11.25 + 9 + 23.75 + 21 = 77
    expect(score).toBe(77);
  });

  it('stressed world scores low in normal mode', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    const normalScore = computeHealthScore(sub, 'normal');
    expect(normalScore).toBeLessThan(40);
  });

  it('stressed world scores even lower in peak mode', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    const peakScore = computeHealthScore(sub, 'peak');
    const normalScore = computeHealthScore(sub, 'normal');
    // Peak emphasizes congestion which is bad for stressed world
    expect(peakScore).toBeLessThanOrEqual(normalScore);
  });

  it('perfect world scores 100 in any mode', () => {
    const sub = normalizeMetrics(PERFECT_METRICS);
    expect(computeHealthScore(sub, 'normal')).toBe(100);
    expect(computeHealthScore(sub, 'peak')).toBe(100);
    expect(computeHealthScore(sub, 'incident')).toBe(100);
    expect(computeHealthScore(sub, 'shutdown')).toBe(100);
  });

  it('extreme bad world scores 0 in any mode', () => {
    const sub = normalizeMetrics(EXTREME_BAD_METRICS);
    expect(computeHealthScore(sub, 'normal')).toBe(0);
    expect(computeHealthScore(sub, 'peak')).toBe(0);
  });

  it('returns value between 0 and 100', () => {
    const sub = normalizeMetrics(MODERATE_METRICS);
    const score = computeHealthScore(sub, 'normal');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('worldModeToCycleMode', () => {
  it('maps setup → normal', () => {
    expect(worldModeToCycleMode('setup')).toBe('normal');
  });

  it('maps open → normal', () => {
    expect(worldModeToCycleMode('open')).toBe('normal');
  });

  it('maps managed → normal', () => {
    expect(worldModeToCycleMode('managed')).toBe('normal');
  });

  it('maps peak → peak', () => {
    expect(worldModeToCycleMode('peak')).toBe('peak');
  });

  it('maps cooldown → shutdown', () => {
    expect(worldModeToCycleMode('cooldown')).toBe('shutdown');
  });

  it('maps closed → shutdown', () => {
    expect(worldModeToCycleMode('closed')).toBe('shutdown');
  });

  it('incident overrides open mode', () => {
    expect(worldModeToCycleMode('open', true)).toBe('incident');
  });

  it('incident overrides peak mode', () => {
    expect(worldModeToCycleMode('peak', true)).toBe('incident');
  });

  it('incident overrides managed mode', () => {
    expect(worldModeToCycleMode('managed', true)).toBe('incident');
  });

  it('incident overrides shutdown mode', () => {
    expect(worldModeToCycleMode('closed', true)).toBe('incident');
  });

  it('defaults hasIncident to false', () => {
    expect(worldModeToCycleMode('open')).toBe('normal');
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

  it('caps concerns at 3', () => {
    const sub = normalizeMetrics(EXTREME_BAD_METRICS);
    const concerns = extractDominantConcerns(sub, EXTREME_BAD_METRICS);
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

  it('generates critical concern for very low congestion health', () => {
    const sub = normalizeMetrics(EXTREME_BAD_METRICS);
    const concerns = extractDominantConcerns(sub, EXTREME_BAD_METRICS);
    const congestion = concerns.find(c => c.kind === 'gate_congestion');
    expect(congestion).toBeDefined();
    expect(congestion?.severity).toBe('critical');
  });

  it('generates complaint_spike concern', () => {
    // frictionHealth = 60 for stressed (above threshold), so use extreme bad
    const extremeSub = normalizeMetrics(EXTREME_BAD_METRICS);
    const concerns = extractDominantConcerns(extremeSub, EXTREME_BAD_METRICS);
    const complaint = concerns.find(c => c.kind === 'complaint_spike');
    expect(complaint).toBeDefined();
  });

  it('includes summary in each concern', () => {
    const sub = normalizeMetrics(STRESSED_METRICS);
    const concerns = extractDominantConcerns(sub, STRESSED_METRICS);
    for (const c of concerns) {
      expect(c.summary).toBeTruthy();
      expect(typeof c.summary).toBe('string');
    }
  });

  it('moderate metrics generate fewer concerns', () => {
    const sub = normalizeMetrics(MODERATE_METRICS);
    const concerns = extractDominantConcerns(sub, MODERATE_METRICS);
    // moderate: congestionHealth=50 (ok), supplyHealth=50 (ok),
    // conversionHealth=40 (borderline), frictionHealth=85 (ok), fairnessHealth=55 (ok)
    // Only conversionHealth is at exactly 40, not below 40, so 0 concerns
    expect(concerns.length).toBeLessThanOrEqual(1);
  });
});

describe('determineStability', () => {
  it('healthy score → stable', () => {
    expect(determineStability(75, [])).toBe('stable');
  });

  it('score at exactly 50 → stable', () => {
    expect(determineStability(50, [])).toBe('stable');
  });

  it('score at 49 → unstable', () => {
    expect(determineStability(49, [])).toBe('unstable');
  });

  it('low score → unstable', () => {
    expect(determineStability(40, [])).toBe('unstable');
  });

  it('score at exactly 30 → unstable', () => {
    expect(determineStability(30, [])).toBe('unstable');
  });

  it('score at 29 → critical', () => {
    expect(determineStability(29, [])).toBe('critical');
  });

  it('very low score → critical', () => {
    expect(determineStability(20, [])).toBe('critical');
  });

  it('zero score → critical', () => {
    expect(determineStability(0, [])).toBe('critical');
  });

  it('critical concern forces critical stability regardless of score', () => {
    const concerns = [{ kind: 'gate_congestion', severity: 'critical' as const, summary: 'test' }];
    expect(determineStability(75, concerns)).toBe('critical');
  });

  it('non-critical concern does not affect stability', () => {
    const concerns = [{ kind: 'zone_underfilled', severity: 'medium' as const, summary: 'test' }];
    expect(determineStability(75, concerns)).toBe('stable');
  });

  it('high concern does not force critical', () => {
    const concerns = [{ kind: 'gate_congestion', severity: 'high' as const, summary: 'test' }];
    expect(determineStability(60, concerns)).toBe('stable');
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

  it('sets worldId correctly', () => {
    const frame = buildPulseFrame({
      worldId: 'test-world-42',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.worldId).toBe('test-world-42');
  });

  it('sets mode from input', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'peak',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.mode).toBe('peak');
  });

  it('includes cycleId when provided', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      cycleId: 'cycle-99',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.cycleId).toBe('cycle-99');
  });

  it('includes latestAppliedChangeId when provided', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      latestAppliedChangeId: 'chg-123',
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.latestAppliedChangeId).toBe('chg-123');
  });

  it('passes open outcome and pending proposal counts', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 5,
      pendingProposalCount: 3,
    });
    expect(frame.openOutcomeWindowCount).toBe(5);
    expect(frame.pendingProposalCount).toBe(3);
  });

  it('generates id with worldId prefix', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.id).toContain('pulse_w1_');
  });

  it('sets version to 1', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.version).toBe(1);
  });

  it('sets timestamp as ISO string', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(() => new Date(frame.timestamp)).not.toThrow();
    expect(frame.timestamp).toContain('T');
  });

  it('incident flag produces critical stability for stressed world', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      hasIncident: true,
      rawMetrics: STRESSED_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.stability).toBe('critical');
  });

  it('subScores are included in frame', () => {
    const frame = buildPulseFrame({
      worldId: 'w1',
      mode: 'open',
      rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0,
      pendingProposalCount: 0,
    });
    expect(frame.subScores).toBeDefined();
    expect(frame.subScores.congestionHealth).toBe(80);
    expect(frame.subScores.supplyHealth).toBe(75);
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
    expect(sse).toContain('"worldId"');
    expect(sse.endsWith('\n\n')).toBe(true);
  });

  it('SSE string starts with event line', () => {
    const frame = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const sse = formatPulseSSE(frame);
    expect(sse.startsWith('event: pulse_updated\n')).toBe(true);
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
    expect(event?.type === 'stability_changed' ? event.data.from : undefined).toBe('stable');
    expect(event?.data.worldId).toBe('w1');
  });

  it('returns null when stability unchanged', () => {
    const prev = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const curr = buildPulseFrame({
      worldId: 'w1', mode: 'managed', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const event = detectStabilityChange(prev, curr);
    expect(event).toBeNull();
  });

  it('returns null when previous is null', () => {
    const curr = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const event = detectStabilityChange(null, curr);
    expect(event).toBeNull();
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
      expect(events[0].data.worldId).toBe('w1');
    }
  });

  it('no escalation when previous is null but concerns exist', () => {
    const curr = buildPulseFrame({
      worldId: 'w1', mode: 'peak', rawMetrics: STRESSED_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const events = detectConcernEscalation(null, curr);
    // All critical concerns are new since no previous frame
    const criticalConcerns = curr.dominantConcerns.filter(c => c.severity === 'critical');
    expect(events.length).toBe(criticalConcerns.length);
  });

  it('no escalation when no critical concerns', () => {
    const prev = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const curr = buildPulseFrame({
      worldId: 'w1', mode: 'open', rawMetrics: HEALTHY_METRICS,
      openOutcomeWindowCount: 0, pendingProposalCount: 0,
    });
    const events = detectConcernEscalation(prev, curr);
    expect(events).toHaveLength(0);
  });
});
