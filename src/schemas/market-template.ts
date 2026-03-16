import { z } from 'zod';
import { PermissionEnum } from './constitution';

// --- Zone init schema ---

const MarketZoneInitSchema = z.object({
  name: z.string().min(1, 'Zone name must be non-empty'),
  type: z.enum(['main_street', 'side_alley', 'stage', 'entrance']),
  capacity: z.number().int().min(1, 'Zone capacity must be >= 1'),
});

// --- Constitution (same shape as VillagePack) ---

const TemplateConstitutionRuleSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, 'Rule description must be non-empty'),
  enforcement: z.enum(['hard', 'soft']),
  scope: z.array(z.string()).default(['*']),
});

const TemplateBudgetSchema = z.object({
  max_cost_per_action: z.number().min(0, 'Budget value must be >= 0'),
  max_cost_per_day: z.number().min(0, 'Budget value must be >= 0'),
  max_cost_per_loop: z.number().min(0, 'Budget value must be >= 0'),
});

const TemplateConstitutionSchema = z.object({
  rules: z.array(TemplateConstitutionRuleSchema).min(1, 'At least 1 constitution rule required'),
  allowed_permissions: z.array(PermissionEnum).min(1, 'At least 1 allowed permission required'),
  budget: TemplateBudgetSchema,
});

// --- Chief schema (array variant for multi-chief templates) ---

const TemplateChiefSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1),
  personality: z.object({
    risk_tolerance: z.enum(['conservative', 'moderate', 'aggressive']),
    communication_style: z.enum(['concise', 'detailed', 'minimal']),
    decision_speed: z.enum(['fast', 'deliberate', 'cautious']),
  }),
  constraints: z.array(z.object({
    type: z.enum(['must', 'must_not', 'prefer', 'avoid']),
    description: z.string().min(1),
  })).default([]),
  permissions: z.array(PermissionEnum).default([]),
  skills: z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/, 'Skill name must match /^[a-z][a-z0-9_-]*$/')).default([]),
});

// --- Law schema (same shape as VillagePack) ---

const TemplateLawSchema = z.object({
  category: z.string().min(1, 'Law category must be non-empty'),
  content: z.object({
    description: z.string().min(1, 'Law content description must be non-empty'),
    strategy: z.record(z.unknown()),
  }),
  evidence: z.object({
    source: z.string().min(1, 'Law evidence source must be non-empty'),
    reasoning: z.string().min(1, 'Law evidence reasoning must be non-empty'),
  }),
});

// --- Top-level Market Template schema ---

export const MarketTemplateSchema = z.object({
  pack_version: z.literal('0.1'),
  template: z.literal('market'),
  village: z.object({
    name: z.string().min(1, 'Village name must be non-empty').max(100, 'Village name must be <= 100 chars'),
    description: z.string().default(''),
    target_repo: z.string().min(1, 'Village target_repo must be non-empty'),
  }),
  constitution: TemplateConstitutionSchema,
  chiefs: z.array(TemplateChiefSchema).min(1, 'At least 1 chief required').max(10, 'Maximum 10 chiefs'),
  laws: z.array(TemplateLawSchema).default([]),
  market: z.object({
    zones: z.array(MarketZoneInitSchema).min(1, 'At least 1 market zone required'),
  }),
}).superRefine((data, ctx) => {
  // MT-01: Each chief's permissions must be subset of constitution.allowed_permissions
  const allowed = new Set(data.constitution.allowed_permissions);
  for (let ci = 0; ci < data.chiefs.length; ci++) {
    for (let pi = 0; pi < data.chiefs[ci].permissions.length; pi++) {
      const perm = data.chiefs[ci].permissions[pi];
      if (!allowed.has(perm)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chiefs', ci, 'permissions', pi],
          message: `Chief "${data.chiefs[ci].name}" permission "${perm}" not in constitution.allowed_permissions`,
          params: { rule: 'MT-01' },
        });
      }
    }
  }

  // MT-02: No duplicate chief names
  const chiefNames = new Map<string, number>();
  for (let i = 0; i < data.chiefs.length; i++) {
    const name = data.chiefs[i].name;
    if (chiefNames.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chiefs', i, 'name'],
        message: `Duplicate chief name "${name}" (first at index ${chiefNames.get(name)})`,
        params: { rule: 'MT-02' },
      });
    } else {
      chiefNames.set(name, i);
    }
  }

  // MT-03: No duplicate law categories
  const lawCats = new Map<string, number>();
  for (let i = 0; i < data.laws.length; i++) {
    const cat = data.laws[i].category;
    if (lawCats.has(cat)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['laws', i, 'category'],
        message: `Duplicate law category "${cat}"`,
        params: { rule: 'MT-03' },
      });
    } else {
      lawCats.set(cat, i);
    }
  }

  // MT-04: No duplicate zone names
  const zoneNames = new Map<string, number>();
  for (let i = 0; i < data.market.zones.length; i++) {
    const name = data.market.zones[i].name;
    if (zoneNames.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['market', 'zones', i, 'name'],
        message: `Duplicate zone name "${name}"`,
        params: { rule: 'MT-04' },
      });
    } else {
      zoneNames.set(name, i);
    }
  }
});

// --- Types ---

export type MarketTemplate = z.infer<typeof MarketTemplateSchema>;

// --- Validation Error ---

export interface MarketTemplateValidationError {
  rule: string;
  path: string;
  message: string;
}

export type MarketTemplateParseResult =
  | { success: true; data: MarketTemplate }
  | { success: false; errors: MarketTemplateValidationError[] };

// --- Rule code mapping ---

/**
 * 將 Zod issue path 映射到 MT 規則代碼。
 * 優先使用 superRefine params 中的 rule，否則由 path 推斷。
 */
function mapZodIssueToRule(issue: z.ZodIssue): string {
  // superRefine issues carry rule in params
  if (issue.code === 'custom' && issue.params && typeof issue.params === 'object' && 'rule' in issue.params) {
    return issue.params.rule as string;
  }

  const pathStr = issue.path.join('.');

  if (pathStr === 'pack_version') return 'VP-01';
  if (pathStr === 'template') return 'MT-TEMPLATE';
  if (pathStr.startsWith('village.name')) return 'VP-02';
  if (pathStr.startsWith('village.target_repo')) return 'VP-03';
  if (pathStr.startsWith('constitution.rules')) return 'VP-04';
  if (pathStr.startsWith('constitution.allowed_permissions')) return 'VP-05';
  if (pathStr.startsWith('constitution.budget')) return 'VP-06';
  if (pathStr.match(/^chiefs\.\d+\.personality/)) return 'VP-08';
  if (pathStr.match(/^chiefs\.\d+\.constraints\.\d+\.type/)) return 'VP-09';
  if (pathStr.match(/^chiefs\.\d+\.skills/)) return 'VP-14';
  if (pathStr.startsWith('chiefs')) return 'MT-CHIEF';
  if (pathStr.match(/^laws\.\d+\.category/)) return 'VP-10';
  if (pathStr.match(/^laws\.\d+\.content/)) return 'VP-11';
  if (pathStr.match(/^laws\.\d+\.evidence/)) return 'VP-12';
  if (pathStr.startsWith('market.zones')) return 'MT-ZONE';

  return 'MT-UNKNOWN';
}

function formatPath(path: (string | number)[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : (i === 0 ? p : `.${p}`)))
    .join('');
}

// --- Public API ---

/**
 * 解析並驗證 Market Template 物件（已從 YAML 解析後的 JS object）。
 * 靜態驗證失敗 → 回傳錯誤列表。
 */
export function parseMarketTemplate(input: unknown): MarketTemplateParseResult {
  const result = MarketTemplateSchema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: MarketTemplateValidationError[] = result.error.issues.map((issue) => ({
    rule: mapZodIssueToRule(issue),
    path: formatPath(issue.path),
    message: issue.message,
  }));

  return { success: false, errors };
}
