import { describe, it, expect } from 'vitest';
import { parseMarketTemplate } from './market-template';
import type { MarketTemplateParseResult, MarketTemplateValidationError } from './market-template';

/** 建立一份完整合法的 Market Template 物件 */
function validTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pack_version: '0.1',
    template: 'market',
    village: {
      name: 'midnight-market',
      description: 'A night market',
      target_repo: 'fagemx/midnight-market',
    },
    constitution: {
      rules: [
        { id: 'R-1', description: 'no cheating', enforcement: 'hard', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task', 'propose_law', 'spend_budget'],
      budget: {
        max_cost_per_action: 10,
        max_cost_per_day: 200,
        max_cost_per_loop: 50,
      },
    },
    chiefs: [
      {
        name: 'event-chief',
        role: 'Event planning',
        personality: {
          risk_tolerance: 'moderate',
          communication_style: 'detailed',
          decision_speed: 'fast',
        },
        constraints: [{ type: 'must', description: 'announce events early' }],
        permissions: ['dispatch_task', 'spend_budget'],
        skills: ['event-planning'],
      },
      {
        name: 'economy-chief',
        role: 'Price management',
        personality: {
          risk_tolerance: 'conservative',
          communication_style: 'concise',
          decision_speed: 'deliberate',
        },
        permissions: ['propose_law'],
        skills: ['price-management'],
      },
    ],
    market: {
      zones: [
        { name: 'Main Street', type: 'main_street', capacity: 20 },
        { name: 'Side Alley', type: 'side_alley', capacity: 10 },
      ],
    },
    ...overrides,
  };
}

/** 取得特定 rule 的錯誤 */
function errorsForRule(result: MarketTemplateParseResult, rule: string): MarketTemplateValidationError[] {
  if (result.success) return [];
  return result.errors.filter((e) => e.rule === rule);
}

describe('MarketTemplateSchema', () => {
  // --- Happy path ---

  it('accepts valid complete market template', () => {
    const result = parseMarketTemplate(validTemplate());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.template).toBe('market');
      expect(result.data.chiefs).toHaveLength(2);
      expect(result.data.market.zones).toHaveLength(2);
    }
  });

  it('defaults optional fields (laws to [], constraints to [])', () => {
    const input = validTemplate();
    // Remove laws to test default
    delete input.laws;
    // Remove constraints from second chief
    const chiefs = input.chiefs as Record<string, unknown>[];
    delete (chiefs[1] as Record<string, unknown>).constraints;

    const result = parseMarketTemplate(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.laws).toEqual([]);
      expect(result.data.chiefs[1].constraints).toEqual([]);
    }
  });

  // --- Template field ---

  it('rejects missing template field', () => {
    const input = validTemplate();
    delete input.template;
    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
  });

  it('rejects non-market template value', () => {
    const result = parseMarketTemplate(validTemplate({ template: 'town' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'MT-TEMPLATE')).toHaveLength(1);
    }
  });

  // --- MT-01: Chief permissions subset of constitution ---

  it('MT-01: rejects chief permission not in constitution', () => {
    const input = validTemplate();
    const chiefs = input.chiefs as Record<string, unknown>[];
    (chiefs[0] as Record<string, unknown>).permissions = ['deploy']; // not in allowed_permissions

    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'MT-01').length).toBeGreaterThanOrEqual(1);
      expect(errorsForRule(result, 'MT-01')[0].message).toContain('deploy');
    }
  });

  it('MT-01: accepts chiefs with empty permissions', () => {
    const input = validTemplate();
    const chiefs = input.chiefs as Record<string, unknown>[];
    (chiefs[0] as Record<string, unknown>).permissions = [];
    (chiefs[1] as Record<string, unknown>).permissions = [];

    const result = parseMarketTemplate(input);
    expect(result.success).toBe(true);
  });

  it('MT-01: validates per-chief (5 chiefs, one has invalid permission)', () => {
    const input = validTemplate();
    const chiefs = input.chiefs as Record<string, unknown>[];
    // Add 3 more valid chiefs
    chiefs.push(
      { name: 'safety-chief', role: 'Safety', personality: { risk_tolerance: 'conservative', communication_style: 'concise', decision_speed: 'fast' }, permissions: ['dispatch_task'] },
      { name: 'lore-chief', role: 'Lore', personality: { risk_tolerance: 'moderate', communication_style: 'detailed', decision_speed: 'deliberate' }, permissions: [] },
      { name: 'growth-chief', role: 'Growth', personality: { risk_tolerance: 'aggressive', communication_style: 'detailed', decision_speed: 'deliberate' }, permissions: ['merge_pr'] }, // invalid
    );

    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const mt01 = errorsForRule(result, 'MT-01');
      expect(mt01).toHaveLength(1);
      expect(mt01[0].message).toContain('growth-chief');
      expect(mt01[0].message).toContain('merge_pr');
    }
  });

  // --- MT-02: No duplicate chief names ---

  it('MT-02: rejects duplicate chief names', () => {
    const input = validTemplate();
    const chiefs = input.chiefs as Record<string, unknown>[];
    (chiefs[1] as Record<string, unknown>).name = 'event-chief'; // same as chiefs[0]

    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'MT-02')).toHaveLength(1);
      expect(errorsForRule(result, 'MT-02')[0].message).toContain('event-chief');
    }
  });

  it('MT-02: accepts unique chief names', () => {
    const result = parseMarketTemplate(validTemplate());
    expect(result.success).toBe(true);
  });

  // --- MT-03: No duplicate law categories ---

  it('MT-03: rejects duplicate law categories', () => {
    const laws = [
      { category: 'pricing', content: { description: 'Price rules', strategy: {} }, evidence: { source: 'human', reasoning: 'Fair market' } },
      { category: 'pricing', content: { description: 'More price rules', strategy: {} }, evidence: { source: 'human', reasoning: 'Redundant' } },
    ];
    const result = parseMarketTemplate(validTemplate({ laws }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'MT-03')).toHaveLength(1);
    }
  });

  // --- MT-04: No duplicate zone names ---

  it('MT-04: rejects duplicate zone names', () => {
    const market = {
      zones: [
        { name: 'Main Street', type: 'main_street', capacity: 20 },
        { name: 'Main Street', type: 'side_alley', capacity: 10 },
      ],
    };
    const result = parseMarketTemplate(validTemplate({ market }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'MT-04')).toHaveLength(1);
      expect(errorsForRule(result, 'MT-04')[0].message).toContain('Main Street');
    }
  });

  it('MT-04: rejects empty zones array', () => {
    const market = { zones: [] };
    const result = parseMarketTemplate(validTemplate({ market }));
    expect(result.success).toBe(false);
  });

  it('MT-04: rejects zone with capacity < 1', () => {
    const market = {
      zones: [{ name: 'Dead Zone', type: 'main_street', capacity: 0 }],
    };
    const result = parseMarketTemplate(validTemplate({ market }));
    expect(result.success).toBe(false);
  });

  // --- Constitution validation ---

  it('rejects empty constitution rules', () => {
    const input = validTemplate();
    (input.constitution as Record<string, unknown>).rules = [];
    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'VP-04')).toHaveLength(1);
    }
  });

  it('rejects empty allowed_permissions', () => {
    const input = validTemplate();
    (input.constitution as Record<string, unknown>).allowed_permissions = [];
    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'VP-05')).toHaveLength(1);
    }
  });

  it('rejects negative budget value', () => {
    const input = validTemplate();
    (input.constitution as Record<string, unknown>).budget = {
      max_cost_per_action: -1,
      max_cost_per_day: 200,
      max_cost_per_loop: 50,
    };
    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'VP-06')).toHaveLength(1);
    }
  });

  // --- Chiefs array bounds ---

  it('rejects empty chiefs array', () => {
    const result = parseMarketTemplate(validTemplate({ chiefs: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 chiefs', () => {
    const chiefs = Array.from({ length: 11 }, (_, i) => ({
      name: `chief-${i}`,
      role: `Role ${i}`,
      personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'fast' },
      permissions: [],
    }));
    const result = parseMarketTemplate(validTemplate({ chiefs }));
    expect(result.success).toBe(false);
  });

  // --- Multiple errors ---

  it('returns all errors at once', () => {
    const input = validTemplate();
    const chiefs = input.chiefs as Record<string, unknown>[];
    // MT-01: invalid permission
    (chiefs[0] as Record<string, unknown>).permissions = ['deploy'];
    // MT-02: duplicate name
    (chiefs[1] as Record<string, unknown>).name = 'event-chief';

    const result = parseMarketTemplate(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'MT-01').length).toBeGreaterThanOrEqual(1);
      expect(errorsForRule(result, 'MT-02').length).toBeGreaterThanOrEqual(1);
    }
  });

  // --- Edge cases ---

  it('rejects non-object input', () => {
    const result = parseMarketTemplate('not an object');
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    const result = parseMarketTemplate(null);
    expect(result.success).toBe(false);
  });

  it('rejects wrong pack_version', () => {
    const result = parseMarketTemplate(validTemplate({ pack_version: '0.2' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'VP-01')).toHaveLength(1);
    }
  });

  // --- Village validation ---

  it('rejects empty village name', () => {
    const result = parseMarketTemplate(validTemplate({ village: { name: '', description: '', target_repo: 'x/y' } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'VP-02')).toHaveLength(1);
    }
  });

  it('rejects empty target_repo', () => {
    const result = parseMarketTemplate(validTemplate({ village: { name: 'x', description: '', target_repo: '' } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(errorsForRule(result, 'VP-03')).toHaveLength(1);
    }
  });

  // --- Zone type validation ---

  it('rejects invalid zone type', () => {
    const market = {
      zones: [{ name: 'Bad Zone', type: 'underground', capacity: 5 }],
    };
    const result = parseMarketTemplate(validTemplate({ market }));
    expect(result.success).toBe(false);
  });
});
