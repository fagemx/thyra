# Midnight Market Night Engine — Planning Pack v2

## Goal

建一個 **AI 場務引擎**（Night Engine），能駕馭既有平台與自有交易面，持續控場。

不是先建一個完整新場地，而是：
- **自己持有 state**（zones, stalls, slots, metrics, laws）
- **AI runtime 持續控場**（排位、補位、節奏、限流、summary、rollback）
- **借既有平台做 surface**（X 是喇叭、Discord 是現場、自有頁是主場）
- **自有頁面承接交易**（tonight page + checkout）

> **一句話：Midnight Market MVP = 每晚運轉的 AI 場務引擎。**

## Dependency DAG

```
L0 基礎設施
  [A] World API        [B] Market Domain
   │                     │
   ├─────────────────────┤
   │                     │
   ▼                     ▼
L1 內容 + 觀測
  [C] Night Template   [F] Platform     [G] Pulse +
  (YAML + seed)        Adapters         Bridge
   │                     │                │
   ├─────────────────────┤                │
   ▼                     ▼                ▼
L2 運行 + 介面
  [D] Night Engine     [E] Owned Surface
  (chiefs + scheduler) (tonight + summary + checkout)
```

**關鍵依賴**：
- A（World API）是所有 Track 的前提
- B（Market Domain）定義 market-specific state，跟 A 並行或緊接
- C 需要 A + B（pack/apply + market schema）
- D 需要 C（已建立的世界才能讓 chiefs 跑）
- E 需要 A + G（world API + SSE pulse）
- F 需要 A（world state 驅動 adapter actions）
- D 和 E 可並行

## Track Summary

| Track | Name | Layer | Tasks | Dependencies | Status |
|-------|------|-------|-------|-------------|--------|
| A | World API Closure | L0 | 3 | — | ☐ |
| B | Market Domain Model | L0 | 2 | — | ☐ |
| C | Night Template | L1 | 2 | A, B | ☐ |
| F | Platform Adapters | L1 | 2 | A | ☐ |
| G | Pulse + Bridge | L1 | 2 | A | ☐ |
| D | Night Engine Runtime | L2 | 3 | A, C | ☐ |
| E | Owned Surface | L2 | 3 | A, G | ☐ |

**Total: 7 Tracks, 17 Tasks**

## Parallel Execution Timeline

```
Batch 1（無依賴，可並行）：
  Agent 1 → Track A: A1 → A2 → A3
  Agent 2 → Track B: B1 → B2

Batch 2（依賴 A/B，可三路並行）：
  Agent 1 → Track C: C1 → C2
  Agent 2 → Track F: F1 → F2
  Agent 3 → Track G: G1 → G2

Batch 3（依賴 C / G，可二路並行）：
  Agent 1 → Track D: D1 → D2 → D3
  Agent 2 → Track E: E1 → E2 → E3
```

## Progress Tracking

### Batch 1
- [ ] Track A: World API Closure
  - [ ] A1: WorldManager orchestrator
  - [ ] A2: Pack/apply endpoint
  - [ ] A3: World API routes
- [ ] Track B: Market Domain Model
  - [ ] B1: Market state schema + DB tables
  - [ ] B2: Market state API routes

### Batch 2
- [ ] Track C: Night Template
  - [ ] C1: Midnight Market YAML + market-specific skills
  - [ ] C2: Template seeding + validation
- [ ] Track F: Platform Adapters
  - [ ] F1: Adapter interface + adapter registry
  - [ ] F2: X adapter + Discord adapter (MVP)
- [ ] Track G: Pulse + Bridge
  - [ ] G1: World health metrics + SSE pulse
  - [ ] G2: Edda + Karvi bridge wiring

### Batch 3
- [ ] Track D: Night Engine Runtime
  - [ ] D1: Chief decision protocol (6 responsibilities)
  - [ ] D2: Governance scheduler (15-30 min cycles)
  - [ ] D3: Summary generator (morning digest)
- [ ] Track E: Owned Surface
  - [ ] E1: Tonight page (event page + stall map + live status)
  - [ ] E2: Morning summary page
  - [ ] E3: Commerce / slot checkout

## Module Map

```
src/
  world-manager.ts                ← A1
  schemas/
    world.ts                      ← (exists)
    market.ts                     ← B1: zones, stalls, event_slots, orders, metrics
  routes/
    world.ts                      ← A3
    pack.ts                       ← A2
    market.ts                     ← B2: market-specific CRUD
  world/
    health.ts                     ← G1: health metrics
  market/
    state.ts                      ← B1: MarketState model
    stalls.ts                     ← B1: stall management
    zones.ts                      ← B1: zone management
    slots.ts                      ← B1: event slot management
  chief-autonomy.ts               ← D1: decision protocol
  governance-scheduler.ts         ← D2: timer-driven cycles
  summary-generator.ts            ← D3: morning digest
  adapters/
    interface.ts                  ← F1: adapter contract
    registry.ts                   ← F1: adapter registry
    x-adapter.ts                  ← F2: X/Twitter posting
    discord-adapter.ts            ← F2: Discord notifications
  sse.ts                          ← G1: SSE endpoint

templates/
  midnight-market.yaml            ← C1: market YAML

tonight/                          ← E1-E3: owned surface (React + Vite)
  src/
    pages/
      Tonight.tsx                 ← E1: tonight page
      Summary.tsx                 ← E2: morning summary
      Checkout.tsx                ← E3: slot purchase
    components/
      StallMap.tsx                ← E1: zone + stall visualization
      LiveStatus.tsx              ← E1: real-time updates
      ActivityFeed.tsx            ← E1: recent events
      WorldPulse.tsx              ← E1: breathing number
    api/client.ts                 ← E1: Thyra API client
```

## MVP 最小驗收

跑通這條鏈：

1. `POST /api/villages/pack/apply` with midnight-market.yaml → 建立 Market 世界
2. Governance scheduler 啟動 → chiefs 每 15 分鐘跑一輪
3. Chiefs 觀察 → 排位/補位/節奏調整 → judge → apply
4. Tonight page 顯示今晚地圖 + 攤位 + 活動
5. X adapter 發 spotlight 公告
6. 人類改一條規則 → judge → diff → 世界回應
7. 過熱 → Safety Chief rollback 某條激勵
8. 收場 → Morning summary 生成
9. 隔天 state 保留 → precedent 記錄在 Edda
