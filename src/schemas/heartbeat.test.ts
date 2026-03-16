import { describe, it, expect } from 'vitest';
import {
  HeartbeatContextSchema,
  HeartbeatResultSchema,
  HeartbeatUsageSchema,
  HeartbeatTriggerEnum,
  ContextModeEnum,
  AdapterTypeEnum,
  HeartbeatStatusEnum,
} from './heartbeat';

// ---------------------------------------------------------------------------
// 測試 fixtures
// ---------------------------------------------------------------------------

function validFatContext() {
  return {
    heartbeat_id: 'hb-001',
    village_id: 'village-1',
    chief_id: 'chief-1',
    trigger: 'scheduled' as const,
    context_mode: 'fat' as const,
    world_state_summary: { chiefs: 2, laws: 3 },
    market_state_summary: { stalls: 5 },
    goals: [{ id: 'g1', description: 'grow revenue' }],
    precedents: [{ id: 'p1', verdict: 'approved' }],
    budget_remaining: 100,
    permissions: ['dispatch_task', 'enact_law_low'],
    constitution_rules: ['no unsafe actions'],
    assigned_tasks: [{ id: 't1', title: 'review stalls' }],
  };
}

function validThinContext() {
  return {
    heartbeat_id: 'hb-002',
    village_id: 'village-1',
    chief_id: 'chief-2',
    trigger: 'on_demand' as const,
    context_mode: 'thin' as const,
    budget_remaining: 50,
    permissions: ['dispatch_task'],
    constitution_rules: ['rule-1'],
  };
}

function validResult() {
  return {
    heartbeat_id: 'hb-001',
    status: 'completed' as const,
    proposals: [{
      type: 'budget.adjust' as const,
      max_cost_per_action: 8,
    }],
    task_updates: [{ task_id: 't1', status: 'done' }],
    reports: [{ summary: 'all good' }],
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cost_cents: 2.5,
      duration_ms: 3000,
    },
  };
}

// ---------------------------------------------------------------------------
// Enum tests
// ---------------------------------------------------------------------------

describe('Heartbeat Enums', () => {
  it('HeartbeatTriggerEnum accepts valid values', () => {
    for (const v of ['scheduled', 'assignment', 'on_demand', 'event']) {
      expect(HeartbeatTriggerEnum.parse(v)).toBe(v);
    }
  });

  it('HeartbeatTriggerEnum rejects invalid value', () => {
    expect(() => HeartbeatTriggerEnum.parse('invalid')).toThrow();
  });

  it('ContextModeEnum accepts fat and thin', () => {
    expect(ContextModeEnum.parse('fat')).toBe('fat');
    expect(ContextModeEnum.parse('thin')).toBe('thin');
  });

  it('ContextModeEnum rejects invalid value', () => {
    expect(() => ContextModeEnum.parse('medium')).toThrow();
  });

  it('AdapterTypeEnum accepts valid values', () => {
    for (const v of ['local', 'http', 'karvi', 'custom']) {
      expect(AdapterTypeEnum.parse(v)).toBe(v);
    }
  });

  it('HeartbeatStatusEnum accepts valid values', () => {
    for (const v of ['completed', 'failed', 'needs_input', 'in_progress']) {
      expect(HeartbeatStatusEnum.parse(v)).toBe(v);
    }
  });
});

// ---------------------------------------------------------------------------
// HeartbeatContext tests
// ---------------------------------------------------------------------------

describe('HeartbeatContextSchema', () => {
  it('validates fat context with all fields', () => {
    const result = HeartbeatContextSchema.safeParse(validFatContext());
    expect(result.success).toBe(true);
  });

  it('validates thin context (no summaries)', () => {
    const result = HeartbeatContextSchema.safeParse(validThinContext());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.world_state_summary).toBeUndefined();
      expect(result.data.market_state_summary).toBeUndefined();
      expect(result.data.goals).toBeUndefined();
      expect(result.data.precedents).toBeUndefined();
    }
  });

  it('defaults assigned_tasks to empty array', () => {
    const input = validThinContext();
    const result = HeartbeatContextSchema.parse(input);
    expect(result.assigned_tasks).toEqual([]);
  });

  it('rejects missing heartbeat_id', () => {
    const input = { ...validFatContext(), heartbeat_id: '' };
    const result = HeartbeatContextSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing village_id', () => {
    const { village_id: _v, ...rest } = validFatContext();
    const result = HeartbeatContextSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing trigger', () => {
    const { trigger: _t, ...rest } = validFatContext();
    const result = HeartbeatContextSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid trigger value', () => {
    const input = { ...validFatContext(), trigger: 'manual' };
    const result = HeartbeatContextSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing context_mode', () => {
    const { context_mode: _c, ...rest } = validFatContext();
    const result = HeartbeatContextSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing budget_remaining', () => {
    const { budget_remaining: _b, ...rest } = validFatContext();
    const result = HeartbeatContextSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('accepts zero budget_remaining', () => {
    const input = { ...validFatContext(), budget_remaining: 0 };
    const result = HeartbeatContextSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HeartbeatUsage tests
// ---------------------------------------------------------------------------

describe('HeartbeatUsageSchema', () => {
  it('validates full usage', () => {
    const result = HeartbeatUsageSchema.safeParse({
      input_tokens: 1000,
      output_tokens: 500,
      cost_cents: 2.5,
      duration_ms: 3000,
    });
    expect(result.success).toBe(true);
  });

  it('validates minimal usage (only duration_ms)', () => {
    const result = HeartbeatUsageSchema.safeParse({ duration_ms: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects missing duration_ms', () => {
    const result = HeartbeatUsageSchema.safeParse({ input_tokens: 100 });
    expect(result.success).toBe(false);
  });

  it('rejects negative duration_ms', () => {
    const result = HeartbeatUsageSchema.safeParse({ duration_ms: -1 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HeartbeatResult tests
// ---------------------------------------------------------------------------

describe('HeartbeatResultSchema', () => {
  it('validates full result with proposals', () => {
    const result = HeartbeatResultSchema.safeParse(validResult());
    expect(result.success).toBe(true);
  });

  it('validates minimal result (just id + status)', () => {
    const result = HeartbeatResultSchema.safeParse({
      heartbeat_id: 'hb-001',
      status: 'completed',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.proposals).toBeUndefined();
      expect(result.data.usage).toBeUndefined();
    }
  });

  it('validates failed status', () => {
    const result = HeartbeatResultSchema.safeParse({
      heartbeat_id: 'hb-001',
      status: 'failed',
    });
    expect(result.success).toBe(true);
  });

  it('validates needs_input status', () => {
    const result = HeartbeatResultSchema.safeParse({
      heartbeat_id: 'hb-001',
      status: 'needs_input',
    });
    expect(result.success).toBe(true);
  });

  it('validates in_progress status', () => {
    const result = HeartbeatResultSchema.safeParse({
      heartbeat_id: 'hb-001',
      status: 'in_progress',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = HeartbeatResultSchema.safeParse({
      heartbeat_id: 'hb-001',
      status: 'unknown',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing heartbeat_id', () => {
    const result = HeartbeatResultSchema.safeParse({
      status: 'completed',
    });
    expect(result.success).toBe(false);
  });

  it('validates result with WorldChange proposals', () => {
    const result = HeartbeatResultSchema.safeParse({
      heartbeat_id: 'hb-001',
      status: 'completed',
      proposals: [
        { type: 'budget.adjust', max_cost_per_action: 5 },
        { type: 'law.propose', proposed_by: 'chief-1', category: 'governance', content: { desc: 'test' }, risk_level: 'low' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid WorldChange in proposals', () => {
    const result = HeartbeatResultSchema.safeParse({
      heartbeat_id: 'hb-001',
      status: 'completed',
      proposals: [
        { type: 'invalid.type' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
