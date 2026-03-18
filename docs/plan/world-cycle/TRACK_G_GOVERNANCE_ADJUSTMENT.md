# Track G: Governance Adjustment Engine

> Batch 4（依賴 Track E）
> Repo: `C:\ai_agent\thyra`
> Parent: `docs/plan/world-cycle/TRACKS.md` — Track G
> Spec: `docs/world-design-v0/shared-types.md` §6.11

## 核心設計

Build the engine that produces GovernanceAdjustments when outcomes indicate harmful results or need for policy/law/chief changes. Adjustments only fire when verdict=harmful or recommendation=rollback/retune (CONTRACT ADJ-02). Every adjustment must specify target + before/after (CONTRACT ADJ-01).

Depends on Track E (OutcomeReport verdict + recommendation as trigger).

---

## Step 1: GovernanceAdjustment Schema + Engine

**Files**:
- `src/schemas/governance-adjustment.ts`
- `src/canonical-cycle/governance-adjuster.ts`

**Reference**: `docs/world-design-v0/shared-types.md` §6.11 (GovernanceAdjustment type), CONTRACT ADJ-01, ADJ-02

**Key changes**:

1. Create `src/schemas/governance-adjustment.ts`:
```ts
import { z } from 'zod';

export const AdjustmentTypeSchema = z.enum([
  'law_threshold',
  'chief_permission',
  'chief_style',
  'risk_policy',
  'simulation_policy',
]);
export type AdjustmentType = z.infer<typeof AdjustmentTypeSchema>;

export const AdjustmentStatusSchema = z.enum([
  'proposed',
  'approved',
  'applied',
  'rejected',
]);
export type AdjustmentStatus = z.infer<typeof AdjustmentStatusSchema>;

export const GovernanceAdjustmentSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  triggeredBy: z.string(), // outcomeReportId or precedentId

  adjustmentType: AdjustmentTypeSchema,
  target: z.string(),      // what law/chief/policy is being adjusted (ADJ-01)
  before: z.string(),      // current value (ADJ-01)
  after: z.string(),       // proposed value (ADJ-01)
  rationale: z.string(),

  status: AdjustmentStatusSchema,
  createdAt: z.string(),
  version: z.number().int().min(1),
});
export type GovernanceAdjustment = z.infer<typeof GovernanceAdjustmentSchema>;

export const CreateAdjustmentInputSchema = z.object({
  worldId: z.string(),
  triggeredBy: z.string(),
  adjustmentType: AdjustmentTypeSchema,
  target: z.string().min(1),   // ADJ-01: must specify target
  before: z.string(),          // ADJ-01: must specify before
  after: z.string(),           // ADJ-01: must specify after
  rationale: z.string().min(1),
});
export type CreateAdjustmentInput = z.infer<typeof CreateAdjustmentInputSchema>;
```

2. Create `src/canonical-cycle/governance-adjuster.ts`:
```ts
import type { Database } from 'bun:sqlite';
import type { OutcomeReport } from '../schemas/outcome-report';
import type { GovernanceAdjustment, CreateAdjustmentInput } from '../schemas/governance-adjustment';
import { CreateAdjustmentInputSchema } from '../schemas/governance-adjustment';
import { nanoid } from 'nanoid';
import { appendAudit } from '../db';

export class GovernanceAdjuster {
  constructor(private db: Database) {}

  /**
   * Evaluate an OutcomeReport and produce a GovernanceAdjustment if warranted.
   *
   * ADJ-02: Only fires when:
   * - verdict === 'harmful', OR
   * - recommendation === 'rollback' | 'retune'
   *
   * Returns null when no adjustment is needed (beneficial, neutral, watch).
   */
  evaluateOutcomeForAdjustment(
    report: OutcomeReport,
    context: AdjustmentContext,
  ): GovernanceAdjustment | null {
    // ADJ-02: Only fire on harmful verdict or rollback/retune recommendation
    const shouldAdjust =
      report.verdict === 'harmful' ||
      report.recommendation === 'rollback' ||
      report.recommendation === 'retune';

    if (!shouldAdjust) return null;

    const adjustmentType = this.inferAdjustmentType(report, context);
    const { target, before, after } = this.inferTargetChange(report, context);

    const input: CreateAdjustmentInput = {
      worldId: context.worldId,
      triggeredBy: report.id,
      adjustmentType,
      target,   // ADJ-01
      before,   // ADJ-01
      after,    // ADJ-01
      rationale: this.buildRationale(report),
    };

    return this.create(input);
  }

  /**
   * Create a GovernanceAdjustment in proposed status.
   * Must go through change proposal / judgment flow to be applied (world-cycle-api §17.3).
   */
  create(input: CreateAdjustmentInput): GovernanceAdjustment {
    CreateAdjustmentInputSchema.parse(input);
    const id = `adj_${nanoid(12)}`;
    const createdAt = new Date().toISOString();

    // INSERT into governance_adjustments
    appendAudit(this.db, 'governance_adjustment', id, 'created', { ...input }, 'system');

    return {
      id,
      ...input,
      status: 'proposed',
      createdAt,
      version: 1,
    };
  }

  get(id: string): GovernanceAdjustment | null { /* ... */ }
  listByWorld(worldId: string): GovernanceAdjustment[] { /* ... */ }

  /**
   * Transition status: proposed → approved → applied, or proposed → rejected.
   */
  transition(id: string, to: 'approved' | 'applied' | 'rejected'): GovernanceAdjustment {
    /* validate transitions, update DB, append audit */
    throw new Error('Not implemented');
  }

  /**
   * Infer which governance lever to adjust based on the outcome report.
   * - Side effect on fairness → law_threshold
   * - Chief exceeded permissions → chief_permission
   * - Risk assessment was wrong → risk_policy
   */
  private inferAdjustmentType(
    report: OutcomeReport,
    _context: AdjustmentContext,
  ): GovernanceAdjustment['adjustmentType'] {
    // Default inference logic:
    // If significant side effects on fairness metrics → law_threshold
    // If recommendation is rollback → risk_policy (thresholds too loose)
    // If recommendation is retune → law_threshold (parameters need refinement)
    const hasSignificantSideEffects = report.sideEffects.some(
      se => se.severity === 'significant' && !se.acceptable
    );

    if (report.recommendation === 'rollback') return 'risk_policy';
    if (hasSignificantSideEffects) return 'law_threshold';
    return 'law_threshold'; // default
  }

  private inferTargetChange(
    report: OutcomeReport,
    context: AdjustmentContext,
  ): { target: string; before: string; after: string } {
    // Derive from the primary metric that failed or the most significant side effect
    // Context provides the governance objects (law ID, chief ID) that were active
    return {
      target: context.activeTarget,
      before: context.currentValue,
      after: context.suggestedValue,
    };
  }

  private buildRationale(report: OutcomeReport): string {
    const parts: string[] = [];
    parts.push(`Outcome verdict: ${report.verdict}`);
    parts.push(`Recommendation: ${report.recommendation}`);
    if (!report.primaryObjectiveMet) {
      parts.push('Primary objective was not met');
    }
    const significantSides = report.sideEffects.filter(se => se.severity === 'significant');
    if (significantSides.length > 0) {
      parts.push(`Significant side effects on: ${significantSides.map(s => s.metric).join(', ')}`);
    }
    return parts.join('. ');
  }
}

export interface AdjustmentContext {
  worldId: string;
  activeTarget: string;   // e.g., "laws.flow_control.peakInterventionThreshold"
  currentValue: string;    // e.g., "85"
  suggestedValue: string;  // e.g., "78"
}
```

3. DB table `governance_adjustments`:
```sql
CREATE TABLE IF NOT EXISTS governance_adjustments (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,
  target TEXT NOT NULL,
  before_value TEXT NOT NULL,
  after_value TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
```

**Git commit**: `feat(governance): add GovernanceAdjustment schema and evaluation engine`

---

## Step 2: Adjustment Routes + Tests

**Files**:
- `src/routes/adjustments.ts`
- `src/canonical-cycle/governance-adjuster.test.ts`

**Reference**: `docs/world-design-v0/world-cycle-api.md` §17 (Governance Adjustment APIs), CONTRACT API-01, API-02

**Key changes**:

1. Create `src/routes/adjustments.ts`:
```ts
import { Hono } from 'hono';
import { GovernanceAdjuster } from '../canonical-cycle/governance-adjuster';
import { CreateAdjustmentInputSchema } from '../schemas/governance-adjustment';

const app = new Hono();

// POST /api/v1/worlds/:id/governance-adjustments — §17.1
app.post('/api/v1/worlds/:id/governance-adjustments', async (c) => {
  const worldId = c.req.param('id');
  const body = await c.req.json();
  const parsed = CreateAdjustmentInputSchema.safeParse({ ...body, worldId });
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);
  }
  // const adjuster = new GovernanceAdjuster(db);
  // const adjustment = adjuster.create(parsed.data);
  // return c.json({ ok: true, data: adjustment }, 201);
});

// GET /api/v1/worlds/:id/governance-adjustments — §17.2
app.get('/api/v1/worlds/:id/governance-adjustments', async (c) => {
  const worldId = c.req.param('id');
  // const adjuster = new GovernanceAdjuster(db);
  // const adjustments = adjuster.listByWorld(worldId);
  // return c.json({ ok: true, data: adjustments });
});

// POST /api/v1/governance-adjustments/:id/apply — §17.3
// Note: This should fall back through change proposal / judgment mechanism
app.post('/api/v1/governance-adjustments/:id/apply', async (c) => {
  // const adjustmentId = c.req.param('id');
  // Transition to applied — but only after going through judgment
  // return c.json({ ok: true, data: { ... } });
});

export { app as adjustmentRoutes };
```

2. Tests in `src/canonical-cycle/governance-adjuster.test.ts`:

**Test cases**:

| Test | Description | Key assertion |
|------|------------|---------------|
| harmful → adjustment | Harmful verdict triggers adjustment | evaluateOutcomeForAdjustment returns GovernanceAdjustment |
| rollback → adjustment | Rollback recommendation triggers adjustment | result !== null, adjustmentType populated |
| retune → adjustment | Retune recommendation triggers adjustment | result !== null |
| beneficial → no adjustment | Beneficial verdict does NOT trigger | evaluateOutcomeForAdjustment returns null |
| neutral → no adjustment | Neutral verdict does NOT trigger | returns null |
| watch → no adjustment | Watch recommendation (without harmful) does NOT trigger | returns null |
| ADJ-01: target required | Empty target rejected | Zod validation error |
| ADJ-01: before/after required | before and after must be specified | Schema validation passes |
| adjustmentType values | All 5 types accepted | law_threshold, chief_permission, chief_style, risk_policy, simulation_policy |
| status lifecycle | proposed → approved → applied valid | Transition succeeds |
| POST route | Create adjustment via API | 201 + THY-11 envelope |
| GET route | List adjustments via API | 200 + THY-11 envelope |

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
bun test src/canonical-cycle/governance-adjuster.test.ts
```

**Git commit**: `feat(governance): add adjustment routes and trigger condition tests`

---

## Track Completion Checklist

- [ ] `bun run build` — zero TypeScript errors
- [ ] Adjustment fires when verdict=harmful or recommendation=rollback/retune (ADJ-02)
- [ ] Adjustment specifies target + before/after (ADJ-01)
- [ ] adjustmentType: law_threshold / chief_permission / chief_style / risk_policy / simulation_policy
- [ ] Status lifecycle: proposed → approved → applied / rejected
- [ ] POST /api/v1/worlds/:id/governance-adjustments works (API-02)
- [ ] GET /api/v1/worlds/:id/governance-adjustments works (API-02)
- [ ] All routes use THY-11 envelope (API-01)
- [ ] All entities have `id`, `created_at`, `version` (THY-04)
- [ ] All state changes write audit_log (THY-07)
- [ ] Tests: harmful→adjustment, neutral→no adjustment, schema validation, routes
- [ ] No `any`, no `!` assertions (THY-01)
