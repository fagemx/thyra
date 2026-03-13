import { describe, it, expect } from 'vitest';
import {
  GovernanceMetricSchema,
  MetricTypeEnum,
  parseGovernanceMetric,
} from './governance-metric';

// --- valid payload factory ---
function validMetric(overrides: Record<string, unknown> = {}) {
  return {
    version: 'governance.metric.v1',
    event_id: 'evt_metric_001',
    occurred_at: new Date().toISOString(),
    source: 'karvi',
    village_id: 'village-01',
    metric_type: 'task_completed',
    value: 42,
    ...overrides,
  };
}

describe('GovernanceMetricSchema', () => {
  it('validates a correct payload', () => {
    const result = GovernanceMetricSchema.safeParse(validMetric());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('governance.metric.v1');
      expect(result.data.metric_type).toBe('task_completed');
      expect(result.data.value).toBe(42);
    }
  });

  it('accepts payload with optional metadata', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ metadata: { region: 'us-east', count: 3 } }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({ region: 'us-east', count: 3 });
    }
  });

  it('accepts payload without optional metadata', () => {
    // validMetric() 預設不含 metadata，驗證它仍通過
    const payload = validMetric();
    expect(payload).not.toHaveProperty('metadata');
    const result = GovernanceMetricSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects missing version', () => {
    const { version: _, ...rest } = validMetric();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong version string', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ version: 'governance.metric.v2' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing village_id', () => {
    const { village_id: _, ...rest } = validMetric();
    const result = GovernanceMetricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty village_id', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ village_id: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects event_id without evt_ prefix', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ event_id: 'metric_001' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects invalid source', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ source: 'thyra' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects invalid metric_type', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ metric_type: 'unknown_metric' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric value', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ value: 'not-a-number' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts negative value (no min constraint)', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ value: -5 }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts zero value', () => {
    const result = GovernanceMetricSchema.safeParse(
      validMetric({ value: 0 }),
    );
    expect(result.success).toBe(true);
  });

  it('validates all metric types', () => {
    const types = [
      'task_completed',
      'task_failed',
      'budget_consumed',
      'loop_duration',
      'review_score',
    ] as const;

    for (const mt of types) {
      const result = GovernanceMetricSchema.safeParse(
        validMetric({ metric_type: mt }),
      );
      expect(result.success).toBe(true);
    }
  });
});

describe('MetricTypeEnum', () => {
  it('contains exactly 5 metric types', () => {
    expect(MetricTypeEnum.options).toHaveLength(5);
  });

  it('includes expected values', () => {
    expect(MetricTypeEnum.options).toContain('task_completed');
    expect(MetricTypeEnum.options).toContain('task_failed');
    expect(MetricTypeEnum.options).toContain('budget_consumed');
    expect(MetricTypeEnum.options).toContain('loop_duration');
    expect(MetricTypeEnum.options).toContain('review_score');
  });
});

describe('parseGovernanceMetric', () => {
  it('returns ok:true with data for valid input', () => {
    const result = parseGovernanceMetric(validMetric());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe('governance.metric.v1');
      expect(result.data.value).toBe(42);
    }
  });

  it('returns ok:false with INVALID_METRIC code for invalid input', () => {
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

  it('returns ok:false for undefined input', () => {
    const result = parseGovernanceMetric(undefined);
    expect(result.ok).toBe(false);
  });

  it('error message contains all validation issues', () => {
    const result = parseGovernanceMetric({
      version: 'wrong',
      event_id: 'no_prefix',
      source: 'wrong',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 多個錯誤用分號串連
      expect(result.error.message).toContain(';');
    }
  });
});
