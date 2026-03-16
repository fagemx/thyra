# Midnight Market Night Engine — Track 拆解

## 層級定義

- **L0 基礎設施**：World API（WorldManager + routes）+ Market Domain（市場特有 state model）
- **L1 內容 + 觀測**：Night Template + Platform Adapters + Pulse/Bridge
- **L2 運行 + 介面**：Night Engine Runtime + Owned Surface（tonight page + checkout）

## DAG

```
L0 基礎設施
  [A] World API        [B] Market Domain
   │                     │
   ├─────────────────────┤
   │         │           │
   ▼         ▼           ▼
L1 內容 + 觀測
  [C] Night    [F] Platform    [G] Pulse +
  Template     Adapters        Bridge
   │             │               │
   ├─────────────┤               │
   ▼             ▼               ▼
L2 運行 + 介面
  [D] Night Engine             [E] Owned Surface
  (chiefs + scheduler)         (tonight + summary + checkout)
```

## Track → Step 對照

### A: World API Closure（L0）
```
TRACK_A_WORLD_API/
  A1_WORLD_MANAGER.md            ← WorldManager orchestrator（整合 world/*.ts）
  A2_PACK_APPLY.md               ← POST /api/villages/pack/apply
  A3_WORLD_ROUTES.md             ← 7 world API endpoints + mount
```

### B: Market Domain Model（L0）
```
TRACK_B_MARKET_DOMAIN/
  B1_MARKET_STATE.md             ← zones/stalls/slots/orders/metrics DB schema + model
  B2_MARKET_ROUTES.md            ← market-specific CRUD routes
```

### C: Night Template（L1）
```
TRACK_C_NIGHT_TEMPLATE/
  C1_TEMPLATE_YAML.md            ← midnight-market.yaml + market skills
  C2_TEMPLATE_SEEDING.md         ← pack/apply seeding + validation
```

### D: Night Engine Runtime（L2）
```
TRACK_D_NIGHT_ENGINE/
  D1_CHIEF_PROTOCOL.md           ← 6 responsibilities: 排位/補位/節奏/限流/summary/rollback
  D2_GOVERNANCE_SCHEDULER.md     ← 15-30 min cycle timer
  D3_SUMMARY_GENERATOR.md        ← morning digest + precedent recording
```

### E: Owned Surface（L2）
```
TRACK_E_OWNED_SURFACE/
  E1_TONIGHT_PAGE.md             ← event page: stall map + zones + live status
  E2_MORNING_SUMMARY.md          ← summary page: 昨晚發生了什麼
  E3_CHECKOUT.md                 ← slot purchase + order management
```

### F: Platform Adapters（L1）
```
TRACK_F_PLATFORM_ADAPTERS/
  F1_ADAPTER_INTERFACE.md        ← adapter contract + registry
  F2_FIRST_ADAPTERS.md           ← X adapter + Discord adapter (MVP)
```

### G: Pulse + Bridge（L1）
```
TRACK_G_PULSE_BRIDGE/
  G1_HEALTH_SSE.md               ← health metrics + SSE endpoint
  G2_BRIDGE_WIRING.md            ← Edda precedent + Karvi dispatch
```

## Module Import 路徑

```
src/
  world-manager.ts               ← A1（整合 world/*.ts）
  schemas/
    world.ts                     ← (exists)
    market.ts                    ← B1（MarketState, Zone, Stall, EventSlot, Order）
  routes/
    world.ts                     ← A3
    pack.ts                      ← A2
    market.ts                    ← B2（market CRUD）
  world/
    state.ts ... judge.ts ...    ← (all exist)
    health.ts                    ← G1
  market/
    state.ts                     ← B1（assembleMarketState）
    stalls.ts                    ← B1（stall CRUD + ranking）
    zones.ts                     ← B1（zone management）
    slots.ts                     ← B1（event slot booking）
  chief-autonomy.ts              ← D1
  governance-scheduler.ts        ← D2
  summary-generator.ts           ← D3
  adapters/
    interface.ts                 ← F1（AdapterAction, Adapter interface）
    registry.ts                  ← F1
    x-adapter.ts                 ← F2
    discord-adapter.ts           ← F2
  sse.ts                         ← G1

templates/
  midnight-market.yaml           ← C1

tonight/                         ← E1-E3（React + Vite）
  src/
    pages/Tonight.tsx            ← E1
    pages/Summary.tsx            ← E2
    pages/Checkout.tsx           ← E3
    components/StallMap.tsx       ← E1
    components/LiveStatus.tsx     ← E1
    api/client.ts                ← E1
```

## 跨模組依賴圖

```
world/*.ts (pure functions)
  ↑
world-manager.ts ← routes/world.ts
                 ← chief-autonomy.ts
                 ← governance-scheduler.ts

market/*.ts ← routes/market.ts
            ← chief-autonomy.ts (reads market state)
            ← adapters/*.ts (reads market state for posting)

chief-autonomy.ts ← governance-scheduler.ts
governance-scheduler.ts → adapters/registry.ts (fire-and-forget)
governance-scheduler.ts → summary-generator.ts (end of night)

adapters/*.ts → (external: X API, Discord API)
             ← governance-scheduler.ts (triggered after apply)

tonight/ → (HTTP only) → routes/*.ts + SSE
```

**規則**：
- world-manager 是 world 操作唯一入口（WORLD-01）
- adapters 只讀 state，不寫（ADAPTER-02）
- tonight/ 不 import src/（SURFACE-01）
- platform 斷線不影響 governance（ADAPTER-01）

---

## Track Details

### Track A: World API Closure

**Layer**: L0
**Goal**: WorldManager + pack/apply + 7 world routes。讓 world 操作可透過 HTTP 進行。

**Input**: `src/world/*.ts`（已完成）, `src/schemas/world.ts`（已完成）
**Output**: WorldManager class, 7 endpoints, pack/apply endpoint

**Dependencies**: blocks: ALL | blocked-by: none

**DoD**:
- [ ] WorldManager.apply() 通過 judge→snapshot→apply→audit
- [ ] pack/apply 可建立 village
- [ ] 7 world routes mounted + tested
- [ ] `bun run build && bun test`

**Task Count**: 3

---

### Track B: Market Domain Model

**Layer**: L0
**Goal**: 定義 Market 特有的 state model（zones, stalls, event_slots, orders, metrics），讓 chiefs 有東西可以營運。

**Input**: `src/db.ts`（DB patterns）
**Output**: market/ 模組 + market routes + DB tables

**Dependencies**: blocks: C, D | blocked-by: none（可跟 A 並行）

**DoD**:
- [ ] `zones`, `stalls`, `event_slots`, `orders`, `market_metrics` tables 存在
- [ ] MarketState model: assembleMarketState(db, villageId)
- [ ] Stall CRUD + ranking
- [ ] Zone management
- [ ] Event slot booking
- [ ] Market routes mounted + tested
- [ ] `bun run build && bun test`

**Task Count**: 2

---

### Track C: Night Template

**Layer**: L1
**Goal**: midnight-market.yaml 定義 + seeding，一鍵建立 Market 世界。

**Input**: Track A (pack/apply), Track B (market schema)
**Output**: YAML + seeding tests + 可建立的 Market 世界

**Dependencies**: blocks: D | blocked-by: A, B

**DoD**:
- [ ] `templates/midnight-market.yaml` 存在
- [ ] 5 chiefs + 5 skills + constitution + market-specific config
- [ ] pack/apply → 201，world + market state 完整
- [ ] `bun test` seeding test 通過

**Task Count**: 2

---

### Track D: Night Engine Runtime

**Layer**: L2
**Goal**: 讓 chiefs 每 15-30 分鐘自動跑一輪：觀察 → 提案 → judge → apply → 對外執行 → summarize。這是「世界自己在動」的核心。

**Input**: Track A (WorldManager), Track C (已建立的世界), Track B (market state)
**Output**: chief-autonomy + governance-scheduler + summary-generator

**Dependencies**: blocks: none (final piece) | blocked-by: A, B, C

**DoD**:
- [ ] 6 responsibilities: 排位、補位、活動節奏、限流、summary、rollback
- [ ] Chiefs 提案經過 judge（CHIEF-01）
- [ ] 15-30 min cycle，可配置
- [ ] Summary generator 產生 morning digest
- [ ] Adapter actions fire-and-forget after apply
- [ ] `bun test` chief + scheduler + summary tests 通過

**Task Count**: 3

---

### Track E: Owned Surface

**Layer**: L2
**Goal**: 自有前台 — tonight page + morning summary + checkout。人類看到世界在活、能逛攤、能下單。

**Input**: Track A (world API), Track G (SSE pulse)
**Output**: React app with 3 pages

**Dependencies**: blocks: none | blocked-by: A, G

**DoD**:
- [ ] Tonight page: stall map + zones + live status + breathing pulse
- [ ] Morning summary: 昨晚發生了什麼
- [ ] Checkout: slot purchase + order confirmation
- [ ] 只透過 HTTP/SSE 溝通（SURFACE-01）
- [ ] `npm run build` 無錯誤

**Task Count**: 3

---

### Track F: Platform Adapters

**Layer**: L1
**Goal**: 讓 Night Engine 的決策能對外執行 — 在 X 發 spotlight、在 Discord 發通知。

**Input**: Track A (world state)
**Output**: adapter interface + X/Discord adapters

**Dependencies**: blocks: none | blocked-by: A

**DoD**:
- [ ] Adapter interface 定義（read state → produce actions）
- [ ] X adapter: 發 spotlight / 今晚預告 / 熱點公告
- [ ] Discord adapter: 即時通知 / 活動提醒
- [ ] Adapter 失敗不影響 governance loop（ADAPTER-01）
- [ ] Adapter 不修改 state（ADAPTER-02）
- [ ] `bun test src/adapters/` 通過

**Task Count**: 2

---

### Track G: Pulse + Bridge

**Layer**: L1
**Goal**: Health metrics SSE + Edda/Karvi bridge wiring。讓世界可被觀測、決策可被記錄。

**Input**: Track A (WorldManager)
**Output**: SSE endpoint + bridge integration

**Dependencies**: blocks: E | blocked-by: A

**DoD**:
- [ ] computeWorldHealth() pure function
- [ ] SSE endpoint: `GET /api/villages/:id/world/pulse`
- [ ] Edda fire-and-forget on apply/rollback
- [ ] Karvi dispatch for executable changes
- [ ] Bridge 斷線不 crash（BRIDGE-01）
- [ ] `bun test` 通過

**Task Count**: 2
