import { describe, it, expect } from 'vitest';
import { AssessActionInput } from './assess';
import { ProposeLawRequestInput, RollbackLawInput } from './law';
import { StartCycleInput, StopCycleInput } from './loop';
import { CreateTerritoryInput, CreateAgreementInput, ShareSkillInput, ApproveAgreementInput } from './territory';
import { DispatchProjectInput } from './karvi-dispatch';

// 驗證所有新增 / 修改的 Zod schema 正確拒絕不合法輸入
// 對應 issue #97: unvalidated endpoints

describe('AssessActionInput', () => {
  it('rejects empty body', () => {
    const r = AssessActionInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const r = AssessActionInput.safeParse({ type: 'deploy' });
    expect(r.success).toBe(false);
  });

  it('rejects negative estimated_cost', () => {
    const r = AssessActionInput.safeParse({
      type: 'deploy',
      description: 'deploy service',
      initiated_by: 'chief-1',
      village_id: 'v-1',
      estimated_cost: -5,
      reason: 'needed',
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid input', () => {
    const r = AssessActionInput.safeParse({
      type: 'deploy',
      description: 'deploy service',
      initiated_by: 'chief-1',
      village_id: 'v-1',
      estimated_cost: 5,
      reason: 'needed',
    });
    expect(r.success).toBe(true);
  });

  it('accepts valid input with optional fields', () => {
    const r = AssessActionInput.safeParse({
      type: 'deploy',
      description: 'deploy service',
      initiated_by: 'chief-1',
      village_id: 'v-1',
      estimated_cost: 5,
      reason: 'needed',
      rollback_plan: 'revert commit',
      cross_village: false,
      metadata: { key: 'value' },
    });
    expect(r.success).toBe(true);
  });
});

describe('ProposeLawRequestInput', () => {
  const validInput = {
    chief_id: 'chief-1',
    category: 'deploy-rules',
    content: { description: 'rule desc', strategy: { key: 'val' } },
    evidence: { source: 'edda', reasoning: 'because' },
  };

  it('rejects empty body', () => {
    const r = ProposeLawRequestInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects missing chief_id', () => {
    const { chief_id: _, ...rest } = validInput;
    const r = ProposeLawRequestInput.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects empty chief_id', () => {
    const r = ProposeLawRequestInput.safeParse({ ...validInput, chief_id: '' });
    expect(r.success).toBe(false);
  });

  it('accepts valid input', () => {
    const r = ProposeLawRequestInput.safeParse(validInput);
    expect(r.success).toBe(true);
  });
});

describe('RollbackLawInput', () => {
  it('accepts empty body (reason defaults)', () => {
    const r = RollbackLawInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.reason).toBe('Manual rollback');
    }
  });

  it('accepts explicit reason', () => {
    const r = RollbackLawInput.safeParse({ reason: 'bad law' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.reason).toBe('bad law');
    }
  });

  it('rejects non-string reason', () => {
    const r = RollbackLawInput.safeParse({ reason: 123 });
    expect(r.success).toBe(false);
  });
});

describe('StartCycleInput', () => {
  it('rejects empty body', () => {
    const r = StartCycleInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects missing chief_id', () => {
    const r = StartCycleInput.safeParse({ trigger: 'manual' });
    expect(r.success).toBe(false);
  });

  it('rejects empty chief_id', () => {
    const r = StartCycleInput.safeParse({ chief_id: '' });
    expect(r.success).toBe(false);
  });

  it('accepts valid input with defaults', () => {
    const r = StartCycleInput.safeParse({ chief_id: 'chief-1' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.trigger).toBe('manual');
      expect(r.data.timeout_ms).toBe(300_000);
      expect(r.data.max_iterations).toBe(10);
    }
  });
});

describe('StopCycleInput', () => {
  it('accepts empty body (reason defaults)', () => {
    const r = StopCycleInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.reason).toBe('Human stop');
    }
  });

  it('accepts explicit reason', () => {
    const r = StopCycleInput.safeParse({ reason: 'emergency' });
    expect(r.success).toBe(true);
  });
});

describe('CreateTerritoryInput', () => {
  it('rejects empty body', () => {
    const r = CreateTerritoryInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects single village_id', () => {
    const r = CreateTerritoryInput.safeParse({ name: 'T1', village_ids: ['v1'] });
    expect(r.success).toBe(false);
  });

  it('accepts valid input', () => {
    const r = CreateTerritoryInput.safeParse({ name: 'T1', village_ids: ['v1', 'v2'] });
    expect(r.success).toBe(true);
  });
});

describe('CreateAgreementInput', () => {
  it('rejects empty body', () => {
    const r = CreateAgreementInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const r = CreateAgreementInput.safeParse({ type: 'invalid', parties: ['a', 'b'] });
    expect(r.success).toBe(false);
  });

  it('accepts valid input', () => {
    const r = CreateAgreementInput.safeParse({ type: 'resource_sharing', parties: ['a', 'b'] });
    expect(r.success).toBe(true);
  });
});

describe('ApproveAgreementInput', () => {
  it('rejects empty body', () => {
    const r = ApproveAgreementInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects empty village_id', () => {
    const r = ApproveAgreementInput.safeParse({ village_id: '' });
    expect(r.success).toBe(false);
  });

  it('accepts valid input', () => {
    const r = ApproveAgreementInput.safeParse({ village_id: 'v-1' });
    expect(r.success).toBe(true);
  });
});

describe('ShareSkillInput', () => {
  it('rejects empty body', () => {
    const r = ShareSkillInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('accepts valid input', () => {
    const r = ShareSkillInput.safeParse({
      skill_id: 's-1',
      from_village_id: 'v-1',
      to_village_id: 'v-2',
    });
    expect(r.success).toBe(true);
  });
});

describe('DispatchProjectInput', () => {
  it('rejects empty body', () => {
    const r = DispatchProjectInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects missing tasks', () => {
    const r = DispatchProjectInput.safeParse({ title: 'proj' });
    expect(r.success).toBe(false);
  });

  it('rejects empty tasks array', () => {
    const r = DispatchProjectInput.safeParse({ title: 'proj', tasks: [] });
    expect(r.success).toBe(false);
  });

  it('accepts valid input', () => {
    const r = DispatchProjectInput.safeParse({
      title: 'proj',
      tasks: [{ title: 'task1' }],
    });
    expect(r.success).toBe(true);
  });
});
