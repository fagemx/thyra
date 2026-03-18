# Track E: Promotion Rollback

> Batch 4（依賴 Track C）
> Repo: `C:\ai_agent\thyra`
> Spec: `docs/storage/promotion-rollback-v0.md`

## 核心設計

Build the safe rollback mechanism for premature promotions: produce rollback memos, mark downstream artifacts as suspended, and trigger Edda auto-ingest.

Depends on Track C's `PromotionHandoff` (the thing being rolled back) and Track D's ingestion interface (rollback is an auto-ingest trigger).

---

## Step 1: Rollback Schema + Engine

**Files**:
- `src/promotion/schemas/rollback.ts`
- `src/promotion/rollback-engine.ts`

**Reference**: `docs/storage/promotion-rollback-v0.md` §3-5

**Key changes**:

1. Create `src/promotion/schemas/rollback.ts`:
```ts
import { z } from 'zod';

export const PromotionRollbackMemoSchema = z.object({
  id: z.string(),                         // rollback_...
  originalHandoffId: z.string(),          // CONTRACT PROMO-03: always populated
  fromLayer: z.enum(['project-plan', 'thyra-runtime']),
  toLayer: z.literal('arch-spec'),

  reason: z.string(),
  discoveredProblems: z.array(z.string()),
  specsNeedingReview: z.array(z.string()),
  whatStillValid: z.array(z.string()),
  whatInvalidated: z.array(z.string()),

  eddaRecordId: z.string().optional(),
  createdAt: z.string(),
});

export type PromotionRollbackMemo = z.infer<typeof PromotionRollbackMemoSchema>;
```

2. Create `src/promotion/rollback-engine.ts`:
```ts
import { generateId } from '../cross-layer';
import { PromotionRollbackMemoSchema, type PromotionRollbackMemo } from './schemas/rollback';

export interface RollbackInput {
  originalHandoffId: string;
  fromLayer: 'project-plan' | 'thyra-runtime';
  reason: string;
  discoveredProblems: string[];
  specsNeedingReview: string[];
  whatStillValid: string[];
  whatInvalidated: string[];
}

export function createRollbackMemo(input: RollbackInput): PromotionRollbackMemo {
  const id = generateId('rollback');
  return PromotionRollbackMemoSchema.parse({
    id,
    ...input,
    toLayer: 'arch-spec',
    createdAt: new Date().toISOString(),
  });
}

// Mark downstream artifacts as suspended — NOT deleted (CONTRACT PROMO-02)
export type SuspendableType = 'planning-pack' | 'runtime-world';

export interface SuspendResult {
  type: SuspendableType;
  targetId: string;
  previousStatus: string;
  newStatus: 'suspended';
}

export function markSuspended(
  type: SuspendableType,
  targetId: string,
  db: Database
): SuspendResult {
  // Update status to 'suspended' — never DELETE
  // Return previous status for audit
}
```

### Acceptance Criteria
```bash
bun run build
# PromotionRollbackMemo schema compiles
# createRollbackMemo produces valid memo with rollback_ prefix
# originalHandoffId is always required (PROMO-03)
# markSuspended sets status to 'suspended', never deletes (PROMO-02)
```

---

## Step 2: Routes + Tests

**Files**:
- `src/promotion/routes/rollback.ts`
- `src/promotion/rollback-engine.test.ts`

**Reference**: `promotion-rollback-v0.md` §6 (rollback flow), CONTRACT PROMO-02/03, THY-11

**Key changes**:

1. Create API routes:
```
POST   /api/promotion/rollbacks           ← create rollback memo + suspend downstream
GET    /api/promotion/rollbacks/:id       ← retrieve rollback memo
GET    /api/promotion/rollbacks           ← list rollback memos
```

2. Rollback flow:
```
POST /api/promotion/rollbacks
  → validate input (originalHandoffId required)
  → create PromotionRollbackMemo
  → markSuspended on downstream artifact
  → trigger Edda auto-ingest (decision.rollback event)
  // Edda bridge: fire-and-forget HTTP POST to Edda's ingestion endpoint
  // Uses existing edda-bridge pattern (see src/edda-bridge.ts)
  // POST ${EDDA_URL}/api/ingestion/evaluate { eventType: "decision.rollback", sourceRefs: [...] }
  → return { ok: true, data: { memo, suspendResult } }
```

3. All routes return `{ ok: true, data }` or `{ ok: false, error: { code, message } }` (CONTRACT THY-11)

4. Tests covering:
- **Type A rollback**: project-plan → arch-spec
  - Planning pack marked suspended
  - Rollback memo references original handoff
  - Edda auto-ingest triggered
- **Type B rollback**: thyra-runtime → arch-spec
  - Runtime world marked suspended
  - Rollback memo references original handoff
  - Edda auto-ingest triggered
- **Rejection cases**:
  - Missing originalHandoffId → rejected
  - originalHandoffId doesn't exist → error
  - Already suspended → idempotent (no error)

### Acceptance Criteria
```bash
bun run build
bun test src/promotion/rollback-engine.test.ts
# Type A rollback: planning pack suspended, memo valid, Edda triggered
# Type B rollback: runtime world suspended, memo valid, Edda triggered
# originalHandoffId always populated (PROMO-03)
# Downstream marked suspended, never deleted (PROMO-02)
# ID chain unbroken: memo.originalHandoffId → handoff.id
# API routes return correct format (THY-11)
```

### Git Commit
```
feat(promotion): add promotion rollback with suspended state and Edda trigger

Implements promotion-rollback-v0: PromotionRollbackMemo schema,
createRollbackMemo() with rollback_ prefix, markSuspended() that
never deletes, Edda auto-ingest trigger on rollback. Supports
both Type A (project-plan → arch-spec) and Type B (thyra-runtime → arch-spec).
```

---

## Track Completion Checklist
- [ ] E1: PromotionRollbackMemo schema + createRollbackMemo + markSuspended
- [ ] E2: Rollback API routes + Type A/B tests + Edda trigger integration
- [ ] `bun run build` zero errors
- [ ] `bun test src/promotion/rollback-engine.test.ts` all pass
