# Midnight Market Night Engine — Validation Plan

## Track Acceptance Criteria

### Track A: World API Closure
| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| WorldManager | apply = judge→snapshot→apply→audit | `bun test src/world-manager.test.ts` |
| Pack/apply | YAML → 201 + village created | `bun test src/routes/pack.test.ts` |
| World routes | 7 endpoints + validation | `bun test src/routes/world.test.ts` |

### Track B: Market Domain Model
| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| DB tables | zones, stalls, event_slots, orders, metrics exist | `bun test src/market/` |
| MarketState | assembleMarketState returns complete state | unit test |
| Stall CRUD | create/read/update/rank stalls | route tests |
| Slot booking | book/cancel/list event slots | route tests |

### Track C: Night Template
| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| YAML | 5 chiefs + constitution + 5 skills | file content check |
| Compile | pack/apply → 201 | `bun test` seeding test |
| WorldState | 5 chiefs + constitution + skills after seeding | state assertion |
| MarketState | zones + stalls initialized | market state assertion |

### Track D: Night Engine Runtime
| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| 排位 | Market Chief ranks stalls by metrics | `bun test src/chief-autonomy.test.ts` |
| 補位 | Empty slots auto-filled | test |
| 節奏 | Event Chief proposes activity changes | test |
| 限流 | Safety Chief proposes limits on overheated zones | test |
| rollback | Safety Chief rollbacks dangerous rules | test |
| summary | Morning digest generated | `bun test src/summary-generator.test.ts` |
| Scheduler | 15 min cycle, configurable | `bun test src/governance-scheduler.test.ts` |

### Track E: Owned Surface
| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Tonight page | stall map + zones + live updates visible | manual test |
| Breathing pulse | SSE connected, number animating | manual test |
| Summary page | shows last night's digest | manual test |
| Checkout | slot purchase flow works | manual test |
| Build | production build clean | `cd tonight && npm run build` |

### Track F: Platform Adapters
| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Interface | AdapterAction type + Adapter contract | `bun run build` |
| X adapter | produces post content from world state | `bun test src/adapters/` |
| Discord adapter | produces notification from world state | test |
| Failure isolation | adapter throws → governance continues | test |

### Track G: Pulse + Bridge
| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Health | computeWorldHealth() returns all fields | `bun test src/world/health.test.ts` |
| SSE | EventSource receives pulse events | test or manual curl |
| Edda | fire-and-forget on apply | mock test |
| Karvi | dispatch on executable changes | mock test |
| Graceful | bridge down → no crash | test with null bridge |

---

## Golden Path Scenarios

### GP-1: World API Closure（Track A）

**Description**: 從零建 village → judge → apply → rollback via HTTP。

**Steps**:
1. POST /api/villages → create village
2. POST /api/villages/:id/constitutions → create constitution
3. POST /api/villages/:id/chiefs → appoint chief
4. GET /api/villages/:id/world/state → WorldState
5. POST /api/villages/:id/world/judge → allowed
6. POST /api/villages/:id/world/apply → diff
7. POST /api/villages/:id/world/rollback → state restored

**Validates**: Track A

---

### GP-2: Market World Creation（Track A + B + C）

**Description**: 用 midnight-market.yaml 建立完整 Market 世界，含 zones + stalls。

**Steps**:
1. POST /api/villages/pack/apply with midnight-market.yaml → 201
2. GET /api/villages/:id/world/state → 5 chiefs, constitution
3. GET /api/market/:id/zones → initial zones
4. GET /api/market/:id/stalls → initial stalls
5. POST /api/market/:id/stalls → add new stall
6. GET /api/market/:id/slots → available event slots

**Validates**: Track A + B + C

---

### GP-3: One Night Cycle（Track A + B + C + D）

**Description**: 啟動 Night Engine，chiefs 跑一輪完整 cycle。

**Steps**:
1. GP-2 完成
2. Governance scheduler.runOnce()
3. Market Chief: 排位 → stall ranking changed
4. Event Chief: 提案新活動 → judge → apply
5. Safety Chief: 觀察到過熱 → 提案限流 → judge → apply
6. Economy Chief: budget ok → no action
7. Brand Chief: 世界觀一致 → no action
8. Summary: cycle result summarized

**Validates**: Track D（Night Engine 核心）

---

### GP-4: Cross-Platform Night（Track A + B + C + D + F）

**Description**: Night Engine 跑一輪後，adapter 對外發布。

**Steps**:
1. GP-3 完成
2. Governance scheduler 觸發 adapter actions
3. X adapter: post spotlight（「今晚主街：手作皮革 × 古著」）
4. Discord adapter: send notification（「鬼火祭開始了！」）
5. Adapter failure test: mock X API down → governance still completed

**Validates**: Track F（adapter 不影響 governance）

---

### GP-5: Full Night Demo（All Tracks）

**Description**: 完整一晚：建世界 → chiefs 自主跑 → tonight page 顯示 → 人類改規則 → morning summary。

**Steps**:
1. POST /api/villages/pack/apply → Midnight Market 建立
2. 開啟 tonight page → 看到 stall map + breathing pulse
3. Governance scheduler 啟動（interval: 10s for demo）
4. 等 30 秒 → tonight page 更新（stalls reranked, spotlight changed）
5. 人類在 tonight page 提交 change（adjust budget）
6. Judge 結果顯示 → allowed → diff 顯示
7. Pulse number 跳了一下
8. Safety Chief 在下一輪 rollback 一條過激規則
9. X adapter 發出 spotlight post
10. 停止 scheduler → morning summary 生成
11. Summary page 顯示「昨晚發生了什麼」
12. Edda 記錄 precedent

**Validates**: 所有 Track + 跨 Track 整合

---

## Quality Benchmarks

| Rule | Metric | Baseline | Verification |
|------|--------|----------|-------------|
| TYPE-01 | tsc errors | 0 | `bun run build` |
| LINT-01 | eslint warnings | 0 | `bun run lint` |
| STATE-01 | state mutation via platform | 0 instances | code review |
| WORLD-02 | apply without judge | 0 instances | tests |
| CHIEF-01 | chief bypass judge | 0 instances | tests |
| ADAPTER-01 | adapter crash → governance fail | 0 instances | tests |
| ADAPTER-02 | adapter writes state | 0 instances | code review |
| SURFACE-01 | tonight imports src/ | 0 imports | `grep` |
