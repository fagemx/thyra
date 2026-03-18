# T0 — Völva → Thyra Handoff Contract

> 狀態：`canonical`
>
> 目的：定義 Völva 什麼時候、用什麼格式，把東西交給 Thyra。
>
> Thyra 不做 intent routing、不做 space building、不做 probe/commit。
> Thyra 只在收到合格 handoff 之後才開始工作。
>
> 型別定義見 `./shared-types.md`。

---

## 1. 一句話

> **Völva 負責「該不該進世界」；Thyra 負責「世界怎麼活」。**

Völva 處理：intent → route → shape → commit
Thyra 處理：instantiate → govern → adapt

兩邊唯一的接觸點就是這份 handoff contract。

---

## 2. 邊界定義

### Völva 的範圍（pre-world）

- intent-router：判斷 terminal intent regime
- path-check：判斷 realization path 固定程度
- space-builder：生成 + 約束 realization candidates
- probe-commit：用 regime-specific evaluator 決定是否 commit
- settlement-router：決定交給 Forge / Thyra / 其他

### Thyra 的範圍（live-world）

- world-kernel：world state, snapshots, continuity
- change-engine：proposal, diff, simulate, judge, apply, rollback
- chief-runtime：profiles, cadence, observation, proposal generation
- cycle-runner：canonical cycle execution
- pulse-engine：world health, mode, concerns
- outcome-engine：metrics, outcome windows, verdicts, recommendations
- precedent-layer：recording, retrieval, governance memory

### 不歸 Thyra 管的

- 使用者說了什麼（Völva 的事）
- 該用什麼 regime（Völva 的事）
- 該不該先做 probe（Völva 的事）
- economic / capability / leverage / expression / identity 的前置邏輯（Völva 的事）
- 只有 governance regime commit 後的 world instantiation 才進 Thyra

---

## 3. Handoff 時機

Völva 可以把東西交給 Thyra 的條件：

### 必要條件（全部滿足）

1. **Regime = governance**（或有 governance secondary 且 world form 已選定）
2. **CommitMemo.verdict = "commit"**
3. **World form 已選定**（market / commons / town / port / night_engine / managed_knowledge_field）
4. **Minimum world shape 已定義**（至少知道 zones, gates, chiefs, change types, metrics）
5. **至少一條 closure 被驗證**（observe → propose → judge → apply → outcome → precedent 能跑通）

### 不該交給 Thyra 的情況

- regime 不是 governance 且沒有 world form
- path-check 仍是 low/medium certainty
- probe-commit 還在 hold
- 只有 world form 想法，沒有 minimum world shape
- 沒有任何 closure 被跑過

---

## 4. Handoff Object

Völva 交給 Thyra 的唯一 payload：

```ts
type VölvaToThyraHandoff = {
  // 來源追蹤
  handoffId: string;
  sourceConversationId?: string;
  timestamp: string;

  // Völva 的決策摘要
  commitMemo: CommitMemo; // from shared-types.md §5.5
  regime: "governance"; // 目前只有 governance 會進 Thyra

  // World 定義
  worldForm: WorldForm; // from shared-types.md §4.1
  worldSpec: WorldSpec;

  // Edda 記錄（decision spine 的前半段）
  decisionTrail: DecisionTrailEntry[];
};

type WorldSpec = {
  name: string;
  worldType: string; // e.g. "market"
  templateId?: string;

  zones: ZoneSpec[];
  entryGates: GateSpec[];
  chiefs: ChiefSpec[];
  changeKinds: string[]; // 支援的 ChangeKind 列表
  metrics: MetricSpec[];

  initialState: MidnightMarketState; // 結構化初始值，見 canonical-slice §8
  cycleCadence: CycleCadence;
};

// v0: Midnight Market 專用。之後可抽成 generic WorldState interface。
type MidnightMarketState = {
  worldId: string;
  version: number;
  zones: Record<string, {
    name: string;
    stallCapacity: number;
    currentStalls: number;
    spotlightWeight: number;
  }>;
  entryGates: Record<string, {
    throttle: { enabled: boolean; maxPerMinute: number };
  }>;
  pricing: {
    baseStallFee: number;
    spotlightPremium: number;
  };
  events: unknown[];
  mode: WorldMode; // from shared-types.md §6.1
  metrics: {
    congestion_score: number;
    stall_fill_rate: number;
    checkout_conversion: number;
    complaint_rate: number;
    fairness_score: number;
  };
};

type ZoneSpec = {
  id: string;
  name: string;
  stallCapacity: number;
  spotlightWeight: number;
};

type GateSpec = {
  id: string;
  name: string;
  defaultThrottle: { enabled: boolean; maxPerMinute: number };
};

type ChiefSpec = {
  id: string;
  name: string;
  role: string; // e.g. "economy", "safety", "event"
  permissions: string[];
};

type MetricSpec = {
  id: string;
  name: string;
  range: { min: number; max: number };
  initialValue: number;
  direction: "higher_is_better" | "lower_is_better";
};

type CycleCadence = {
  intervalMinutes: number; // e.g. 15
  summarySchedule?: string; // e.g. "daily_morning"
  outcomeWindowMinutes: number; // e.g. 60
};

type DecisionTrailEntry = {
  stage: "intent-router" | "path-check" | "space-builder" | "probe-commit";
  summary: string;
  timestamp: string;
};
```

---

## 5. Thyra 收到 Handoff 後做什麼

```text
VölvaToThyraHandoff
→ 驗證 handoff（schema + 必要條件）
→ 建立 World（POST /api/v1/worlds）
→ 初始化 world state（world_snapshot）
→ 註冊 chiefs
→ 設定 laws（based on changeKinds + metrics）
→ 開始第一個 cycle
→ 進入 canonical cycle loop
```

### 驗證規則

Thyra 收到 handoff 時，至少檢查：

1. `commitMemo.verdict === "commit"`
2. `worldSpec.zones.length >= 1`
3. `worldSpec.chiefs.length >= 1`
4. `worldSpec.changeKinds.length >= 1`
5. `worldSpec.metrics.length >= 1`
6. `worldSpec.cycleCadence.intervalMinutes > 0`

不通過 → 拒絕 handoff，回傳錯誤給 Völva。

---

## 6. Thyra → Völva 回報

Thyra 建好世界後，回報：

```ts
type ThyraHandoffAck = {
  handoffId: string;
  worldId: string;
  status: "accepted" | "rejected";
  rejectionReason?: string;
  worldUrl?: string; // dashboard URL
  firstCycleId?: string;
};
```

---

## 7. Thyra → Edda 的 Handoff 記錄

Thyra 收到 handoff 並建好世界後，應把整條 decision trail 轉給 Edda：

```ts
// Edda 記錄
{
  type: "world_instantiation",
  worldId: "world_midnight_market_001",
  source: "volva_handoff",
  handoffId: "...",
  decisionTrail: [...], // Völva 提供的完整前置決策鏈
  timestamp: "..."
}
```

這樣 Edda 的 decision spine 就從 Völva 的 intent classification 一路連到 Thyra 的 world governance。

---

## 8. 不同 Regime 的 Handoff 路徑

不是所有 regime 都進 Thyra。

| Regime | Commit 後去哪 | 進 Thyra 的條件 |
|--------|--------------|----------------|
| Economic | Forge | 只有當 path 演化成 operator model / managed runtime |
| Capability | Forge | 只有當 learning system 需要 live governance |
| Leverage | Forge | 只有當 automation 變成持續運行的 governed runtime |
| Expression | Forge | 只有當 production field 變成 world-like |
| **Governance** | **Thyra** | **commit 後直接進 Thyra（主路徑）** |
| Identity | 繼續 probe | 極少直接進 Thyra |

所以目前 Völva → Thyra 的 handoff，主要服務 **governance regime**。
其他 regime 可能在後期演化進 Thyra，但那是二階路徑，不是 v0 主線。

---

## 9. Canonical Example

### Völva 側

```text
使用者：「我想開一個會自己運作的地方，讓 AI 經營它」

intent-router → governance (confidence: 0.93)
path-check → medium certainty, route: space-builder-then-forge
space-builder → candidates: market, night_engine, commons
  → constrain: kill town (太鬆), kill port (太大)
  → retain: market, night_engine
probe-commit → governance evaluator
  → minimum world probe: market 能跑出最短閉環
  → commit memo: verdict=commit, worldForm=market
```

### Handoff

```json
{
  "handoffId": "hoff_001",
  "timestamp": "2026-03-18T20:00:00Z",
  "regime": "governance",
  "commitMemo": {
    "candidateId": "cand_market_001",
    "regime": "governance",
    "verdict": "commit",
    "rationale": ["market 有最高 state/change density", "一條 closure 已驗證"],
    "evidenceUsed": ["minimum world probe 跑通", "pulse 可感"],
    "unresolvedRisks": ["fairness 長期漂移未測"],
    "whatForgeShouldBuild": ["world kernel", "3 chiefs", "5 change types", "cycle runner"],
    "whatForgeMustNotBuild": ["full dashboard", "cross-world federation", "content pipeline"],
    "recommendedNextStep": ["instantiate minimum world", "run 3 cycles"]
  },
  "worldForm": "market",
  "worldSpec": {
    "name": "Midnight Market",
    "worldType": "market",
    "zones": [
      { "id": "zone_a", "name": "Festival Square", "stallCapacity": 8, "spotlightWeight": 0.6 },
      { "id": "zone_b", "name": "Creator Lane", "stallCapacity": 6, "spotlightWeight": 0.4 }
    ],
    "entryGates": [
      { "id": "north_gate", "name": "North Gate", "defaultThrottle": { "enabled": false, "maxPerMinute": 100 } },
      { "id": "south_gate", "name": "South Gate", "defaultThrottle": { "enabled": false, "maxPerMinute": 50 } }
    ],
    "chiefs": [
      { "id": "chief_economy", "name": "Economy Chief", "role": "economy", "permissions": ["adjust_stall_capacity", "modify_pricing_rule", "adjust_spotlight_weight"] },
      { "id": "chief_safety", "name": "Safety Chief", "role": "safety", "permissions": ["throttle_entry", "pause_event"] },
      { "id": "chief_event", "name": "Event Chief", "role": "event", "permissions": ["adjust_spotlight_weight", "pause_event"] }
    ],
    "changeKinds": ["adjust_stall_capacity", "adjust_spotlight_weight", "throttle_entry", "pause_event", "modify_pricing_rule"],
    "metrics": [
      { "id": "congestion_score", "name": "Congestion", "range": { "min": 0, "max": 100 }, "initialValue": 0, "direction": "lower_is_better" },
      { "id": "stall_fill_rate", "name": "Stall Fill Rate", "range": { "min": 0, "max": 1 }, "initialValue": 0, "direction": "higher_is_better" },
      { "id": "checkout_conversion", "name": "Checkout Conversion", "range": { "min": 0, "max": 1 }, "initialValue": 0, "direction": "higher_is_better" },
      { "id": "complaint_rate", "name": "Complaint Rate", "range": { "min": 0, "max": 1 }, "initialValue": 0, "direction": "lower_is_better" },
      { "id": "fairness_score", "name": "Fairness", "range": { "min": 0, "max": 1 }, "initialValue": 1.0, "direction": "higher_is_better" }
    ],
    "initialState": {
      "worldId": "world_midnight_market_001",
      "version": 1,
      "zones": {
        "zone_a": { "name": "Festival Square", "stallCapacity": 8, "currentStalls": 0, "spotlightWeight": 0.6 },
        "zone_b": { "name": "Creator Lane", "stallCapacity": 6, "currentStalls": 0, "spotlightWeight": 0.4 }
      },
      "entryGates": {
        "north_gate": { "throttle": { "enabled": false, "maxPerMinute": 100 } },
        "south_gate": { "throttle": { "enabled": false, "maxPerMinute": 50 } }
      },
      "pricing": { "baseStallFee": 10, "spotlightPremium": 1.5 },
      "events": [],
      "mode": "setup",
      "metrics": { "congestion_score": 0, "stall_fill_rate": 0, "checkout_conversion": 0, "complaint_rate": 0, "fairness_score": 1.0 }
    },
    "cycleCadence": { "intervalMinutes": 15, "summarySchedule": "daily_morning", "outcomeWindowMinutes": 60 }
  },
  "decisionTrail": [
    { "stage": "intent-router", "summary": "governance regime, confidence 0.93", "timestamp": "2026-03-18T19:50:00Z" },
    { "stage": "path-check", "summary": "medium certainty, world form unresolved", "timestamp": "2026-03-18T19:51:00Z" },
    { "stage": "space-builder", "summary": "market + night_engine retained, town + port killed", "timestamp": "2026-03-18T19:52:00Z" },
    { "stage": "probe-commit", "summary": "market commit, closure verified", "timestamp": "2026-03-18T19:55:00Z" }
  ]
}
```

### Thyra 側

```text
收到 handoff → 驗證通過
→ POST /api/v1/worlds (建立 Midnight Market)
→ 初始化 world state snapshot
→ 註冊 3 chiefs
→ 開始第一個 cycle
→ canonical cycle loop 啟動
→ 回報 ThyraHandoffAck { status: "accepted", worldId: "world_midnight_market_001" }
```

---

## 10. shared-types.md 的歸屬

`shared-types.md` 定義了跨 Völva / Thyra 的共用型別。

目前放在 `thyra/docs/shared-types.md`，但它的內容同時被兩邊引用。
長期可以考慮抽成獨立的 shared contract repo，但 v0 先放 Thyra 側，Völva 引用。

---

## 11. 邊界守則

### Thyra 不應該做的事

1. 不解讀自然語言意圖
2. 不判斷 regime
3. 不生成 realization space
4. 不做 probe/commit
5. 不處理 economic / capability / leverage / expression / identity 的前置邏輯
6. 不從使用者原話直接建世界（必須經過 Völva handoff）

### Völva 不應該做的事

1. 不管理 world state
2. 不跑 judgment engine
3. 不做 change grammar
4. 不發 pulse
5. 不跑 outcome window
6. 不管理 precedent-fed governance

### 違反邊界的警告信號

- Thyra 開始出現 `intent` / `regime` / `probe` 相關邏輯 → 應該在 Völva
- Völva 開始出現 `world state` / `change proposal` / `judgment` 邏輯 → 應該在 Thyra
- 任何一邊開始直接呼叫對方的內部模組 → 應該走 handoff contract
