# pulse-and-outcome-metrics-v0.md

> 狀態：`working draft`
>
> 型別定義見 `./shared-types.md`。本文件中的型別為簡化參考，以 shared-types.md 為準。
>
> 目的：把 `Midnight Market` 裡最容易變成假活性的兩件事釘死：
>
> 1. **Pulse 到底是什麼**
> 2. **Outcome 到底怎麼判**
>
> 這份文件不是 analytics 規格。
> 它是在回答：
>
> > **Thyra 的世界什麼時候算「活著」？**
> > **一個 change 套用後，什麼時候能說它真的讓世界變好了？**

---

## 1. 為什麼這份文件必要

如果沒有這份，整個系統最容易退化成兩種假東西：

### 假活
畫面上有：
- health score
- 狀態燈
- 數字在跳
- 「世界在呼吸」

但其實那些數字只是 UI 動畫，
不是世界治理狀態的壓縮表達。

### 假學習
系統會：
- 開 outcome window
- 算一些數字
- 產生 report

但最後說不出：
- 這次 change 是好是壞？
- 好在哪裡？
- 壞是局部壞還是整體壞？
- 要不要因此改 law？

所以 pulse 跟 outcome 不能只是附屬資料。
它們其實是：

- **pulse = 世界當下治理狀態的壓縮感知**
- **outcome = 世界對 change 的延遲回應判定**

---

## 2. 一句話定義

### Pulse
> **Pulse 是世界此刻是否健康、是否穩定、是否過熱、是否失衡的即時治理摘要。**

### Outcome
> **Outcome 是某個 change 在一段觀察窗口後，對世界造成的實際後果判定。**

兩者差別很重要：

- Pulse 是 **now**
- Outcome 是 **after**

---

## 3. Pulse 不是 KPI dashboard

Pulse 不是把所有 metrics 全塞進首頁。

Pulse 的作用像醫療儀器上的生命徵象：
- 它不解釋一切
- 它也不是完整診斷
- 但它讓你一眼知道：
- 現在穩不穩
- 問題在哪
- 要不要立刻看細節

所以 pulse 必須有壓縮性。
不是數字越多越好，而是越少越準。

---

## 4. Outcome 不是 analytics report

Outcome 不是月底報表。
它必須是 change-aware 的。

也就是它不是問：
- 今天整體如何？

而是問：
- **剛剛那個 change 套上去之後，世界變怎樣？**

如果沒有 change awareness，
就只是一般 BI，不是 Thyra 的 outcome semantics。

---

## 5. Midnight Market v0：Pulse 應只看五個底層訊號

先不要貪心。

我建議 v0 pulse 只吃這五個訊號：

1. `congestion_score`
2. `stall_fill_rate`
3. `checkout_conversion`
4. `complaint_rate`
5. `fairness_score`

這五個的好處是，它們剛好對應一個市場世界最核心的五種生理狀態：

- 有沒有人塞住
- 攤位有沒有活
- 交易有沒有發生
- 人有沒有在不爽
- 資源是不是過度偏斜

這五個比 GMV、活躍數、曝光量更適合當第一輪 pulse 骨架。

---

## 6. 五個底層訊號各自代表什麼

### 6.1 congestion_score
這是世界的**壓力指標**。

問的是：
- 人流有沒有堵住？
- 現場是不是開始失控？
- 某個入口是否過熱？

如果 congestion 高，世界再熱鬧都不算健康。

---

### 6.2 stall_fill_rate
這是世界的**供給活性**。

問的是：
- 攤位有沒有被填滿？
- 市場是不是只在幾個點很熱，其他地方空掉？
- 世界是不是只剩一個表演中心，沒有真正的 market density？

如果 fill rate 太低，world 看起來會空心。

---

### 6.3 checkout_conversion
這是世界的**交易轉化能力**。

問的是：
- 人進來後有沒有真的採取行動？
- 不管是購買、訂位、報名，都有沒有被轉成 commitment？

沒有 conversion，世界就可能只是熱鬧，不是運作。

---

### 6.4 complaint_rate
這是世界的**摩擦外露**。

不是所有壞事都會立刻出現在 revenue 上，
但很多壞事會先出現在抱怨上。

complaint 是很重要的早期警訊：
- 太擠
- 不公平
- 太貴
- 看不懂
- 卡住
- 覺得被偏心對待

---

### 6.5 fairness_score
這是世界的**分配感**。

這個很重要，因為很多市場會出現：
- GMV 上升
- conversion 上升
- 但整體變得更不公平

例如：
- spotlight 全灌在 Festival Square
- Creator Lane 幾乎沒人看到
- 只剩 prime slot 在轉，其他區死掉

如果沒有 fairness，世界會很快變成短期最佳化器，而不是可持續地方。

---

## 7. Pulse 不是五個數字平均
要先講清楚，避免做成簡單平均分。

因為這五個指標不是等權重，而且方向也不同：

- congestion 越低越好
- complaint 越低越好
- fill rate 不一定越高越好（太高可能也代表過熱）
- fairness 太高也不一定表示健康，可能代表大家都很平均地很慘

所以 pulse 不能只是 linear average。

---

## 8. Pulse 的正確結構：分成三層

我建議 pulse v0 分三層，而不是單一分數。

---

### Layer A — Health Score
一個 0–100 的壓縮值。
只是讓人一眼有感。

### Layer B — Mode
世界當前處於什麼運營狀態。

### Layer C — Dominant Concerns
目前最主要的 1–3 個問題。

這三層一起才成立。

#### 錯誤做法
只顯示 `health = 73`

#### 正確做法
顯示：
- `health = 73`
- `mode = peak`, `stability = unstable`
- `dominant concerns = [{ kind: "gate_congestion", ... }, { kind: "fairness_drift", ... }]`

這樣才像治理系統，不像 KPI widget。

---

## 9. Pulse Mode v0

v0 不要搞十種 mode。
先只做六種：

```ts
type WorldMode =
| "setup"
| "open"
| "peak"
| "managed"
| "cooldown"
| "closed";
```

> ⚠️ **不要使用 compound string**（如 `"peak / unstable"`）。
> 如果需要 sub-qualifier，用獨立欄位 `stability: "stable" | "unstable" | "critical"`，不混進 mode。
> 見 `./shared-types.md` §6.1、§6.8。

~~但顯示層可以允許組合語意：~~

~~- `peak / unstable`~~
~~- `peak / managed`~~
~~- `open / balanced`~~
~~- `cooldown / recovering`~~

正確做法：用 `mode: WorldMode` + `stability: "stable" | "unstable" | "critical"` 兩個獨立欄位。
顯示層可以將兩者組合呈現，但資料層必須分開。

---

## 10. Health Score v0：怎麼算才不會太假

v0 不要裝得很科學。
直接明講它是 governance-oriented composite score。

### 先做 normalize
每個 metric 先標準化成 0–100 的子分數：

- `congestion_health`
- `supply_health`
- `conversion_health`
- `friction_health`
- `fairness_health`

### 再做 weighted composite
但權重不完全固定，要看 mode。

#### normal/open 模式
- supply / conversion 比較重要

#### peak 模式
- congestion / complaint 權重上升

#### cooldown 模式
- fairness / complaint / residual congestion 比較重要

這一點很重要：
同一個世界，在不同時段，健康定義應該不完全一樣。

---

## 11. 建議的 v0 權重

### open / normal
- congestion: 0.20
- stall_fill_rate: 0.25
- checkout_conversion: 0.20
- complaint_rate: 0.15
- fairness_score: 0.20

### peak
- congestion: 0.35
- stall_fill_rate: 0.15
- checkout_conversion: 0.15
- complaint_rate: 0.20
- fairness_score: 0.15

### cooldown
- congestion: 0.15
- stall_fill_rate: 0.15
- checkout_conversion: 0.15
- complaint_rate: 0.25
- fairness_score: 0.30

不是因為數學最美，
而是因為這比較符合夜間 market 的治理直覺。

---

## 12. Pulse 還必須有「dominant concerns」
這比 score 本身更重要。

因為人不是真的靠總分行動，
人靠「現在最該處理的是什麼」行動。

所以 pulse frame 必須輸出：

```ts
dominantConcerns: Concern[]
```

### Concern v0
```ts
type Concern = {
kind:
| "gate_congestion"
| "complaint_spike"
| "fairness_drift"
| "zone_underfilled"
| "conversion_drop"
| "event_overheating";
severity: "low" | "medium" | "high" | "critical";
targetId?: string;
summary: string;
};
```

### 例子
- `north_gate congestion rising above threshold`
- `festival square absorbing too much spotlight`
- `creator lane fill rate dropping below healthy floor`

這樣 chief 才有明確 proposal context。

---

## 13. Pulse frame schema v0

```ts
type PulseFrame = {
id: string; // 不用 pulseId
worldId: string;
cycleId?: string;

healthScore: number; // 0-100
mode: WorldMode; // 離散值，不用 compound string
stability: "stable" | "unstable" | "critical"; // 獨立欄位
subScores: {
congestionHealth: number;
supplyHealth: number;
conversionHealth: number;
frictionHealth: number;
fairnessHealth: number;
};

dominantConcerns: Concern[]; // 結構化物件，不是 string[]，見 shared-types.md §6.7
latestAppliedChangeId?: string;
openOutcomeWindowCount: number;
pendingProposalCount: number;

generatedAt: string;
};
```

> 正式版本見 `./shared-types.md` §6.8。

這個 schema 已經夠 UI、SSE、history 都共用。

---

## 14. Outcome 不是每輪都算，要綁 proposal
這點一定要強調。

Pulse 可以每輪算。
Outcome 不行。

Outcome 必須是：

> **proposal-linked**

也就是 outcome 永遠要能回答：

- 這是哪個 proposal 帶來的？
- 觀察窗口多久？
- 基線是什麼？
- 最終 verdict 是什麼？

沒有 proposal linkage，就沒有治理上的意義。

---

## 15. Outcome 的四種 verdict 就夠了

```ts
type OutcomeVerdict =
| "beneficial"
| "harmful"
| "neutral"
| "inconclusive";
```

不要搞 8 種。
四種就夠了。

---

## 16. 什麼叫 beneficial？

不是單一指標變好。
而是：

> **proposal 所宣稱要改善的主要目標達成，而且沒有觸發不可接受副作用。**

例如：
- 北門限流後 congestion 降下來
- complaint rate 也降
- total traffic 沒崩
- fairness 沒明顯惡化

這才叫 beneficial。

---

## 17. 什麼叫 harmful？

不是所有 metrics 都變差才叫 harmful。

只要出現以下任一種，就可能 harmful：

1. 主要目標沒達成
2. 達成主要目標，但副作用太大
3. 觸碰 rollback guardrail
4. 導致世界 mode 從 managed 退成 unstable
5. 使某個 concern 被解決但另一个更嚴重 concern 長出來

例如：
- congestion 降了，但 total conversion 掉 35%
- pricing 提高後 revenue 漲，但 complaint/fairness 爆炸
- pause_event 壓住壅塞，但整晚活力直接死掉

---

## 18. 什麼叫 neutral？

這個 change 既沒明顯幫忙，也沒明顯傷害。

注意 neutral 很重要，
因為如果系統只有 beneficial/harmful，就會過度擬合。

neutral 代表：
- 這條路沒什麼用
- 不是錯，但不值得記成強 precedent
- 之後可能不必再優先採用

---

## 19. 什麼叫 inconclusive？

這個也很重要。

不是系統沒本事，
而是當下真的還判不清。

例如：
- observation window 太短
- 外部波動太大
- 同時疊了兩個 proposal
- metrics 訊號互相抵銷

inconclusive 比亂判 beneficial 更誠實。

---

## 20. Outcome 不是單看 before/after，還要看「預期對沒對上」

所以每個 outcome report 至少要分三層：

1. **Expected effect**
2. **Observed effect**
3. **Side effects**

這樣才能判定：
- 不是只看世界是否變動
- 而是看有沒有朝 proposal 的 intent 變動

---

## 21. Outcome report schema v0

```ts
// 此為 OutcomeReport 的 canonical 版本，shared-types.md §6.9 引用本文件定義。
type OutcomeReport = {
id: string;
worldId: string;
proposalId: string;
outcomeWindowId: string;

verdict: OutcomeVerdict;

primaryObjectiveMet: boolean;
expectedEffects: ExpectedEffectResult[];
sideEffects: SideEffectResult[];

summary: string;
recommendation: "reinforce" | "rollback" | "do_not_repeat" | "watch" | "retune";

evaluatedAt: string;
};
```

```ts
type ExpectedEffectResult = {
metric: string;
expectedDirection: "up" | "down" | "stable";
baseline: number;
observed: number;
delta: number;
matched: boolean;
};
```

```ts
type SideEffectResult = {
metric: string;
baseline: number;
observed: number;
delta: number;
severity: "negligible" | "minor" | "significant";
acceptable: boolean;
};
```

---

## 22. Midnight Market v0：五種 metric 的 outcome 判讀邏輯

這一段很重要，因為同一個數字在 pulse 跟 outcome 裡扮演的角色不一樣。

---

### 22.1 congestion_score
#### Pulse 裡
它是當下壓力。

#### Outcome 裡
它通常是很多 safety proposal 的 primary metric。

#### 判讀原則
- 降得夠快且穩定 = 好
- 短暫降、很快反彈 = 不一定好
- 降了但只是把壓力移到南門 = 可能 harmful / inconclusive

---

### 22.2 stall_fill_rate
#### Pulse 裡
它是供給活性。

#### Outcome 裡
常是 spotlight / capacity 調整的 secondary metric。

#### 判讀原則
- fill 提高但只灌到一區，不一定 beneficial
- fill 下降但 fairness 大幅改善，可能仍可接受
- 長期偏低比短期波動更重要

---

### 22.3 checkout_conversion
#### Pulse 裡
它是交易生命徵象。

#### Outcome 裡
常是 economy proposal 的 primary metric。

#### 判讀原則
- conversion 上升但 complaint 爆掉，不一定好
- conversion 微降但 congestion 明顯改善，可能 acceptable
- 要跟 window 長度一起看，不能只看單點

---

### 22.4 complaint_rate
#### Pulse 裡
它是摩擦外露。

#### Outcome 裡
幾乎所有 proposal 都要看它，因為它是 side effect 的早期警報。

#### 判讀原則
- complaint 漲幅常比 revenue 跌幅更早出現
- 若 complaint 明顯上升，通常至少要 downgrade outcome
- complaint 不降，表示 proposal 可能只做了表面調整

---

### 22.5 fairness_score
#### Pulse 裡
它是分配感。

#### Outcome 裡
它常是：
- economy / event 類 proposal 的約束條件
- safety proposal 的 side-effect 檢查

#### 判讀原則
- fairness 惡化到某閾值，即使 revenue 漲也不能算 beneficial
- fairness 改善本身可成為一種主要 outcome，但通常要搭配 fill / conversion 一起看

---

## 23. Proposal-specific outcome templates

Outcome 不能全用同一模板。
v0 先固定每種 canonical change 的 outcome template。

---

### A. `throttle_entry`
**Primary goal**
- congestion_score ↓
- complaint_rate ↓

**Guardrails**
- total traffic 不可暴跌
- fairness 不可惡化過多

**Typical recommendation**
- beneficial → 提早 intervention threshold
- harmful → rollback + 提高人工介入級別

---

### B. `adjust_spotlight_weight`
**Primary goal**
- zone traffic rebalance
- stall_fill_rate 改善

**Guardrails**
- conversion 不可大跌
- complaint 不可上升

---

### C. `adjust_stall_capacity`
**Primary goal**
- fill rate 更健康
- 某區不再過擠或過空

**Guardrails**
- fairness 不可惡化
- congestion 不可上升

---

### D. `pause_event`
**Primary goal**
- 降低過熱 / 降低 complaint

**Guardrails**
- conversion / vitality 不可崩盤

---

### E. `modify_pricing_rule`
**Primary goal**
- 提升 revenue 或 conversion quality

**Guardrails**
- complaint/fairness 不得超閾值
- 某區域流量不應被抽乾

---

## 24. Recommendation 不能省略

Outcome report 最後一定要有 recommendation，
不然 precedent 很難用。

```ts
type OutcomeRecommendation =
| "reinforce" // 可納成更穩定 law
| "retune" // 方向對，但數值要調
| "watch" // 先觀察，不立刻下結論
| "rollback" // 立即退
| "do_not_repeat"; // 不要再用
```

這五個 recommendation 很關鍵，因為它們是從 outcome 回流治理的橋。

---

## 25. Pulse 與 Outcome 的關係

這裡最容易混。

### Pulse 是 state-oriented
它回答：
- 世界現在怎麼樣？

### Outcome 是 change-oriented
它回答：
- 某個 change 後來有沒有值得保留？

所以工程上不要把兩個揉在同一個 service 裡。
至少概念上要切開：

- `pulse-service`
- `outcome-service`

不然 UI 和治理邏輯都會混掉。

---

## 26. SSE 顯示的應該是 pulse 事件，不是 raw metrics
world 活著的感覺，不是把所有 metrics 每秒推給前端。

SSE v0 只推這種事件：

- pulse updated
- concern escalated
- proposal judged
- proposal applied
- rollback triggered
- outcome closed

也就是推**治理事件**，不是推資料流噪音。

---

## 27. 第一版 Pulse UI 應長什麼樣

不是大 dashboard。
而是非常節制：

### 第一屏
- `health score`
- `mode`
- `dominant concerns`
- `latest applied change`
- `open outcome windows`

### 第二屏（才展開）
- 子分數
- 主要 metrics trend
- 當前 proposal / judgment 狀態

這樣才不會變成傳統後台。

---

## 28. 第一版 Outcome UI 應長什麼樣

一張 outcome card 就夠：

- proposal title
- expected effects
- observed effects
- side effects
- verdict
- recommendation
- linked precedent

這樣直接把 change / judgment / outcome / precedent 接起來。

---

## 29. 最小演算法：不要裝 ML

v0 不需要 predictive model。
直接規則式就好。

### Pulse
- normalize
- weight by mode
- extract top concerns

### Outcome
- compare baseline vs observed
- check primary objective
- check guardrails
- produce verdict
- map to recommendation

只要你先把這條規則鏈做硬，之後再談學習。

---

## 30. 最後一句

> **Pulse 負責讓世界“此刻可感”，**
> **Outcome 負責讓 change“事後可判”。**
>
> 沒有 Pulse，Thyra 沒有生命感。
> 沒有 Outcome，Thyra 沒有學習性。
>
> 這兩者一個負責「活著」，
> 一個負責「變好」。
>
> 缺一個，world cycle 都站不穩。

---

相關文件：
- `canonical-cycle.md` — 世界循環定義
- `change-proposal-schema-v0.md` — 變更提案 schema
- `judgment-rules-v0.md` — 判斷規則
- `world-cycle-api.md` — API 映射
- `midnight-market-canonical-slice.md` — 最小實例
- `shared-types.md` — 跨文件型別