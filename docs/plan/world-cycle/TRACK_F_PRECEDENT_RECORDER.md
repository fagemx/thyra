# Track F: Precedent Recorder

> Batch 3（依賴 Track C + E）
> Repo: `C:\ai_agent\thyra`
> Parent: `docs/plan/world-cycle/TRACKS.md` — Track F
> Spec: `docs/world-design-v0/shared-types.md` §6.10, `docs/world-design-v0/edda-ingestion-triggers-v0.md`

## 核心設計

Build the precedent recording pipeline that creates PrecedentRecords from completed OutcomeReports and sends them to Edda. Precedents are append-only (CONTRACT PREC-02) and must link to proposalId + outcomeReportId for full traceability (CONTRACT PREC-01). Edda bridge integration uses the existing fire-and-forget pattern from `src/edda-bridge.ts` (THY-06).

Depends on Track C (CycleRunner) and Track E (OutcomeReport as input).

---

## Step 1: PrecedentRecord Builder

**Files**:
- `src/schemas/precedent-record.ts`
- `src/canonical-cycle/precedent-recorder.ts`

**Reference**: `docs/world-design-v0/shared-types.md` §6.10 (PrecedentRecord type)

**Key changes**:

1. Create `src/schemas/precedent-record.ts`:
```ts
import { z } from 'zod';
import { ChangeKindSchema } from './change-proposal'; // existing or co-created
import { OutcomeVerdictSchema, OutcomeRecommendationSchema } from './outcome-report';

export const PrecedentRecordSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  worldType: z.string(),
  proposalId: z.string(),         // PREC-01: required
  outcomeReportId: z.string(),    // PREC-01: required
  changeKind: ChangeKindSchema,
  cycleId: z.string(),

  context: z.string(),            // description of world state when proposal was made
  decision: z.string(),           // what was decided (e.g., "throttle north gate entry to 60%")
  outcome: OutcomeVerdictSchema,
  recommendation: OutcomeRecommendationSchema,
  lessonsLearned: z.array(z.string()),
  contextTags: z.array(z.string()), // e.g., ["peak_hour", "festival_night", "north_gate"]

  createdAt: z.string(),
  version: z.number().int().default(1),
});
export type PrecedentRecord = z.infer<typeof PrecedentRecordSchema>;

export const CreatePrecedentInputSchema = z.object({
  worldId: z.string(),
  worldType: z.string(),
  proposalId: z.string().min(1),    // PREC-01: cannot be empty
  outcomeReportId: z.string().min(1), // PREC-01: cannot be empty
  changeKind: ChangeKindSchema,
  cycleId: z.string(),
  context: z.string(),
  decision: z.string(),
  outcome: OutcomeVerdictSchema,
  recommendation: OutcomeRecommendationSchema,
  lessonsLearned: z.array(z.string()),
  contextTags: z.array(z.string()),
});
export type CreatePrecedentInput = z.infer<typeof CreatePrecedentInputSchema>;
```

2. Create `src/canonical-cycle/precedent-recorder.ts`:
```ts
import type { Database } from 'bun:sqlite';
import type { OutcomeReport } from '../schemas/outcome-report';
import type { PrecedentRecord, CreatePrecedentInput } from '../schemas/precedent-record';
import { CreatePrecedentInputSchema } from '../schemas/precedent-record';
import { nanoid } from 'nanoid';
import { appendAudit } from '../db';

export class PrecedentRecorder {
  constructor(private db: Database) {}

  /**
   * Build a PrecedentRecord from an OutcomeReport + context.
   * Auto-ingest trigger: beneficial or harmful outcomes automatically create precedents.
   * Neutral outcomes create precedents only if explicitly requested.
   * Inconclusive outcomes do NOT create precedents.
   */
  buildFromOutcome(
    report: OutcomeReport,
    context: PrecedentContext,
  ): PrecedentRecord | null {
    // Auto-ingest: beneficial/harmful always, neutral optional, inconclusive never
    if (report.verdict === 'inconclusive') return null;

    const input: CreatePrecedentInput = {
      worldId: context.worldId,
      worldType: context.worldType,
      proposalId: context.proposalId,
      outcomeReportId: report.id,
      changeKind: context.changeKind,
      cycleId: context.cycleId,
      context: context.worldStateDescription,
      decision: context.decisionDescription,
      outcome: report.verdict,
      recommendation: report.recommendation,
      lessonsLearned: this.extractLessons(report),
      contextTags: context.tags,
    };

    // Validate (PREC-01: proposalId + outcomeReportId required)
    CreatePrecedentInputSchema.parse(input);

    return this.create(input);
  }

  /**
   * Insert precedent into DB. Append-only — no UPDATE or DELETE (PREC-02).
   */
  create(input: CreatePrecedentInput): PrecedentRecord {
    const id = `prec_${nanoid(12)}`;
    const createdAt = new Date().toISOString();
    // INSERT only — never UPDATE or DELETE (PREC-02)
    appendAudit(this.db, 'precedent_record', id, 'created', { ...input }, 'system');
    return { id, ...input, createdAt };
  }

  get(id: string): PrecedentRecord | null { /* ... */ }
  listByWorld(worldId: string, filters?: PrecedentFilter): PrecedentRecord[] { /* ... */ }

  private extractLessons(report: OutcomeReport): string[] { /* ... */ }
}

export interface PrecedentContext {
  worldId: string;
  worldType: string;
  proposalId: string;
  changeKind: string;
  cycleId: string;
  worldStateDescription: string;
  decisionDescription: string;
  tags: string[];
}

export interface PrecedentFilter {
  changeKind?: string;
  verdict?: string;
  contextTag?: string;
}
```

3. DB table `precedent_records` (append-only — PREC-02):
```sql
CREATE TABLE IF NOT EXISTS precedent_records (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  world_type TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  outcome_report_id TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  context TEXT NOT NULL,
  decision TEXT NOT NULL,
  outcome TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  lessons_learned TEXT NOT NULL, -- JSON array
  context_tags TEXT NOT NULL,    -- JSON array
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- No UPDATE or DELETE triggers/permissions — append-only by convention + code review
```

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
```

**Git commit**: `feat(precedent): add PrecedentRecord builder with append-only storage`

---

## Step 2: Edda Bridge Integration + Tests

**Files**:
- `src/canonical-cycle/precedent-recorder.ts` (extend with Edda writeback)
- `src/canonical-cycle/precedent-recorder.test.ts`

**Reference**: `src/edda-bridge.ts` (existing fire-and-forget pattern), THY-06 (graceful degradation)

**Key changes**:

1. Extend `PrecedentRecorder` with optional Edda bridge:
```ts
import type { EddaBridge } from '../edda-bridge';

export class PrecedentRecorder {
  constructor(
    private db: Database,
    private eddaBridge?: EddaBridge, // optional DI — THY-06 graceful degradation
  ) {}

  /**
   * Record precedent and send to Edda.
   * Edda writeback is fire-and-forget — failure does not affect main flow.
   */
  async recordAndSync(
    report: OutcomeReport,
    context: PrecedentContext,
  ): Promise<PrecedentRecord | null> {
    const precedent = this.buildFromOutcome(report, context);
    if (!precedent) return null;

    // Fire-and-forget to Edda (THY-06)
    if (this.eddaBridge) {
      void this.sendToEdda(precedent).catch((_err) => {
        // Edda offline does not block governance — THY-06
      });
    }

    return precedent;
  }

  private async sendToEdda(precedent: PrecedentRecord): Promise<void> {
    if (!this.eddaBridge) return;
    // Use existing edda-bridge pattern:
    // POST to Edda's precedent ingestion endpoint
    // Map PrecedentRecord fields to Edda's expected format
    await this.eddaBridge.recordDecision({
      domain: 'world.precedent',
      aspect: precedent.changeKind,
      value: precedent.outcome,
      reason: precedent.lessonsLearned.join('; '),
    });
  }
}
```

2. Tests in `src/canonical-cycle/precedent-recorder.test.ts`:

**Test cases**:

| Test | Description | Key assertion |
|------|------------|---------------|
| precedent from beneficial outcome | Auto-creates precedent from beneficial report | PrecedentRecord created, verdict=beneficial |
| precedent from harmful outcome | Auto-creates precedent from harmful report | PrecedentRecord created, verdict=harmful |
| no precedent from inconclusive | Inconclusive outcomes do NOT generate precedent | buildFromOutcome returns null |
| PREC-01: proposalId required | Empty proposalId rejected | Zod validation error |
| PREC-01: outcomeReportId required | Empty outcomeReportId rejected | Zod validation error |
| PREC-02: no update/delete | PrecedentRecorder has no update/delete methods | Code structure assertion |
| Edda bridge called | When bridge provided, sends precedent | Mock bridge receives call |
| Edda bridge failure graceful | Bridge throws, precedent still persists | PrecedentRecord in DB, no throw |
| field completeness | All PrecedentRecord fields populated | Schema validation passes |
| context tags preserved | Tags from context appear in record | contextTags matches input |

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
bun test src/canonical-cycle/precedent-recorder.test.ts
```

**Git commit**: `feat(precedent): add Edda bridge integration with fire-and-forget writeback`

---

## Track Completion Checklist

- [ ] `bun run build` — zero TypeScript errors
- [ ] PrecedentRecord links to proposalId + outcomeReportId (PREC-01)
- [ ] Precedent is append-only — no UPDATE, no DELETE (PREC-02)
- [ ] Sends to Edda via existing edda-bridge (fire-and-forget, THY-06)
- [ ] Auto-ingest trigger: beneficial/harmful auto-record, inconclusive skipped
- [ ] All fields from shared-types §6.10 present: proposalId, outcomeReportId, changeKind, context, decision, outcome, recommendation, lessonsLearned, contextTags
- [ ] All entities have `id`, `created_at` (THY-04)
- [ ] All state changes write audit_log (THY-07)
- [ ] Tests: precedent creation, field validation, Edda bridge call, graceful degradation
- [ ] No `any`, no `!` assertions (THY-01)
