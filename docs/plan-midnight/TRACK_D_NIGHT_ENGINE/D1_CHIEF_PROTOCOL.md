# D1: Chief Decision Protocol — 6 Responsibilities

> **Layer**: L2
> **Dependencies**: A1（WorldManager）, B1（MarketState）, C2（已建立的世界）
> **Blocks**: D2, D3
> **Output**: `src/chief-autonomy.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/plan-midnight/CONTRACT.md          # CHIEF-01
cat docs/營運/營運5.md                       # 6 responsibilities 定義
cat src/world-manager.ts                    # WorldManager.apply()
cat src/market/state.ts                     # assembleMarketState, MarketState
cat src/chief-engine.ts                     # ChiefEngine
bun run build
```

---

## 6 Responsibilities（Phase 1 = rule-based, 不用 LLM）

### 1. 排位（Market Chief）
- 讀 stalls → 按 metrics（revenue, visits）排名
- 如果排名跟現有不同 → 提案 stall rank 調整

### 2. 補位（Market Chief）
- 讀 zones → 如果 zone 有空位 + stalls 有候補
- 提案 stall 移入空位

### 3. 活動節奏（Event Chief）
- 讀 event_slots → 如果 active < 2
- 提案新 event slot

### 4. 限流（Safety Chief）
- 讀 zones → 如果 current_load > capacity * 0.9
- 提案限流（law.propose）

### 5. Rollback（Safety Chief）
- 讀 market_metrics → 如果 incidents > threshold
- 提案 rollback 最近的激勵 law

### 6. Summary（所有 Chiefs 跑完後）
- 這輪做了什麼 → D3 Summary Generator 處理

### 介面

```typescript
export function makeChiefDecision(
  chief: Chief,
  worldState: WorldState,
  marketState: MarketState,
): ChiefDecision

export async function executeChiefCycle(
  worldManager: WorldManager,
  villageId: string,
  chief: Chief,
  marketState: MarketState,
): Promise<ChiefCycleResult>
```

Issue: #198

---

## 驗收
```bash
bun run build && bun run lint && bun test src/chief-autonomy.test.ts
```
