import { describe, it, expect } from 'vitest';
import {
  GovernanceMetricSchema,
  parseGovernanceMetric,
} from '../../src/schemas/governance-metric';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 'governance.metric.v1',
    event_id: 'evt_abc123',
    occurred_at: '2026-03-12T00:00:00Z',
    source: 'karvi',
    village_id: 'village-1',
    metric_type: 'task_completed',
    value: 42,
    ...overrides,
  };
}

describe('GovernanceMetricSchema', () => {
  it('validates a correct payload', () => {
    const result = GovernanceMetricSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('rejects missing version', () => {
    const { version: _, ...rest } = validPayload();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong version string', () => {
    const result = GovernanceMetricSchema.safeParse(
      validPayload({ version: 'governance.metric.v2' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects event_id without evt_ prefix', () => {
    const result = GovernanceMetricSchema.safeParse(
      validPayload({ event_id: 'abc123' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing event_id', () => {
    const { event_id: _, ...rest } = validPayload();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing occurred_at', () => {
    const { occurred_at: _, ...rest } = validPayload();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong source', () => {
    const result = GovernanceMetricSchema.safeParse(
      validPayload({ source: 'edda' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing village_id', () => {
    const { village_id: _, ...rest } = validPayload();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty village_id', () => {
    const result = GovernanceMetricSchema.safeParse(
      validPayload({ village_id: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects invalid metric_type', () => {
    const result = GovernanceMetricSchema.safeParse(
      validPayload({ metric_type: 'invalid_type' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing metric_type', () => {
    const { metric_type: _, ...rest } = validPayload();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects non-number value', () => {
    const result = GovernanceMetricSchema.safeParse(
      validPayload({ value: 'not-a-number' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing value', () => {
    const { value: _, ...rest } = validPayload();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('accepts optional metadata', () => {
    const result = GovernanceMetricSchema.safeParse(
      validPayload({ metadata: { step_id: 'step-1', duration_ms: 1200 } }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({ step_id: 'step-1', duration_ms: 1200 });
    }
  });

  it('accepts payload without metadata field', () => {
    const payload = validPayload();
    delete payload.metadata;
    const result = GovernanceMetricSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toBeUndefined();
    }
  });

  it('validates all metric_type variants', () => {
    const types = ['task_completed', 'task_failed', 'budget_consumed', 'loop_duration', 'review_score'];
    for (const t of types) {
      const result = GovernanceMetricSchema.safeParse(validPayload({ metric_type: t }));
      expect(result.success).toBe(true);
    }
  });
});

describe('parseGovernanceMetric', () => {
  it('returns ok:true with data for valid input', () => {
    const result = parseGovernanceMetric(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe('governance.metric.v1');
      expect(result.data.value).toBe(42);
    }
  });

  it('returns ok:false with error for invalid input', () => {
    const result = parseGovernanceMetric({ bad: 'data' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_METRIC');
      expect(result.error.message).toBeTruthy();
    }
  });

  it('returns ok:false for null input', () => {
    const result = parseGovernanceMetric(null);
    expect(result.ok).toBe(false);
  });
});
