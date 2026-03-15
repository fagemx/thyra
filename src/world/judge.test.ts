import { describe, it, expect } from 'vitest';
import { judgeChange } from './judge';
import type { WorldState } from './state';
import type { WorldChange } from '../schemas/world-change';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';
import type { Law } from '../law-engine';

// ---------------------------------------------------------------------------
// Test helpers — 與 diff.test.ts 一致的 pattern
// ---------------------------------------------------------------------------

function makeVillage(overrides: Partial<Village> = {}): Village {
  return {
    id: 'village-1',
    name: 'Test Village',
    description: 'A test village',
    target_repo: 'org/repo',
    status: 'active',
    metadata: {},
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConstitution(overrides: Partial<Constitution> = {}): Constitution {
  return {
    id: 'const-1',
    village_id: 'village-1',
    version: 1,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'human',
    rules: [{ id: 'rule-1', description: 'Must write tests', enforcement: 'hard', scope: ['*'] }],
    allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    superseded_by: null,
    ...overrides,
  };
}

function makeChief(overrides: Partial<Chief> = {}): Chief {
  return {
    id: 'chief-1',
    village_id: 'village-1',
    name: 'Alpha',
    role: 'developer',
    version: 1,
    status: 'active',
    skills: [],
    permissions: ['dispatch_task'],
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [],
    profile: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLaw(overrides: Partial<Law> = {}): Law {
  return {
    id: 'law-1',
    village_id: 'village-1',
    proposed_by: 'chief-1',
    approved_by: null,
    version: 1,
    status: 'active',
    category: 'testing',
    content: { description: 'Always write tests', strategy: { min_coverage: 80 } },
    risk_level: 'low',
    evidence: { source: 'observation', reasoning: 'Tests improve quality' },
    effectiveness: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    village: makeVillage(),
    constitution: makeConstitution(),
    chiefs: [makeChief()],
    active_laws: [],
    skills: [],
    running_cycles: [],
    assembled_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('judgeChange', () => {
  // --- 1. 合法變更 ---
  describe('valid changes', () => {
    it('allows village.update', () => {
      const state = makeState();
      const change: WorldChange = { type: 'village.update', name: 'New Name' };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
      expect(result.reasons).toEqual([]);
      expect(result.safety_check).toBe(true);
      expect(result.legality_check).toBe(true);
      expect(result.boundary_check).toBe(true);
      expect(result.consistency_check).toBe(true);
    });

    it('allows constitution.supersede', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'constitution.supersede',
        rules: [{ description: 'New rule', enforcement: 'hard', scope: ['*'] }],
        allowed_permissions: ['dispatch_task', 'propose_law'],
        budget_limits: { max_cost_per_action: 20, max_cost_per_day: 200, max_cost_per_loop: 100 },
        actor: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
      expect(result.safety_check).toBe(true);
      expect(result.legality_check).toBe(true);
    });

    it('allows chief.appoint with valid permissions', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'Beta',
        role: 'reviewer',
        permissions: ['dispatch_task', 'propose_law'],
        skills: [],
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
      expect(result.legality_check).toBe(true);
    });

    it('allows law.propose from existing chief', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'law.propose',
        proposed_by: 'chief-1',
        category: 'quality',
        content: { description: 'Code review required' },
        risk_level: 'low',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
    });

    it('allows law.enact when enact_law_low is permitted', () => {
      const state = makeState({
        active_laws: [makeLaw({ status: 'proposed' })],
      });
      const change: WorldChange = {
        type: 'law.enact',
        law_id: 'law-1',
        approved_by: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
    });
  });

  // --- 2. Safety check 失敗 ---
  describe('safety check failures', () => {
    it('rejects governance change without constitution (SI-1)', () => {
      const state = makeState({ constitution: null });
      const change: WorldChange = {
        type: 'law.propose',
        proposed_by: 'chief-1',
        category: 'quality',
        content: { description: 'A rule' },
        risk_level: 'low',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.safety_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('SI-1'))).toBe(true);
    });

    it('rejects chief.appoint without constitution (SI-1)', () => {
      const state = makeState({ constitution: null });
      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'Beta',
        role: 'developer',
        permissions: ['dispatch_task'],
        skills: [],
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.safety_check).toBe(false);
    });

    it('rejects dismissing last chief (SI-7)', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'chief.dismiss',
        chief_id: 'chief-1',
        actor: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.safety_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('SI-7'))).toBe(true);
    });

    it('allows dismissing chief when others exist', () => {
      const state = makeState({
        chiefs: [
          makeChief({ id: 'chief-1', name: 'Alpha' }),
          makeChief({ id: 'chief-2', name: 'Beta' }),
        ],
      });
      const change: WorldChange = {
        type: 'chief.dismiss',
        chief_id: 'chief-1',
        actor: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.safety_check).toBe(true);
    });

    it('rejects negative budget values (SI-4)', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'budget.adjust',
        max_cost_per_action: -5,
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.safety_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('SI-4'))).toBe(true);
    });

    it('rejects budget over safety maximum (SI-4)', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'budget.adjust',
        max_cost_per_day: 200000,
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.safety_check).toBe(false);
    });
  });

  // --- 3. Legality check 失敗 ---
  describe('legality check failures', () => {
    it('rejects chief.appoint with permissions exceeding constitution', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'chief.appoint',
        name: 'Rogue',
        role: 'admin',
        permissions: ['dispatch_task', 'deploy'],
        skills: [],
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.legality_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('deploy'))).toBe(true);
    });

    it('rejects chief.update_permissions with invalid permissions', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'chief.update_permissions',
        chief_id: 'chief-1',
        permissions: ['dispatch_task', 'merge_pr'],
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.legality_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('merge_pr'))).toBe(true);
    });

    it('rejects law.propose from non-existent chief', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'law.propose',
        proposed_by: 'chief-999',
        category: 'quality',
        content: { description: 'A rule' },
        risk_level: 'low',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.legality_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('chief-999'))).toBe(true);
    });

    it('rejects law.enact when enact_law_low not in constitution', () => {
      const state = makeState({
        constitution: makeConstitution({ allowed_permissions: ['dispatch_task', 'propose_law'] }),
        active_laws: [makeLaw({ status: 'proposed' })],
      });
      const change: WorldChange = {
        type: 'law.enact',
        law_id: 'law-1',
        approved_by: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.legality_check).toBe(false);
    });
  });

  // --- 4. Boundary check 失敗 ---
  describe('boundary check failures', () => {
    it('rejects budget adjust exceeding 10x current limit', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'budget.adjust',
        max_cost_per_action: 150, // 10 * 10 = 100, 150 > 100
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.boundary_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('BOUNDARY'))).toBe(true);
    });
  });

  // --- 5. Consistency check 失敗 ---
  describe('consistency check failures', () => {
    it('detects chief permissions inconsistency after constitution.supersede', () => {
      // Chief 有 dispatch_task，但新 constitution 只允許 propose_law
      const state = makeState({
        chiefs: [makeChief({ permissions: ['dispatch_task'] })],
      });
      const change: WorldChange = {
        type: 'constitution.supersede',
        rules: [{ description: 'New rule', enforcement: 'hard', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
        actor: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.consistency_check).toBe(false);
      expect(result.reasons.some((r) => r.includes('CONSISTENCY') && r.includes('THY-09'))).toBe(true);
    });
  });

  // --- 6. 多層失敗 ---
  describe('multiple failures', () => {
    it('collects reasons from all failing layers', () => {
      // 無 constitution + dismiss last chief
      const state = makeState({
        constitution: null,
        chiefs: [makeChief()],
      });
      const change: WorldChange = {
        type: 'chief.dismiss',
        chief_id: 'chief-1',
        actor: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      // SI-1 (需要 constitution) + SI-7 (最後一位 chief)
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
      expect(result.safety_check).toBe(false);
    });
  });

  // --- 7. constitution.supersede 不需要現有 constitution ---
  describe('edge cases', () => {
    it('allows constitution.supersede without existing constitution', () => {
      const state = makeState({ constitution: null });
      const change: WorldChange = {
        type: 'constitution.supersede',
        rules: [{ description: 'First rule', enforcement: 'hard', scope: ['*'] }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
        actor: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
    });

    it('allows village.update without constitution', () => {
      const state = makeState({ constitution: null });
      const change: WorldChange = { type: 'village.update', description: 'Updated' };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
    });

    it('allows skill.register with constitution', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'skill.register',
        name: 'code-review',
        definition: {
          description: 'Reviews code',
          prompt_template: 'Review: {{code}}',
          tools_required: [],
          constraints: [],
          examples: [],
        },
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
    });

    it('allows cycle.start with valid chief', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'cycle.start',
        chief_id: 'chief-1',
        trigger: 'manual',
        max_iterations: 5,
        timeout_ms: 30000,
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(true);
    });

    it('rejects constitution.supersede with negative budget (SI-4)', () => {
      const state = makeState();
      const change: WorldChange = {
        type: 'constitution.supersede',
        rules: [{ description: 'Rule', enforcement: 'hard', scope: ['*'] }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: -1, max_cost_per_day: 100, max_cost_per_loop: 50 },
        actor: 'human',
      };
      const result = judgeChange(state, change);

      expect(result.allowed).toBe(false);
      expect(result.safety_check).toBe(false);
    });
  });
});
