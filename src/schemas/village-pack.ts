import { z } from 'zod';
import { PermissionEnum } from './constitution';
import { EvaluatorRuleSchema } from './evaluator';
import { GoalMetricSchema, GoalLevelEnum } from './goal';

// --- Sub-schemas ---

const VillagePackConstitutionRuleSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, 'Rule description must be non-empty'),
  enforcement: z.enum(['hard', 'soft']),
  scope: z.array(z.string()).default(['*']),
});

const VillagePackBudgetSchema = z.object({
  max_cost_per_action: z.number().min(0, 'Budget value must be >= 0'),
  max_cost_per_day: z.number().min(0, 'Budget value must be >= 0'),
  max_cost_per_loop: z.number().min(0, 'Budget value must be >= 0'),
  max_cost_per_month: z.number().min(0, 'Budget value must be >= 0').default(0),
});

const VillagePackConstitutionSchema = z.object({
  rules: z.array(VillagePackConstitutionRuleSchema).min(1, 'At least 1 constitution rule required'),
  allowed_permissions: z.array(PermissionEnum).min(1, 'At least 1 allowed permission required'),
  budget: VillagePackBudgetSchema,
  evaluators: z.array(EvaluatorRuleSchema).default([]),
});

// Skill/pipeline name pattern: allows lowercase letters, digits, underscores, hyphens.
// Must start with a letter. Spec §8 says /^[a-z0-9-]+$/ but example YAML uses
// underscores (research_topic, draft_content). Using permissive pattern.
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

const VillagePackChiefSchema = z.object({
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
  pipelines: z.array(
    z.string().regex(SKILL_NAME_PATTERN, 'Pipeline name must match /^[a-z][a-z0-9_-]*$/')
  ).default([]),
});

const VillagePackLawSchema = z.object({
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

// --- Top-level schema ---

export const VillagePackSchema = z.object({
  pack_version: z.literal('0.1'),
  village: z.object({
    name: z.string().min(1, 'Village name must be non-empty').max(100, 'Village name must be <= 100 chars'),
    description: z.string().default(''),
    target_repo: z.string().min(1, 'Village target_repo must be non-empty'),
  }),
  constitution: VillagePackConstitutionSchema,
  chief: VillagePackChiefSchema,
  laws: z.array(VillagePackLawSchema).default([]),
  skills: z.array(
    z.string().regex(SKILL_NAME_PATTERN, 'Skill name must match /^[a-z][a-z0-9_-]*$/'),
  ).default([]),
  goals: z.array(z.object({
    level: GoalLevelEnum,
    title: z.string().min(1),
    description: z.string().default(''),
    parent: z.string().optional(),
    metrics: z.array(GoalMetricSchema).default([]),
  })).default([]),
}).superRefine((data, ctx) => {
  // VP-07: chief.permissions each in constitution.allowed_permissions
  const allowed = new Set(data.constitution.allowed_permissions);
  for (let i = 0; i < data.chief.permissions.length; i++) {
    const perm = data.chief.permissions[i];
    if (!allowed.has(perm)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chief', 'permissions', i],
        message: `Chief permission "${perm}" is not in constitution.allowed_permissions`,
        params: { rule: 'VP-07' },
      });
    }
  }

  // VP-15: no duplicate categories within laws
  const seen = new Map<string, number>();
  for (let i = 0; i < data.laws.length; i++) {
    const cat = data.laws[i].category;
    if (seen.has(cat)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['laws', i, 'category'],
        message: `Duplicate law category "${cat}" (first at index ${seen.get(cat)})`,
        params: { rule: 'VP-15' },
      });
    } else {
      seen.set(cat, i);
    }
  }
});

// --- Types ---

export type VillagePack = z.infer<typeof VillagePackSchema>;
export type VillagePackConstitution = z.infer<typeof VillagePackConstitutionSchema>;
export type VillagePackChief = z.infer<typeof VillagePackChiefSchema>;
export type VillagePackLaw = z.infer<typeof VillagePackLawSchema>;

// --- Validation Error ---

export interface ValidationError {
  rule: string;
  path: string;
  message: string;
}

export type ParseResult =
  | { success: true; data: VillagePack }
  | { success: false; errors: ValidationError[] };

// --- Rule code mapping ---

/**
 * 將 Zod issue path 映射到 VP 規則代碼。
 * 優先使用 superRefine params 中的 rule，否則由 path 推斷。
 */
function mapZodIssueToRule(issue: z.ZodIssue): string {
  // superRefine issues carry rule in params
  if (issue.code === 'custom' && issue.params && typeof issue.params === 'object' && 'rule' in issue.params) {
    return issue.params.rule as string;
  }

  const pathStr = issue.path.join('.');

  if (pathStr === 'pack_version') return 'VP-01';
  if (pathStr.startsWith('village.name')) return 'VP-02';
  if (pathStr.startsWith('village.target_repo')) return 'VP-03';
  if (pathStr.startsWith('constitution.rules')) return 'VP-04';
  if (pathStr.startsWith('constitution.allowed_permissions')) return 'VP-05';
  if (pathStr.startsWith('constitution.budget')) return 'VP-06';
  // VP-07 handled by superRefine
  if (pathStr.startsWith('chief.personality')) return 'VP-08';
  if (pathStr.match(/^chief\.constraints\.\d+\.type/)) return 'VP-09';
  if (pathStr.match(/^laws\.\d+\.category/)) return 'VP-10';
  if (pathStr.match(/^laws\.\d+\.content\.description/)) return 'VP-11';
  if (pathStr.match(/^laws\.\d+\.evidence\.source/)) return 'VP-12';
  if (pathStr.match(/^laws\.\d+\.evidence\.reasoning/)) return 'VP-13';
  if (pathStr.startsWith('skills')) return 'VP-14';

  return 'VP-UNKNOWN';
}

function formatPath(path: (string | number)[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : (i === 0 ? p : `.${p}`)))
    .join('');
}

// --- Public API ---

/**
 * 解析並驗證 Village Pack 物件（已從 YAML 解析後的 JS object）。
 * 靜態驗證失敗 → 不執行任何 DB 操作。
 */
export function parseVillagePack(input: unknown): ParseResult {
  const result = VillagePackSchema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    rule: mapZodIssueToRule(issue),
    path: formatPath(issue.path),
    message: issue.message,
  }));

  return { success: false, errors };
}
