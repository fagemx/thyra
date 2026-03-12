import { describe, it, expect } from 'vitest';
import {
  GovernanceDecisionSchema,
  createGovernanceDecision,
} from './governance-decision';

describe('GovernanceDecisionSchema', () => {
  const validPayload = {
    version: 'governance.decision.v1' as const,
    event_id: 'evt_abc123',
    occurred_at: '2026-03-12T00:00:00.000Z',
    village_id: 'vil_001',
    decision_type: 'law_enacted' as const,
    domain: 'law',
    key: 'law.max_budget',
    value: '1000',
    reason: 'initial budget cap',
    refs: ['law_001', 'const_002'],
  };

  it('validates a correct payload', () => {
    const result = GovernanceDecisionSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('governance.decision.v1');
      expect(result.data.decision_type).toBe('law_enacted');
    }
  });

  it('accepts payload without optional fields', () => {
    const { reason, refs, ...minimal } = validPayload;
    const result = GovernanceDecisionSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { village_id, ...missing } = validPayload;
    const result = GovernanceDecisionSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it('rejects invalid version', () => {
    const result = GovernanceDecisionSchema.safeParse({
      ...validPayload,
      version: 'governance.decision.v2',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid decision_type', () => {
    const result = GovernanceDecisionSchema.safeParse({
      ...validPayload,
      decision_type: 'village_destroyed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects event_id without evt_ prefix', () => {
    const result = GovernanceDecisionSchema.safeParse({
      ...validPayload,
      event_id: 'abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-ISO occurred_at', () => {
    const result = GovernanceDecisionSchema.safeParse({
      ...validPayload,
      occurred_at: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('createGovernanceDecision', () => {
  it('generates valid event with auto event_id and occurred_at', () => {
    const decision = createGovernanceDecision({
      village_id: 'vil_001',
      decision_type: 'chief_assigned',
      domain: 'chief',
      key: 'chief.assignment',
      value: 'chief_42',
    });

    expect(decision.version).toBe('governance.decision.v1');
    expect(decision.event_id).toMatch(/^evt_/);
    expect(decision.occurred_at).toBeTruthy();
    expect(decision.decision_type).toBe('chief_assigned');

    // 確認產出的 record 可以通過 Zod 驗證
    const result = GovernanceDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
  });

  it('respects caller-provided event_id and occurred_at', () => {
    const decision = createGovernanceDecision({
      event_id: 'evt_custom_123',
      occurred_at: '2026-01-01T00:00:00.000Z',
      village_id: 'vil_002',
      decision_type: 'budget_adjusted',
      domain: 'risk',
      key: 'risk.budget_limit',
      value: '5000',
      reason: 'increase budget',
      refs: ['const_001'],
    });

    expect(decision.event_id).toBe('evt_custom_123');
    expect(decision.occurred_at).toBe('2026-01-01T00:00:00.000Z');
    expect(decision.refs).toEqual(['const_001']);
  });

  it('covers all decision types', () => {
    const types = [
      'law_enacted',
      'law_repealed',
      'chief_assigned',
      'risk_override',
      'budget_adjusted',
      'territory_created',
    ] as const;

    for (const dt of types) {
      const decision = createGovernanceDecision({
        village_id: 'vil_001',
        decision_type: dt,
        domain: 'test',
        key: 'test.key',
        value: 'test_value',
      });
      expect(decision.decision_type).toBe(dt);
    }
  });
});
