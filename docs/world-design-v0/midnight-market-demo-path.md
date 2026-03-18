# midnight-market-demo-path.md

> 狀態：`working draft`
>
> 目的：把 `midnight-market-canonical-slice.md` 從「概念對齊」壓成**2–3 週內真的能做出來的 demo 路徑**。
>
> 這份文件不追求完整產品規劃。
> 它只回答：
>
> > **如果要最短時間證明 Thyra 不是在講 world，而是真的能跑出一個 world cycle，該怎麼做？**

---

## 1. Demo 不是什麼

先把錯的路封掉。

這個 demo **不是**：

- 一個漂亮 dashboard
- 一個 night market landing page
- 一個多 agent chat room
- 一個 generic orchestration panel
- 一個 market simulator
- 一個完整商業產品 MVP

如果做成上面任何一個，都會失焦。

---

## 2. Demo 要證明什麼

這個 demo 只需要證明一件事：

> **世界不是被人手動改設定，而是會經過 observe → propose → judge → apply → outcome → precedent 的治理循環。**

也就是人打開頁面後，不是看到：

- 一堆 agent 訊息
- 一堆 logs
- 一堆 JSON 狀態

而是看到：

1. 一個 world 現在處於什麼狀態
2. 它因為什麼問題提出 change
3. 那個 change 被 judge
4. 它真的改變了世界
5. 世界後來的反應被量到
6. 這次後果被寫成 precedent

只要這六件事連起來，demo 就成立。

---

## 3. Demo 的唯一 canonical story

不要做兩三種故事。
只做一種，而且做得很硬。

### Canonical story
> 20:00 Festival Square 過熱，北門壅塞。
> Safety Chief 提出 `throttle_entry(north_gate)`。
> Judge 給 `approved_with_constraints`。
> 系統套用 60 分鐘限流。
> Pulse 從 `peak/unstable` 變成 `peak/managed`。
> 一小時後 outcome 顯示 congestion 下降、complaint rate 下降。
> 系統寫下 precedent，並提出下一輪 law adjustment。

如果這條故事跑不順，別做第二條。

---

## 4. Demo 的成功標準

### 最低成功標準
只要這 8 點成立，就算 demo 成功：

1. 能建立 `Midnight Market` 世界
2. 能開一輪 cycle
3. 能收 observation
4. 能生成 1 個真 proposal
5. 能經過 deterministic judgment
6. 能 apply change 並更新 snapshot
7. 能讓 UI / pulse 看出世界改變
8. 能產生 outcome report + precedent

### 額外加分，但不是必要
- 三個 chiefs 都有提案
- 有 bundle conflict resolution
- 有真正的 human approval path
- 有 auto rollback

---

## 5. Demo 的最小建模範圍

要故意做小，不然會掉進產品幻覺。

### 世界
- 1 個 world：`Midnight Market`

### 區域
- 2 個 zone：
- `zone_a = Creator Lane`
- `zone_b = Festival Square`

### 入口
- 2 個 gates：
- `north_gate`
- `south_gate`

### Chiefs
- `economy`
- `safety`
- `event`

### Metrics
- `congestion_score`
- `stall_fill_rate`
- `checkout_conversion`
- `complaint_rate`
- `fairness_score`

### Change kinds
- `adjust_stall_capacity`
- `adjust_spotlight_weight`
- `throttle_entry`
- `pause_event`
- `modify_pricing_rule`

但 demo path 只真的演一次：
- `throttle_entry`

其他四個只要 schema 在，不必都跑。

---

## 6. Demo 的核心原則：先把「骨頭」做出來，再補「活著的感覺」

順序不能反。

### 先做骨頭
- world state
- proposal
- judgment
- apply
- outcome
- precedent

### 再做感覺
- pulse
- tonight page
- SSE
- “這東西活著”的表現

如果反過來，最後會變成會動的假東西。

---

## 7. 四段式 demo path

我建議切四段，而不是十幾個小 issue。

---

# Phase 1 — World Spine
## 目標
先讓 `Midnight Market` 成為一個真的 world，而不是 hardcoded page。

### 要做的事
1. 完成 `WorldManager`
2. 完成 `pack/apply`
3. 完成 `world routes`
4. 建立 `midnight-market.yaml`
5. 能從 pack 建出初始 snapshot

### 需要落地的東西
- `worlds`
- `world_snapshots`
- `GET /api/v1/worlds/:id`
- `GET /api/v1/worlds/:id/snapshot`
- `POST /api/v1/worlds/:id/cycles`

### 產物
- `world_midnight_market_001`
- `snap_...` 初始 snapshot
- `cycle_...` 第一輪

### 驗收
> 呼叫 `POST /api/v1/pack/apply` 後，真的得到一個市場世界，而不是一堆 config 檔。

### 不要做
- 不要先做漂亮 UI
- 不要先做 adapter
- 不要先做多世界

---

# Phase 2 — Judgment Spine
## 目標
把 change proposal / judgment / apply 串成一條真治理鏈。

這是整個 demo 最關鍵的 phase。
沒有它，Thyra 只是有世界，還不是治理世界。

### 要做的事
1. 固定 `throttle_entry` proposal schema
2. 做 deterministic judge
3. 做 `applyProposal`
4. 做 `rollback` 基礎能力
5. 開啟 `outcome_window`

### 最少 endpoint
- `POST /api/v1/cycles/:id/proposals`
- `POST /api/v1/proposals/:id/judgment`
- `POST /api/v1/proposals/:id/apply`
- `POST /api/v1/applied-changes/:id/rollback`

### 最少資料流
```text
observation
→ proposal
→ judgment_report
→ applied_change
→ new_snapshot
→ open_outcome_window
```

### 驗收
> 你能指著一條 proposal 說：
> 「這不是建議，這是一個被判決、被套用、可回滾的世界變更。」

### Phase 2 的具體 demo 值
到這一步，其實已經比大多數 agent product 更有骨頭了。

---

# Phase 3 — Living Surface
## 目標
讓人能“看見”世界在動。

不是做產品首頁，
而是讓那條治理鏈第一次能被感知。

### 要做的事
1. `GET /api/v1/worlds/:id/pulse`
2. `GET /api/v1/worlds/:id/pulse/stream`
3. Tonight Page 最小版
4. 顯示：
- current mode
- top concern
- latest proposal
- latest judgment
- latest applied change
- health score

### Tonight Page 第一屏應該只有這些
- 一個大 pulse / health number
- `peak / unstable` 或 `peak / managed`
- 目前最大的 concern
- 最新變更
- zone / gate 狀態

### 驗收
> 不看 log，也能看出世界剛剛因為一個治理決策而改變了。

### 不要做
- 不要做完整後台
- 不要做 agent chat 面板
- 不要做十種卡片

---

# Phase 4 — Outcome & Memory Closure
## 目標
把這個 demo 從「會改」升級成「會學」。

### 要做的事
1. outcome window evaluator
2. outcome report
3. precedent record
4. governance adjustment proposal（哪怕只是草案）

### 最少 endpoint
- `POST /api/v1/outcome-windows/:id/evaluate`
- `GET /api/v1/worlds/:id/precedents`
- `POST /api/v1/worlds/:id/governance-adjustments`

### 最少資料流
```text
applied_change
→ wait outcome window
→ evaluate metrics
→ outcome_report
→ precedent_record
→ governance_adjustment
```

### 驗收
> 系統不只是知道「做了什麼」，而是知道「這件事後來有沒有讓世界變好」。

這一步一成立，閉環才算真的閉。

---

## 8. 2 週版本 vs 3 週版本

---

### 2 週版：只求閉環成立
這個版本不要太貪心。

#### 第 1 週
- Phase 1 world spine
- Phase 2 judgment spine

#### 第 2 週
- Phase 3 living surface
- Phase 4 outcome closure

#### 這版的妥協
- observations 可以半 hardcoded / 半腳本生成
- chiefs 可以先用規則式，不用 LLM
- pulse 可先用簡單 score 合成
- governance adjustment 先只生草案，不必真的套用

### 這版要拿到的感覺
> 「喔，這真的不是一個 task runner。」

---

### 3 週版：加一點活性
如果有第 3 週，就補：

1. 三個 chiefs 都真正出場
2. `event` 與 `economy` 對 `safety` proposal 有 reaction
3. `approved_with_constraints` 真的有 guardrail
4. 加一個簡單 auto rollback rule
5. closing cycle + morning summary

這樣就不只是 skeleton，會開始像一晚真的結束了。

---

## 9. Demo 路徑要刻意採「半 scripted，半 live」

這點很重要。

如果全 scripted，會像假 demo。
如果全 live，兩週內容易死。

### 建議做法
#### Scripted 的部分
- 初始世界
- 初始 congestion incident
- baseline metrics seed
- 第一個 proposal 必出現

#### Live 的部分
- judge 真跑
- apply 真改 snapshot
- pulse 真更新
- outcome 真算
- precedent 真落地

也就是：

> **把故事固定，但把治理鏈做真。**

這是最划算的 demo 策略。

---

## 10. Phase-by-phase kill criteria

這很重要，不然會一路硬做。

### Phase 1 kill criteria
如果做完後還無法清楚回答：
> 「這個 world 到底跟一個普通 config + DB 有什麼不同？」

那就不能進 Phase 2。

### Phase 2 kill criteria
如果 proposal / judgment / apply 還在語義上像 generic task，
例如你看 code 仍然覺得核心是 `runTask()`，
那不能進 Phase 3。

### Phase 3 kill criteria
如果 UI 只能顯示 logs，不能顯示 world pulse 與 latest change impact，
那不能進 Phase 4。

### Phase 4 kill criteria
如果 outcome report 寫不出「這次 change 為什麼 beneficial / harmful」，
那這個 demo 只是會動，不是會學。

---

## 11. 最少 issue map

如果硬拆 issue，我會只拆這些，不要再更多。

### P1 — World
- WorldManager rescue
- pack/apply endpoint
- world routes
- midnight-market.yaml

### P2 — Change / Judge
- `throttle_entry` proposal schema
- judgment engine v0
- apply engine
- rollback engine
- outcome window open

### P3 — Pulse / Surface
- pulse service
- pulse SSE
- Tonight Page minimal UI

### P4 — Outcome / Memory
- outcome evaluator
- precedent writer
- governance adjustment draft

這就夠了。

---

## 12. Demo 演示腳本

如果最後真的要 demo 給人看，我會這樣演，不多不少 6 分鐘。

### Minute 0–1
建立 Midnight Market
打開 Tonight Page，看到：
- `mode = peak`
- `health = 61`
- top concern = north gate congestion

### Minute 1–2
切到 cycle / observation view
看到本輪 observation：
- congestion score 87
- complaint spike
- festival square traffic overheating

### Minute 2–3
Safety Chief 提 `throttle_entry`
顯示 proposal card：
- scope
- reason
- expected outcome
- rollback plan

### Minute 3–4
Judge 跑完
顯示：
- `approved_with_constraints`
- 60 分鐘有效
- traffic drop >10% auto rollback

### Minute 4–5
Apply 後切回 Tonight Page
看到：
- north gate = throttled
- pulse = `peak / managed`
- latest change = `throttle_entry(north_gate)`

### Minute 5–6
Outcome report 出來
顯示：
- congestion 87 → 63
- complaint rate ↓
- verdict = beneficial
- precedent created
- suggested governance adjustment = lower intervention threshold

這 6 分鐘比十頁投影片更有說服力。

---

## 13. 這個 demo 最容易犯的四個錯

### 錯 1：做成 market dashboard
只有圖表，沒有治理鏈。

### 錯 2：做成 multi-agent chat show
很多 chief 在說話，但世界沒有被制度化改變。

### 錯 3：做成 admin console
一堆操作按鈕，但 proposal / judgment / precedent 沒站在中心。

### 錯 4：做成 fake living UI
數字在跳，但沒有 apply → outcome 的真鏈條。

如果看到自己往這四種方向滑，就要立刻砍。

---

## 14. 這個 demo 做對後，下一步才會自然長什麼

如果 canonical slice 成立，下一步才有意義：

- 第二個 change kind
- 第二個 canonical story
- closing cycle / morning summary
- Creator vs Festival 的公平衝突
- 真實人類 action 進 observation
- event chief 與 economy chief 的 bundle conflict
- pricing rule 的 outcome semantics
- 真正的 checkout / booking

這些都應該是從第一個 slice 長出來，
不是一開始就平鋪。

---

## 15. 最後一句

> **Midnight Market demo path 的重點，不是先做一個會賣東西的夜市。**
>
> **而是先做出一個會因為 change 而改變、會因為後果而學習的夜市。**
>
> 只要這條 demo path 跑通一次，Thyra 就不再只是「世界治理」的說法，
> 而會變成一個真的有 canonical form 的系統。

---

如果你要，我下一步最順的就是：

1. `pulse-and-outcome-metrics-v0.md`
2. `midnight-market-governance-storyboard.md`

我覺得現在該接 **1**，因為 demo path 有了，下一個最容易變空的就是 pulse 跟 outcome 到底怎麼定。