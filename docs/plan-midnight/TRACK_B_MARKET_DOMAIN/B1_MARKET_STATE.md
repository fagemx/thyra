# B1: Market State Schema + DB Tables

> **Layer**: L0
> **Dependencies**: 無（可跟 Track A 並行）
> **Blocks**: B2, C1, D1
> **Output**: `src/market/` 模組 + `src/schemas/market.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/plan-midnight/CONTRACT.md          # STATE-01, STATE-02
cat src/db.ts                               # DB patterns, initSchema
cat src/village-manager.ts                  # CRUD pattern 參考
cat src/schemas/village.ts                  # Zod schema pattern
cat docs/營運/營運5.md                       # MVP state 定義
bun run build
```

---

## 實作

### DB Tables（加入 initSchema）

```sql
-- 區域
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,          -- 'main_street' | 'side_alley' | 'stage' | 'entrance'
  capacity INTEGER NOT NULL,
  current_load INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (village_id) REFERENCES villages(id)
);

-- 攤位
CREATE TABLE IF NOT EXISTS stalls (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT,                  -- creator ID or null (empty stall)
  category TEXT,               -- 'food' | 'craft' | 'art' | 'vintage' | ...
  rank INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'spotlight' | 'closed'
  metadata TEXT,               -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (village_id) REFERENCES villages(id),
  FOREIGN KEY (zone_id) REFERENCES zones(id)
);

-- 活動時段
CREATE TABLE IF NOT EXISTS event_slots (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL,
  zone_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER,
  booked INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'full' | 'active' | 'ended'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (village_id) REFERENCES villages(id)
);

-- 訂單 / 交易
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL,
  stall_id TEXT,
  slot_id TEXT,
  buyer TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'purchase' | 'booking' | 'commission'
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (village_id) REFERENCES villages(id)
);

-- 市場指標
CREATE TABLE IF NOT EXISTS market_metrics (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  total_visitors INTEGER NOT NULL DEFAULT 0,
  active_stalls INTEGER NOT NULL DEFAULT 0,
  active_events INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  incidents INTEGER NOT NULL DEFAULT 0,
  satisfaction REAL NOT NULL DEFAULT 0,  -- 0-100
  metadata TEXT,
  FOREIGN KEY (village_id) REFERENCES villages(id)
);
```

### Zod Schemas（`src/schemas/market.ts`）

```typescript
export const CreateZoneInput = z.object({ ... });
export const CreateStallInput = z.object({ ... });
export const BookSlotInput = z.object({ ... });
export const CreateOrderInput = z.object({ ... });
```

### MarketState model（`src/market/state.ts`）

```typescript
export interface MarketState {
  zones: Zone[];
  stalls: Stall[];
  event_slots: EventSlot[];
  orders: Order[];
  metrics: MarketMetrics | null;
  assembled_at: string;
}

export function assembleMarketState(db: Database, villageId: string): MarketState
```

### Module files

- `src/market/state.ts` — assembleMarketState
- `src/market/stalls.ts` — StallManager (CRUD + ranking)
- `src/market/zones.ts` — ZoneManager (CRUD + load tracking)
- `src/market/slots.ts` — SlotManager (booking + capacity)

---

## 驗收

```bash
bun run build && bun run lint
bun test src/market/
```

## Git Commit

```
feat(market): add market domain model with zones, stalls, slots, orders
```
