# Track C: Promotion Engine

> Batch 3（依賴 Track B，可與 Track D 並行）
> Repo: `C:\ai_agent\thyra`
> Spec: `docs/storage/promotion-handoff-schema-v0.md`

## 核心設計

Build the promotion handoff flow: schema validation, checklist evaluation, and package generation for `arch-spec → project-plan` and `arch-spec → thyra-runtime`.

Depends on Track B's `SourceRef` type and `generateId()`.

---

## Step 1: Handoff Schema + Builder

**Files**:
- `src/promotion/schemas/handoff.ts`
- `src/promotion/handoff-builder.ts`

**Reference**: `docs/storage/promotion-handoff-schema-v0.md` §4-6

**Key changes**:

1. Create `src/promotion/schemas/handoff.ts`:
```ts
import { z } from 'zod';
import { SourceRefSchema } from '../../cross-layer';

export const StableObjectRefSchema = z.object({
  kind: z.enum([
    'decision-session', 'card', 'spec-file', 'shared-types',
    'commit-memo', 'promotion-check', 'canonical-slice'
  ]),
  id: z.string(),
  path: z.string().optional(),
  note: z.string().optional(),
});

export const SourceLinkSchema = z.object({
  kind: z.enum(['session', 'spec', 'event', 'precedent']),
  ref: z.string(),
  whyRelevant: z.string().optional(),
});

export const ProjectPlanPayloadSchema = z.object({
  projectName: z.string(),
  coreQuestion: z.string(),
  canonicalFormSummary: z.string(),
  firstClassNouns: z.array(z.string()),
  stableNames: z.array(z.string()),
  invariantRules: z.array(z.string()),
  moduleBoundaries: z.array(z.string()),
  sharedTypesPath: z.string().optional(),
  requiredSpecs: z.array(z.object({
    path: z.string(),
    role: z.enum(['overview', 'canonical-form', 'schema', 'rules', 'api', 'slice', 'demo-path', 'handoff']),
  })),
  canonicalSliceSummary: z.string().optional(),
  demoPathSummary: z.string().optional(),
  planningHints: z.object({
    likelyTracks: z.array(z.string()),
    obviousDependencies: z.array(z.string()),
    suggestedValidationTargets: z.array(z.string()),
  }),
});

export const ThyraRuntimePayloadSchema = z.object({
  worldSlug: z.string(),
  worldForm: z.string(),
  canonicalCyclePath: z.string(),
  sharedTypesPath: z.string().optional(),
  runtimeApiPath: z.string().optional(),
  judgmentRulesPath: z.string().optional(),
  metricsPath: z.string().optional(),
  minimumWorld: z.object({
    summary: z.string(),
    keyStateObjects: z.array(z.string()),
    keyChangeKinds: z.array(z.string()),
    keyMetrics: z.array(z.string()),
    keyRoles: z.array(z.string()),
  }),
  closureTarget: z.object({
    story: z.string(),
    mustDemonstrate: z.array(z.string()),
  }),
  runtimeConstraints: z.object({
    mustNotViolate: z.array(z.string()),
    requiresHumanApproval: z.array(z.string()).optional(),
    rollbackExpectations: z.array(z.string()).optional(),
  }),
});

export const PromotionHandoffSchema = z.object({
  id: z.string(),
  fromLayer: z.enum(['volva-working', 'arch-spec']),
  toLayer: z.enum(['project-plan', 'thyra-runtime']),
  targetId: z.string(),
  title: z.string(),
  summary: z.string(),
  promotionVerdict: z.enum(['ready', 'partial', 'not_ready']),
  whyNow: z.array(z.string()),
  blockersResolved: z.array(z.string()),
  knownGaps: z.array(z.string()),
  stableObjects: z.array(StableObjectRefSchema).min(1), // CONTRACT PROMO-01: non-empty
  constraints: z.array(z.string()),
  sourceLinks: z.array(SourceLinkSchema),
  handoffPayload: z.union([ProjectPlanPayloadSchema, ThyraRuntimePayloadSchema]),
  createdAt: z.string(),
});
```

2. Create `src/promotion/handoff-builder.ts`:
```ts
import { generateId } from '../cross-layer';

export function buildPromotionHandoff(input: BuildHandoffInput): PromotionHandoff {
  const id = generateId('handoff');
  // Validate stableObjects non-empty (PROMO-01)
  // Populate sourceLinks from input
  // Set createdAt
  return PromotionHandoffSchema.parse({ id, ...input, createdAt: new Date().toISOString() });
}
```

### Acceptance Criteria
```bash
bun run build
bun test src/promotion/schemas/handoff.test.ts
# PromotionHandoff validates both ProjectPlanPayload and ThyraRuntimePayload
# Empty stableObjects rejected (PROMO-01)
# Invalid fromLayer/toLayer rejected
# buildPromotionHandoff produces valid handoff with correct ID prefix
```

---

## Step 2: Checklist Evaluator

**Files**:
- `src/promotion/schemas/checklist.ts`
- `src/promotion/checklist-evaluator.ts`

**Reference**: `docs/storage/promotion-handoff-schema-v0.md` §7, `persistence-policy-v0.md` §10

**Key changes**:

1. Create `src/promotion/schemas/checklist.ts`:
```ts
export const PromotionChecklistSchema = z.object({
  id: z.string(),
  targetLayer: z.enum(['project-plan', 'thyra-runtime']),
  results: z.array(z.object({
    item: z.string(),
    passed: z.boolean(),
    note: z.string().optional(),
  })),
  verdict: z.enum(['ready', 'partial', 'not_ready']),
  createdAt: z.string(),
});
```

2. Create `src/promotion/checklist-evaluator.ts`:
```ts
export function evaluatePromotionChecklist(
  targetLayer: 'project-plan' | 'thyra-runtime',
  context: ChecklistContext
): PromotionChecklist {
  const items = targetLayer === 'project-plan'
    ? PROJECT_PLAN_CHECKLIST_ITEMS
    : THYRA_RUNTIME_CHECKLIST_ITEMS;
  // Evaluate each item against context
  // Verdict: all passed → "ready", some failed → "partial" or "not_ready"
}

const PROJECT_PLAN_CHECKLIST_ITEMS = [
  'Core terminology stable',
  'Canonical form exists',
  'Shared types clear',
  'Canonical slice exists',
  'Demo path runnable',
  'Module boundaries clear',
];

const THYRA_RUNTIME_CHECKLIST_ITEMS = [
  'World form selected',
  'Minimum world has shape',
  'Closure target clear',
  'Change/judgment/pulse/outcome defined',
  'Runtime constraints explicit',
];
```

### Acceptance Criteria
```bash
bun run build
bun test src/promotion/checklist-evaluator.test.ts
# project-plan checklist has 6 items
# thyra-runtime checklist has 5 items
# All passed → verdict "ready"
# Some failed → verdict "partial" or "not_ready"
# Checklist ID uses correct prefix
```

---

## Step 3: Packaging + Routes + Tests

**Files**:
- `src/promotion/handoff-packager.ts`
- `src/promotion/routes/promotion.ts`
- `src/promotion/handoff-builder.test.ts`
- `src/promotion/checklist-evaluator.test.ts`
- `src/promotion/handoff-packager.test.ts`

**Reference**: `promotion-handoff-schema-v0.md` §8 (package structure), CONTRACT THY-11

**Key changes**:

1. Create `src/promotion/handoff-packager.ts`:
```ts
export async function packageHandoff(handoff: PromotionHandoff): Promise<PackageResult> {
  // Write handoff.json (machine-readable)
  // Write checklist.json (evaluation results)
  // Write links.md (human-readable summary)
  // Return { dir, files }
}
```

2. Create API routes (Hono):
```
POST   /api/promotion/checklists          ← evaluate promotion readiness
POST   /api/promotion/handoffs            ← create + package handoff
GET    /api/promotion/handoffs/:id        ← retrieve handoff
GET    /api/promotion/handoffs            ← list handoffs
```

3. All routes return `{ ok: true, data }` or `{ ok: false, error: { code, message } }` (CONTRACT THY-11)

### Acceptance Criteria
```bash
bun run build
bun test src/promotion/
# packageHandoff produces handoff.json + checklist.json + links.md
# API routes return correct format
# Full flow: evaluate checklist → build handoff → package → retrieve
# Empty stableObjects rejected at API level
```

### Git Commit
```
feat(promotion): add promotion handoff engine with checklist and packaging

Implements promotion-handoff-schema-v0: PromotionHandoff schema with
ProjectPlanPayload and ThyraRuntimePayload variants, checklist evaluator
with per-target criteria, handoff packager producing JSON + markdown output.
```

---

## Track Completion Checklist
- [ ] C1: Handoff Zod schemas (6 types) + builder function
- [ ] C2: Checklist evaluator with project-plan + thyra-runtime criteria
- [ ] C3: Packager + API routes + integration tests
- [ ] `bun run build` zero errors
- [ ] `bun test src/promotion/` all pass
