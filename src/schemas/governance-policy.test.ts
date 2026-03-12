import { describe, it, expect } from 'vitest';
import {
  GovernancePolicySchema,
  createGovernancePolicy,
} from './governance-policy';

// --- 有效 payload 工廠 ---
function validPolicy(overrides: Record<string, unknown> = {}) {
  return {
    version: 'governance.policy.v1',
    event_id: 'evt_abc123',
    occurred_at: new Date().toISOString(),
    source_village_id: 'village-01',
    policy_type: 'budget_limits',
    payload: {
      budget_limits: {
        max_cost_per_action: 10,
        max_cost_per_day: 100,
        max_cost_per_loop: 50,
      },
    },
    ...overrides,
  };
}

describe('GovernancePolicySchema', () => {
  it('validates a correct budget_limits payload', () => {
    const result = GovernancePolicySchema.safeParse(validPolicy());
    expect(result.success).toBe(true);
  });

  it('validates a correct permissions_update payload', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({
        policy_type: 'permissions_update',
        payload: {
          allowed_permissions: ['read', 'write', 'deploy'],
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('validates a correct risk_threshold payload', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({
        policy_type: 'risk_threshold',
        payload: {
          risk_thresholds: { high: 0.9, medium: 0.5 },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects missing version', () => {
    const { version: _, ...noVersion } = validPolicy();
    const result = GovernancePolicySchema.safeParse(noVersion);
    expect(result.success).toBe(false);
  });

  it('rejects wrong version string', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({ version: 'governance.policy.v2' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects invalid policy_type', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({ policy_type: 'invalid_type' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects event_id without evt_ prefix', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({ event_id: 'bad_prefix' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty source_village_id', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({ source_village_id: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects negative budget values', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({
        payload: {
          budget_limits: {
            max_cost_per_action: -1,
            max_cost_per_day: 100,
            max_cost_per_loop: 50,
          },
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts empty payload object', () => {
    const result = GovernancePolicySchema.safeParse(
      validPolicy({ payload: {} }),
    );
    expect(result.success).toBe(true);
  });
});

describe('createGovernancePolicy', () => {
  it('generates a valid governance policy event', () => {
    const policy = createGovernancePolicy({
      source_village_id: 'village-test',
      policy_type: 'budget_limits',
      payload: {
        budget_limits: {
          max_cost_per_action: 5,
          max_cost_per_day: 50,
          max_cost_per_loop: 25,
        },
      },
    });

    // 驗證 schema 通過
    const result = GovernancePolicySchema.safeParse(policy);
    expect(result.success).toBe(true);

    // 驗證欄位
    expect(policy.version).toBe('governance.policy.v1');
    expect(policy.event_id).toMatch(/^evt_/);
    expect(policy.source_village_id).toBe('village-test');
    expect(policy.policy_type).toBe('budget_limits');
    expect(policy.occurred_at).toBeTruthy();
  });

  it('generates unique event_ids', () => {
    const p1 = createGovernancePolicy({
      source_village_id: 'v1',
      policy_type: 'permissions_update',
      payload: { allowed_permissions: ['read'] },
    });
    const p2 = createGovernancePolicy({
      source_village_id: 'v1',
      policy_type: 'permissions_update',
      payload: { allowed_permissions: ['read'] },
    });
    expect(p1.event_id).not.toBe(p2.event_id);
  });

  it('sets occurred_at to a valid ISO timestamp', () => {
    const policy = createGovernancePolicy({
      source_village_id: 'v1',
      policy_type: 'risk_threshold',
      payload: { risk_thresholds: { high: 0.9 } },
    });
    const parsed = new Date(policy.occurred_at);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('throws on invalid payload (negative budget)', () => {
    expect(() =>
      createGovernancePolicy({
        source_village_id: 'v1',
        policy_type: 'budget_limits',
        payload: {
          budget_limits: {
            max_cost_per_action: -1,
            max_cost_per_day: 100,
            max_cost_per_loop: 50,
          },
        },
      }),
    ).toThrow();
  });
});
