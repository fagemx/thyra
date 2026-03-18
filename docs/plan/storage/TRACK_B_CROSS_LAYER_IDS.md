# Track B: Cross-Layer ID Infrastructure

> Batch 2（依賴 Track A）
> Repo: `C:\ai_agent\thyra`
> Spec: `docs/storage/cross-layer-ids-v0.md`

## 核心設計

Build the `SourceRef` type, ID prefix utilities, and validation functions that all cross-layer operations depend on. This is the shared infrastructure that Track C, D, and E all import.

---

## Step 1: SourceRef Type + ID Prefix Utilities

**Files**:
- `src/cross-layer/source-ref.ts`
- `src/cross-layer/id-generator.ts`

**Reference**: `docs/storage/cross-layer-ids-v0.md` §3 (prefix convention) + §4 (SourceRef type)

**Key changes**:

1. Create `src/cross-layer/source-ref.ts`:
```ts
import { z } from 'zod';

export const LayerSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
export type Layer = z.infer<typeof LayerSchema>;

export const SourceRefSchema = z.object({
  layer: LayerSchema,
  kind: z.string(),      // e.g. "decision-session", "spec-file", "world"
  id: z.string(),        // e.g. "ds_abc123", "spec://thyra/..."
  note: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
```

2. Create `src/cross-layer/id-generator.ts`:
```ts
import { nanoid } from 'nanoid';

// ID prefixes for storage pack scope (L1, promotion, L5). L3/L4 prefixes defined separately.
export const ID_PREFIXES = {
  // L1 — Völva Working State
  decision_session: 'ds',
  card: 'card',
  candidate: 'cand',
  probe: 'probe',
  signal: 'sig',
  commit_memo: 'commit',
  promotion_check: 'promo',
  checklist: 'chk',
  decision_event: 'evt',

  // Promotion layer
  handoff: 'handoff',
  rollback: 'rollback',

  // L5 — Edda
  precedent: 'prec',
  decision_trace: 'dec',
  suggestion: 'sug',
} as const;

export type IdPrefix = typeof ID_PREFIXES[keyof typeof ID_PREFIXES];

export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${nanoid(12)}`;
}

export function extractPrefix(id: string): string | null {
  const match = id.match(/^([a-z]+)_/);
  return match ? match[1] : null;
}
```

### Acceptance Criteria
```bash
bun run build
# src/cross-layer/source-ref.ts compiles
# src/cross-layer/id-generator.ts compiles
# SourceRefSchema.safeParse validates correct inputs
# SourceRefSchema.safeParse rejects invalid layer values
# generateId("ds") produces "ds_xxxxxxxxxxxx" format
# extractPrefix("ds_abc123") returns "ds"
```

---

## Step 2: Validation + Tests

**Files**:
- `src/cross-layer/validators.ts`
- `src/cross-layer/source-ref.test.ts`
- `src/cross-layer/id-generator.test.ts`
- `src/cross-layer/index.ts`

**Reference**: `docs/storage/cross-layer-ids-v0.md` §4 (rules) + CONTRACT.md ID-01/ID-03

**Key changes**:

1. Create `src/cross-layer/validators.ts`:
```ts
import { SourceRef, SourceRefSchema, LayerSchema } from './source-ref';
import { ID_PREFIXES, extractPrefix } from './id-generator';

export function validateSourceRef(ref: unknown): { ok: true; data: SourceRef } | { ok: false; error: string } {
  const result = SourceRefSchema.safeParse(ref);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0].message };
  }
  return { ok: true, data: result.data };
}

export function validateIdPrefix(id: string): boolean {
  const prefix = extractPrefix(id);
  if (!prefix) return false;
  const knownPrefixes = Object.values(ID_PREFIXES);
  return (knownPrefixes as readonly string[]).includes(prefix);
}

export function isValidLayer(layer: string): boolean {
  return LayerSchema.safeParse(layer).success;
}
```

2. Create barrel export `src/cross-layer/index.ts`:
```ts
export { SourceRef, SourceRefSchema, LayerSchema, type Layer } from './source-ref';
export { generateId, extractPrefix, ID_PREFIXES, type IdPrefix } from './id-generator';
export { validateSourceRef, validateIdPrefix, isValidLayer } from './validators';
```

3. Tests covering:
- All 6 layer values accepted (L0-L5)
- Invalid layer rejected ("L6", "foo", "")
- All prefix conventions from ID_PREFIXES generate valid IDs
- `extractPrefix` works on all known formats
- `validateIdPrefix` accepts known, rejects unknown
- L0 SourceRef accepted (layer: "L0", kind: "conversation", id: "user-message-xxx")
- L2 spec:// URI format accepted

### Acceptance Criteria
```bash
bun run build
bun test src/cross-layer/
# All validators work correctly
# All 13 ID prefixes tested
# L0-L5 layers validated
# Invalid inputs rejected
# Index barrel exports all public API
```

### Git Commit
```
feat(cross-layer): add SourceRef type, ID prefix utilities, and validators

Implements cross-layer-ids-v0: SourceRef Zod schema with L0-L5 layers,
generateId() with 13 prefix conventions, extractPrefix(), validateSourceRef(),
validateIdPrefix(). Shared infrastructure for promotion, ingestion, and rollback.
```

---

## Track Completion Checklist
- [ ] B1: SourceRef Zod schema + ID prefix map + generateId + extractPrefix
- [ ] B2: Validators + tests + barrel export
- [ ] `bun run build` zero errors
- [ ] `bun test src/cross-layer/` all pass
