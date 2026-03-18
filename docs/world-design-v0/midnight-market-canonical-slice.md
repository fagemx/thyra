# midnight-market-canonical-slice.md

> 狀態：`working draft`
>
> 目的：定義 Midnight Market 的最小可治理世界實例。
>
> 型別定義見 `./shared-types.md`。

---

## 1. World Identity

```yaml
worldId: "world_midnight_market_001"
worldType: "market"
name: "Midnight Market"
slug: "midnight-market"
templateId: "template_market_v0"
```

Midnight Market 是 Thyra 的第一個 canonical exemplar。
所有治理概念（cycle, change, judgment, outcome, precedent）都先在這個世界上驗證。

---

## 2. Zones

兩個區域，代表兩種市場性格。

### zone_a — Festival Square

```yaml
id: "zone_a"
name: "Festival Square"
description: "主廣場，高人流，spotlight 集中。大型活動和 prime stall 聚集地。"
spotlightWeight: 0.6
stallCapacity: 8
```

Festival Square 是流量中心。大部分 spotlight 和 prime slot 集中在這裡。
壅塞和公平性問題最容易在這裡出現。

### zone_b — Creator Lane

```yaml
id: "zone_b"
name: "Creator Lane"
description: "創作者巷，較安靜，多元攤位。強調多樣性和長尾發現。"
spotlightWeight: 0.4
stallCapacity: 6
```

Creator Lane 是多樣性空間。攤位較小但種類多。
fill rate 和 fairness 是這區的核心指標。

---

## 3. Entry Gates

兩個入口，控制人流進場。

### north_gate — 主入口

```yaml
id: "north_gate"
name: "North Gate"
description: "主入口，承載大部分人流。可限流。"
throttle:
  enabled: false
  maxPerMinute: 100
```

### south_gate — 次入口

```yaml
id: "south_gate"
name: "South Gate"
description: "次入口，人流較少。可作為分流目標。"
throttle:
  enabled: false
  maxPerMinute: 50
```

---

## 4. Stalls

每個 zone 有固定數量的 stall slot。

| Zone | Stall Capacity | 說明 |
|---|---|---|
| zone_a (Festival Square) | 8 | 大型攤位為主，prime slot 集中 |
| zone_b (Creator Lane) | 6 | 小型攤位為主，多元品類 |

總計 14 個 stall slot。v0 不做 stall 內部結構，只追蹤 `currentStalls` 數量。

---

## 5. Chiefs (3)

三個 chief 各負責一個治理面向。權限不重疊，但提案可能衝突。

### economy_chief

```yaml
id: "chief_economy"
domain: "pricing, stall allocation, conversion"
permissions:
  - adjust_stall_capacity
  - modify_pricing_rule
  - adjust_spotlight_weight (cross-chief review)
```

負責市場的經濟健康：攤位是否被填滿、定價是否合理、交易是否發生。

### safety_chief

```yaml
id: "chief_safety"
domain: "congestion, complaint, throttling"
permissions:
  - throttle_entry
  - pause_event (緊急時)
  - tighten_safety_threshold
```

負責市場的安全與秩序：人流是否堵住、抱怨是否爆增、入口是否過載。

### event_chief

```yaml
id: "chief_event"
domain: "spotlight, events, schedule"
permissions:
  - adjust_spotlight_weight
  - pause_event (局部)
  - resume_event
```

負責市場的節奏與活性：spotlight 是否均衡、活動是否過熱、時間表是否合理。

---

## 6. Change Types (5 MVP)

v0 只實作 `ChangeKindMVP`（見 `./shared-types.md` §6.5）：

| # | Kind | 說明 | 主要 Chief |
|---|---|---|---|
| 1 | `adjust_stall_capacity` | 改某 zone 可承載攤位量 | economy |
| 2 | `adjust_spotlight_weight` | 改曝光導向比例 | event / economy |
| 3 | `throttle_entry` | 針對某入口限流 | safety |
| 4 | `pause_event` | 暫停某活動 | safety / event |
| 5 | `modify_pricing_rule` | 改定價規則 | economy |

這 5 個 change kind 足以覆蓋經濟、安全、節奏、流量、公平五個治理面向。

---

## 7. Metrics (5 base)

| Metric | Range | 說明 |
|---|---|---|
| `congestion_score` | 0-100 | 人流壓力。越高越危險。 |
| `stall_fill_rate` | 0-1 | 攤位填充率。太低代表供給不足，太高可能過熱。 |
| `checkout_conversion` | 0-1 | 交易轉化率。進場人數中有多少完成交易。 |
| `complaint_rate` | 0-1 | 抱怨率。摩擦的早期警訊。 |
| `fairness_score` | 0-1 | 分配公平性。spotlight、stall、traffic 是否過度集中。1.0 = 完全公平。 |

這五個指標同時服務 pulse（即時治理感知）和 outcome（change 後果判定）。

---

## 8. Initial State (WorldSnapshot)

世界開局時的完整狀態。使用 dot-path 結構，與 change-proposal-schema 的 diff operations 對齊。

```json
{
  "worldId": "world_midnight_market_001",
  "version": 1,
  "zones": {
    "zone_a": {
      "name": "Festival Square",
      "stallCapacity": 8,
      "currentStalls": 0,
      "spotlightWeight": 0.6
    },
    "zone_b": {
      "name": "Creator Lane",
      "stallCapacity": 6,
      "currentStalls": 0,
      "spotlightWeight": 0.4
    }
  },
  "entryGates": {
    "north_gate": {
      "throttle": {
        "enabled": false,
        "maxPerMinute": 100
      }
    },
    "south_gate": {
      "throttle": {
        "enabled": false,
        "maxPerMinute": 50
      }
    }
  },
  "pricing": {
    "baseStallFee": 10,
    "spotlightPremium": 1.5
  },
  "events": [],
  "mode": "setup",
  "metrics": {
    "congestion_score": 0,
    "stall_fill_rate": 0,
    "checkout_conversion": 0,
    "complaint_rate": 0,
    "fairness_score": 1.0
  }
}
```

注意：
- `mode` 初始為 `"setup"`，開市後轉為 `"open"` → `"peak"` → `"cooldown"` → `"closed"`
- `fairness_score` 初始 1.0（完全公平，因為還沒有任何偏斜）
- `events` 為空陣列，由 event_chief 在 cycle 中填入
- diff operation 的 `path` 直接對應這個 JSON 的 dot-path（如 `zones.zone_a.stallCapacity`、`entryGates.north_gate.throttle.enabled`）

---

## 9. Canonical Story

一個完整 cycle 的治理故事：Safety Chief 觀察到北門壅塞，提出限流，被附條件批准，套用後壅塞下降。

### 背景

20:00，Midnight Market 進入 `peak` 模式。Festival Square 人流激增，北門壅塞分數飆升至 87。

### OBSERVE

本輪 observation batch 包含：
- `north_gate congestion_score = 87`（超過警戒閾值 80）
- `complaint_rate` 從 0.05 上升至 0.12
- `zone_a stall_fill_rate = 0.875`（7/8 攤位已滿）

### PROPOSE CHANGE

Safety Chief 提出 `throttle_entry(north_gate)`：

```json
{
  "kind": "throttle_entry",
  "target": {
    "scope": "entry_gate",
    "objectIds": ["north_gate"],
    "blastRadius": "regional"
  },
  "diff": {
    "mode": "patch",
    "operations": [
      { "op": "set", "path": "entryGates.north_gate.throttle.enabled", "before": false, "after": true },
      { "op": "set", "path": "entryGates.north_gate.throttle.maxPerMinute", "before": 100, "after": 60 }
    ]
  },
  "intent": {
    "objective": "reduce north gate congestion below alert threshold",
    "reason": "congestion_score crossed 80 twice within one cycle",
    "urgency": "high",
    "triggerType": "metric_threshold"
  }
}
```

### JUDGE

Judge engine 四層判定：

| Layer | Result | 說明 |
|---|---|---|
| L0 Structural | pass | schema 完整，target 存在，diff path 合法 |
| L1 Invariants | pass | 不違反安全底線（south_gate 仍開放） |
| L2 Constitution | pass | Safety Chief 有 throttle_entry 權限 |
| L3 Contextual | warn | peak 時段，precedent 存在但非完全匹配 |

**Final Verdict**: `approved_with_constraints`
**Risk Class**: `medium`

**Constraints**:
- 生效 60 分鐘（`time_limited`）
- `total_entry_volume` 跌超過 10% 自動 rollback（`metric_guard`）
- outcome window 60 分鐘（`auto_rollback`）

### APPLY

系統套用 change：
- `entryGates.north_gate.throttle.enabled` → `true`
- `entryGates.north_gate.throttle.maxPerMinute` → `60`
- 儲存 snapshot_before 和 snapshot_after
- 開啟 outcome window（60 分鐘）

### PULSE

套用後 pulse 更新：
- `mode`: `peak`
- `stability`: `unstable` → 30 分鐘後轉為 `stable`
- `healthScore`: 61 → 78
- `dominantConcerns`: `gate_congestion` severity 從 `high` 降至 `medium`

### OUTCOME

60 分鐘後，outcome window 關閉並 evaluate：

| Metric | Baseline | Observed | Delta | Matched? |
|---|---|---|---|---|
| congestion_score | 87 | 63 | -24 | yes (expected down) |
| complaint_rate | 0.12 | 0.07 | -0.05 | yes (expected down) |
| total_entry_volume | 1200 | 1080 | -120 | yes (within 10% tolerance) |
| fairness_score | 0.72 | 0.71 | -0.01 | acceptable (negligible) |

**Verdict**: `beneficial`
**Recommendation**: `reinforce`

### PRECEDENT

系統寫入 precedent：

```json
{
  "worldType": "market",
  "changeKind": "throttle_entry",
  "context": "peak hour, north gate congestion above 80, festival square near full capacity",
  "decision": "approved_with_constraints: 60min time limit, 10% traffic guard",
  "outcome": "beneficial",
  "recommendation": "reinforce",
  "lessonsLearned": [
    "throttle to 60/min effective for congestion > 80",
    "total traffic drop within acceptable range",
    "fairness impact negligible"
  ],
  "contextTags": ["peak_hour", "high_congestion", "festival_night"]
}
```

### GOVERNANCE ADJUSTMENT

基於 outcome，系統提出調整建議：
- 將 congestion 早期介入閾值從 85 降至 78（更早限流）
- 將此 throttle pattern 納入 Safety Chief 的自動提案規則

---

## 10. Cycle Cadence

| 項目 | 頻率 | 說明 |
|---|---|---|
| observe / propose / judge / apply | 每 15 分鐘一輪 | 核心治理節奏 |
| morning summary | 每晚結束時 | 彙總當晚所有 cycle 的治理決策和 outcome |
| outcome window | 每個重大 change 開 1 個 | 預設 60 分鐘，可依 risk class 調整 |

### Cycle 生命週期

```text
open
→ observation_sealed (收完觀察)
→ proposals_closed (提案截止)
→ changes_applied (變更套用)
→ outcome_tracking (追蹤後果)
→ closed (進入下一輪)
```

### 一晚的 cycle 序列

```text
19:00  setup cycle — 初始化世界，seed stalls 和 events
19:30  open cycle #1 — 開市，開始收 observations
20:00  peak cycle #2 — 人流高峰，安全 chiefs 最活躍
20:15  peak cycle #3 — 持續高峰
...
22:30  cooldown cycle — 人流下降，結算開始
23:00  closing cycle — 寫 morning summary，歸檔 precedents
```

每輪 cycle 不保證一定有 proposal。
如果 observation 沒有觸發任何 chief 的提案閾值，cycle 會安靜地關閉。
這也是一種健康狀態。
