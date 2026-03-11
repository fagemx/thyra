# T1_03: Village Manager Core

> **Layer**: L0
> **Dependencies**: T1_02（DB + audit helper）
> **Blocks**: T1_04（routes + tests）, T2, T3, T7
> **Output**: `src/village-manager.ts`, `src/schemas/village.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-04, THY-05, THY-11
cat docs/THYRA/TRACKS.md               # import path: src/village-manager.ts
cat src/db.ts                          # 確認 T1_02 完成
bun run build                          # 基線通過
```

---

## 最終結果

```
src/
  schemas/village.ts         # Zod: CreateVillageInput, UpdateVillageInput
  village-manager.ts         # VillageManager class: create/get/list/update/archive
```

---

## 實作

### src/schemas/village.ts

```typescript
import { z } from 'zod';

export const CreateVillageInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  target_repo: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateVillageInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  target_repo: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateVillageInput = z.infer<typeof CreateVillageInput>;
export type UpdateVillageInput = z.infer<typeof UpdateVillageInput>;
```

### src/village-manager.ts

完整實作見 `T1_VILLAGE_MANAGER.md` Step 4。

**關鍵方法簽名**：

```typescript
import type Database from 'better-sqlite3';
import { appendAudit } from './db';

export interface Village {
  id: string;              // "village-<uuid>"
  name: string;
  description: string;
  target_repo: string;
  status: 'active' | 'paused' | 'archived';
  metadata: Record<string, unknown>;
  version: number;         // THY-04: 每次 update +1
  created_at: string;      // THY-04: ISO 8601
  updated_at: string;
}

export class VillageManager {
  constructor(private db: Database.Database) {}

  create(input: CreateVillageInput, actor: string): Village
  get(id: string): Village | null
  list(filters?: { status?: string }): Village[]
  update(id: string, input: UpdateVillageInput, actor: string): Village
  archive(id: string, actor: string): void
}
```

**行為約束**：
- `create`: id = `village-${crypto.randomUUID()}`，version = 1
- `update`: version +1，updated_at 刷新，寫 audit（before + after）
- `archive`: 等同 `update(id, { status: 'archived' }, actor)`
- 所有寫入操作呼叫 `appendAudit`（THY-07）
- `list` 預設不篩 status，傳 `{ status: 'active' }` 只回 active

---

## 驗收

```bash
bun run build

bun -e "
  import { createDb, initSchema } from './src/db';
  import { VillageManager } from './src/village-manager';
  const db = createDb(':memory:');
  initSchema(db);
  const mgr = new VillageManager(db);
  const v = mgr.create({ name: 'test', target_repo: 'fagemx/test' }, 'human');
  console.log(v.id, v.version, v.status);  // village-xxx 1 active
  const updated = mgr.update(v.id, { name: 'renamed' }, 'human');
  console.log(updated.version, updated.name);  // 2 renamed
"
```
