import { describe, it, expect } from 'vitest';
import { parseVillagePack } from './village-pack';
import type { ParseResult, ValidationError } from './village-pack';

/** 建立一份完整合法的 Village Pack 物件 */
function validPack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pack_version: '0.1',
    village: {
      name: 'blog-village',
      description: 'A blog village',
      target_repo: 'fagemx/blog-content',
    },
    constitution: {
      rules: [
        { id: 'R-1', description: 'no fabrication', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task', 'propose_law', 'spend_budget'],
      budget: {
        max_cost_per_action: 5,
        max_cost_per_day: 50,
        max_cost_per_loop: 25,
      },
    },
    chief: {
      name: 'editor-chief',
      role: 'Blog editor',
      personality: {
        risk_tolerance: 'conservative',
        communication_style: 'concise',
        decision_speed: 'deliberate',
      },
      constraints: [
        { type: 'must', description: 'be accurate' },
      ],
      permissions: ['dispatch_task', 'propose_law'],
    },
    laws: [
      {
        category: 'topic_mix',
        content: {
          description: 'Topic allocation strategy',
          strategy: { evergreen: 0.5 },
        },
        evidence: {
          source: 'human',
          reasoning: 'Balanced content strategy',
        },
      },
    ],
    skills: ['research_topic', 'draft_content'],
    ...overrides,
  };
}

/** 取得特定 rule 的錯誤 */
function errorsForRule(result: ParseResult, rule: string): ValidationError[] {
  if (result.success) return [];
  return result.errors.filter((e) => e.rule === rule);
}

describe('parseVillagePack', () => {
  // --- Happy path ---

  it('accepts a valid complete pack', () => {
    const result = parseVillagePack(validPack());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pack_version).toBe('0.1');
      expect(result.data.village.name).toBe('blog-village');
      expect(result.data.constitution.rules).toHaveLength(1);
      expect(result.data.chief.name).toBe('editor-chief');
      expect(result.data.laws).toHaveLength(1);
      expect(result.data.skills).toEqual(['research_topic', 'draft_content']);
    }
  });

  it('defaults optional fields (skills, laws) to empty arrays', () => {
    const pack = validPack();
    delete pack.laws;
    delete pack.skills;
    const result = parseVillagePack(pack);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.laws).toEqual([]);
      expect(result.data.skills).toEqual([]);
    }
  });

  it('defaults village.description to empty string', () => {
    const pack = validPack();
    (pack.village as Record<string, unknown>).description = undefined;
    delete (pack.village as Record<string, unknown>).description;
    const result = parseVillagePack(pack);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.village.description).toBe('');
    }
  });

  // --- VP-01: pack_version === '0.1' ---

  it('VP-01: rejects invalid pack_version', () => {
    const result = parseVillagePack(validPack({ pack_version: '0.2' }));
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-01')).toHaveLength(1);
  });

  // --- VP-02: village.name non-empty, ≤ 100 chars ---

  it('VP-02: rejects empty village name', () => {
    const pack = validPack();
    (pack.village as Record<string, unknown>).name = '';
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-02')).toHaveLength(1);
  });

  it('VP-02: rejects village name > 100 chars', () => {
    const pack = validPack();
    (pack.village as Record<string, unknown>).name = 'a'.repeat(101);
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-02')).toHaveLength(1);
  });

  // --- VP-03: village.target_repo non-empty ---

  it('VP-03: rejects empty target_repo', () => {
    const pack = validPack();
    (pack.village as Record<string, unknown>).target_repo = '';
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-03')).toHaveLength(1);
  });

  // --- VP-04: constitution.rules at least 1 ---

  it('VP-04: rejects empty constitution rules', () => {
    const pack = validPack();
    (pack.constitution as Record<string, unknown>).rules = [];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-04')).toHaveLength(1);
  });

  // --- VP-05: constitution.allowed_permissions at least 1 ---

  it('VP-05: rejects empty allowed_permissions', () => {
    const pack = validPack();
    (pack.constitution as Record<string, unknown>).allowed_permissions = [];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-05')).toHaveLength(1);
  });

  // --- VP-06: constitution.budget values >= 0 ---

  it('VP-06: rejects negative budget value', () => {
    const pack = validPack();
    (pack.constitution as Record<string, unknown>).budget = {
      max_cost_per_action: -1,
      max_cost_per_day: 50,
      max_cost_per_loop: 25,
    };
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-06')).toHaveLength(1);
  });

  // --- VP-07: chief.permissions ⊆ constitution.allowed_permissions ---

  it('VP-07: rejects chief permission not in constitution', () => {
    const pack = validPack();
    (pack.chief as Record<string, unknown>).permissions = ['deploy'];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    const vp07 = errorsForRule(result, 'VP-07');
    expect(vp07).toHaveLength(1);
    expect(vp07[0].path).toContain('chief.permissions');
  });

  it('VP-07: passes with empty chief permissions (empty ⊆ anything)', () => {
    const pack = validPack();
    (pack.chief as Record<string, unknown>).permissions = [];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(true);
  });

  // --- VP-08: chief.personality enum values valid ---

  it('VP-08: rejects invalid personality value', () => {
    const pack = validPack();
    (pack.chief as Record<string, unknown>).personality = {
      risk_tolerance: 'reckless',
      communication_style: 'concise',
      decision_speed: 'deliberate',
    };
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-08')).toHaveLength(1);
  });

  // --- VP-09: chief.constraints type enum ---

  it('VP-09: rejects invalid constraint type', () => {
    const pack = validPack();
    (pack.chief as Record<string, unknown>).constraints = [
      { type: 'should', description: 'invalid type' },
    ];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-09')).toHaveLength(1);
  });

  // --- VP-10: laws[].category non-empty ---

  it('VP-10: rejects empty law category', () => {
    const pack = validPack();
    (pack.laws as Record<string, unknown>[]) = [{
      category: '',
      content: { description: 'x', strategy: {} },
      evidence: { source: 'human', reasoning: 'y' },
    }];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-10')).toHaveLength(1);
  });

  // --- VP-11: laws[].content.description non-empty ---

  it('VP-11: rejects empty law content description', () => {
    const pack = validPack();
    (pack.laws as Record<string, unknown>[]) = [{
      category: 'test',
      content: { description: '', strategy: {} },
      evidence: { source: 'human', reasoning: 'y' },
    }];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-11')).toHaveLength(1);
  });

  // --- VP-12: laws[].evidence.source non-empty ---

  it('VP-12: rejects empty law evidence source', () => {
    const pack = validPack();
    (pack.laws as Record<string, unknown>[]) = [{
      category: 'test',
      content: { description: 'x', strategy: {} },
      evidence: { source: '', reasoning: 'y' },
    }];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-12')).toHaveLength(1);
  });

  // --- VP-13: laws[].evidence.reasoning non-empty ---

  it('VP-13: rejects empty law evidence reasoning', () => {
    const pack = validPack();
    (pack.laws as Record<string, unknown>[]) = [{
      category: 'test',
      content: { description: 'x', strategy: {} },
      evidence: { source: 'human', reasoning: '' },
    }];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-13')).toHaveLength(1);
  });

  // --- VP-14: skills[] name pattern ---

  it('VP-14: rejects invalid skill name (uppercase)', () => {
    const pack = validPack({ skills: ['Invalid_Name'] });
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-14')).toHaveLength(1);
  });

  it('VP-14: rejects skill name starting with digit', () => {
    const pack = validPack({ skills: ['1bad'] });
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-14')).toHaveLength(1);
  });

  it('VP-14: accepts skill names with underscores and hyphens', () => {
    const pack = validPack({ skills: ['research_topic', 'draft-content'] });
    const result = parseVillagePack(pack);
    expect(result.success).toBe(true);
  });

  // --- VP-15: no duplicate categories in laws ---

  it('VP-15: rejects duplicate law categories', () => {
    const pack = validPack();
    (pack.laws as Record<string, unknown>[]) = [
      {
        category: 'topic_mix',
        content: { description: 'first', strategy: {} },
        evidence: { source: 'human', reasoning: 'a' },
      },
      {
        category: 'topic_mix',
        content: { description: 'second', strategy: {} },
        evidence: { source: 'human', reasoning: 'b' },
      },
    ];
    const result = parseVillagePack(pack);
    expect(result.success).toBe(false);
    expect(errorsForRule(result, 'VP-15')).toHaveLength(1);
  });

  // --- Multiple errors ---

  it('returns multiple errors at once', () => {
    const result = parseVillagePack({
      pack_version: '999',
      village: { name: '', target_repo: '' },
      constitution: {
        rules: [],
        allowed_permissions: [],
        budget: { max_cost_per_action: -1, max_cost_per_day: -2, max_cost_per_loop: -3 },
      },
      chief: {
        name: 'x',
        role: 'y',
        personality: {
          risk_tolerance: 'conservative',
          communication_style: 'concise',
          decision_speed: 'deliberate',
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should have errors for VP-01, VP-02, VP-03, VP-04, VP-05, VP-06 (x3)
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });

  // --- Edge: completely invalid input ---

  it('rejects non-object input', () => {
    const result = parseVillagePack('not an object');
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    const result = parseVillagePack(null);
    expect(result.success).toBe(false);
  });
});
