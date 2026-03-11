# T1_02: DB Layer + Audit Log

> **Layer**: L0
> **Dependencies**: T1_01（專案骨架存在）
> **Blocks**: T1_03（Village CRUD 需要 DB）
> **Output**: `src/db.ts` — createDb, initSchema, audit helper

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-04（id+created_at+version）, THY-07（audit log）
cat docs/THYRA/TRACKS.md               # module path: src/db.ts
cat src/index.ts                       # 確認 T1_01 完成
bun run build                          # 基線通過
```

---

## 最終結果

```
src/
  db.ts                      # createDb, initSchema, appendAudit
```

`bun run build` 通過。`initSchema` 建出 `villages` + `audit_log` 表。

---

## 實作

### src/db.ts

```typescript
import Database from 'better-sqlite3';
import path from 'path';

export function createDb(dbPath?: string): Database.Database {
  const db = new Database(dbPath ?? path.join(process.cwd(), 'thyra.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS villages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_repo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','paused','archived')),
      metadata TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_entity
      ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_time
      ON audit_log(created_at);
  `);
}

/**
 * Append-only audit log（THY-07）
 * 所有狀態變更模組共用此 helper
 */
export function appendAudit(
  db: Database.Database,
  entityType: string,
  entityId: string,
  action: string,
  payload: unknown,
  actor: string,
): void {
  db.prepare(`
    INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entityType, entityId, action, JSON.stringify(payload), actor, new Date().toISOString());
}
```

**注意**：後續 Track（T2-T7）會在 `initSchema` 裡加各自的 table。用 `CREATE TABLE IF NOT EXISTS` 保證冪等。

---

## 驗收

```bash
bun run build

# 驗證 schema
bun -e "
  import { createDb, initSchema } from './src/db';
  const db = createDb(':memory:');
  initSchema(db);
  const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
  console.log(tables.map(t => t.name));
  // 預期: ['villages', 'audit_log']
"
```
