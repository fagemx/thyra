# T6_01: Schema + DB Table

> **Layer**: L3
> **Dependencies**: T1_02（DB Layer）
> **Blocks**: T6_02
> **Output**: `loop_cycles` table + `LoopCycle` / `LoopAction` 型別

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-08（timeout 保護）
cat docs/THYRA/T6_LOOP_RUNNER.md       # Step 1 DB Schema
cat src/db.ts                          # initSchema，加 loop_cycles table
bun run build
```

---

## 實作

### DB table

```sql
CREATE TABLE IF NOT EXISTS loop_cycles (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL REFERENCES villages(id),
  chief_id TEXT NOT NULL REFERENCES chiefs(id),
  trigger TEXT NOT NULL CHECK(trigger IN ('scheduled','event','manual')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','completed','timeout','aborted')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  laws_proposed TEXT NOT NULL DEFAULT '[]',
  laws_enacted TEXT NOT NULL DEFAULT '[]',
  cost_incurred REAL NOT NULL DEFAULT 0,
  budget_remaining REAL NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cycle_village ON loop_cycles(village_id, status);
```

### LoopCycle 型別

```typescript
export interface LoopCycle {
  id: string;
  village_id: string;
  chief_id: string;
  trigger: 'scheduled' | 'event' | 'manual';
  status: 'running' | 'completed' | 'timeout' | 'aborted';
  started_at: string;
  ended_at?: string;
  actions: LoopAction[];
  laws_proposed: string[];
  laws_enacted: string[];
  cost_incurred: number;
  budget_remaining: number;
}
```

### LoopAction 型別

```typescript
export interface LoopAction {
  id: string;
  type: 'observe' | 'propose_law' | 'execute' | 'evaluate';
  description: string;
  risk_level: 'low' | 'medium' | 'high';
  outcome: 'success' | 'failure' | 'blocked' | 'pending_approval';
  karvi_task_id?: string;
  edda_query_id?: string;
}
```

完整程式碼見 `T6_LOOP_RUNNER.md` Step 1。

---

## 驗收

```bash
bun run build
# loop_cycles table 存在
# LoopCycle / LoopAction 型別可 import
```
