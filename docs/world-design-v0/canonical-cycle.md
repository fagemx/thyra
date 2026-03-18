# canonical-cycle.md

> **Thyra Canonical Cycle**
>
> 狀態：`working draft`
>
> 目的：把 Thyra 的核心概念壓成一條**可反覆運轉的世界循環**，讓產品語言、架構語言、工程語言對齊。
>
> ARC 的對齊來自：
> `idea → stages → artifacts → paper`
>
> Thyra 的對齊應來自：
> `world → cycle → changes → outcomes → precedent → next cycle`

> 型別定義見 `./shared-types.md`。本文件不重新定義型別。

---

## 1. 一句話定義

> **Thyra 不是任務編排器，而是 world governance runtime。**
>
> 它的最小可運作單位不是 task，也不是 agent turn，
> 而是：
>
> **一個世界在某個時間窗內，如何觀察自己、提出變更、判斷是否合法、套用或回滾、承受後果、形成判例，並進入下一輪。**

---

## 2. Canonical Cycle

Thyra 的核心不是大 pipeline，而是固定循環：

```text
WORLD
→ OBSERVE
→ PROPOSE CHANGE
→ JUDGE
→ APPLY / ROLLBACK
→ PULSE
→ OUTCOME WINDOW
→ PRECEDENT
→ LAW / CHIEF ADJUSTMENT
→ NEXT CYCLE
```

這條 cycle 是 Thyra 的骨架。
所有模組、UI、API、資料表、bridge，最後都應該對齊這條循環。

---

## 3. 為什麼不是 ARC 式 stage machine

ARC 處理的是**有限流程**：

- topic init
- literature review
- experiment
- paper draft
- review
- archive

它有明確起點與終點。

Thyra 處理的是**持續存在的世界**：

- 世界不因一次執行而結束
- 變更有長期後果
- chief 需要持續值班
- outcome 要回寫治理
- 下一輪必然存在

所以 ARC 的 canonical form 是：

> **state machine**

Thyra 的 canonical form 是：

> **governed cycle**

---

## 4. Cycle 的十個階段

### 0. WORLD
先有世界本體。

不是 prompt，不是任務，不是抽象 spec。
而是可被治理的 state space。

世界至少必須有：

- state
- objects
- boundaries
- goals
- history
- active laws
- active chiefs

---

### 1. OBSERVE
世界先被觀察，而不是先被改。

來源可能包括：

- 世界內部 state 差異
- 外部事件
- 人類操作
- 過去 change 的 outcome
- chief 自己的定期巡檢

這一步的目的不是下結論，
而是產生本輪治理的觀察材料。

---

### 2. PROPOSE CHANGE
Chiefs 根據 observation 提出 change proposal。

這一步不是 generic task dispatch，
而是世界級變更提案。

例：

- 調整某區攤位上限
- 改 spotlight 策略
- 限流某入口
- 關閉某活動規則
- 修改某條 law 的閾值

提案是 Thyra 的第一級公民，不是附帶備註。

---

### 3. JUDGE
Thyra 對 change proposal 做合法性與風險判斷。

不是只問「能不能做」，還要問：

- 合不合憲？
- 有沒有違反 invariants？
- 需不需要 simulate？
- 風險等級是 low / medium / high？
- 能否自動套用？
- 是否需要人類批准？

這一步是治理的核心。

---

### 4. APPLY / ROLLBACK
被批准的 change 套用到世界。
有害或違法的 change 被拒絕、延後、或回滾。

這一步不是一般的「execute」，
而是：

- apply to world state
- record diff
- persist snapshot
- attach judgment
- open outcome window

rollback 不是例外處理，而是 canonical action。

---

### 5. PULSE
世界在套用 change 後，必須能發出 pulse。

pulse 不是 dashboard 美術效果，
而是世界活著的最低訊號。

pulse 代表：

- 世界現在的 health
- 本輪是否有重大變更
- 是否過熱 / 失衡 / 停滯
- 哪個 chief 正在主導當前局面

如果沒有 pulse，外界只會看到 log，不會感到這是世界。

---

### 6. OUTCOME WINDOW
每個重要 change 都要進入 outcome window。

不是 change 一套用就算完成，
而是要留一段時間看後果。

這裡回答的是：

- 這個 change 讓世界變好還是變壞？
- 哪些 metric 被影響？
- 影響是短期還是持續？
- 有沒有副作用？

這一步把 Thyra 從「能改」變成「會學」。

---

### 7. PRECEDENT
Outcome 不能只留在 log。
它要被寫成 precedent。

precedent 記的是：

- 哪種 change pattern
- 在什麼世界條件下
- 導致了什麼後果
- 最後是否 beneficial / harmful / neutral

這一步讓 Edda 的位置成立。
Edda 不只是記對話，而是記 change → outcome 的因果。

---

### 8. LAW / CHIEF ADJUSTMENT
precedent 不能只存著。
它要回流到治理。

回流方式包括：

- 修 law 門檻
- 改 chief 權限
- 調整 chief 風格
- 關閉某種高風險自動化
- 對某種 change pattern 加上強制 simulate

這一步讓 Thyra 真正像管理層，不只是裁判。

---

### 9. NEXT CYCLE
世界不停止。

上一輪留下：

- 新狀態
- 新 precedent
- 新 law
- 新 chief 傾向
- 新問題

這些一起成為下一輪的起點。

---

## 5. Canonical Artifacts

ARC 有 paper、references、review、verification report。
Thyra 也需要自己的 canonical artifacts。

最低限度，應固定這 9 個：

```text
1. world_snapshot.json
2. observation_batch.json
3. change_proposal.json
4. judgment_report.json
5. applied_change.json
6. pulse_frame.json
7. outcome_report.json
8. precedent_record.json
9. governance_adjustment.json
```

如果沒有這組 artifacts，Thyra 很容易一直停在概念敘事。

---

## 6. 每個 artifact 的意義

### 1) world_snapshot.json
記錄某一時刻世界的完整狀態。

作用：
- continuity
- diff 基準
- rollback 基準
- pulse 基準

---

### 2) observation_batch.json
記錄本輪 chief 看到了什麼。

作用：
- cycle input
- chief reasoning input
- auditability

---

### 3) change_proposal.json
記錄本輪被提出的 change。

作用：
- change review
- simulate input
- legality target

---

### 4) judgment_report.json
記錄對提案的合法性、風險與決定。

作用：
- governance center
- approval chain
- explainability

---

### 5) applied_change.json
記錄最終實際改了什麼。

作用：
- history
- rollback
- outcome window 起點

---

### 6) pulse_frame.json
記錄世界當前脈搏。

作用：
- UI
- SSE
- surface feedback
- live visibility

---

### 7) outcome_report.json
記錄某 change 的後果。

作用：
- 判斷 beneficial / harmful / neutral
- metric scoring
- strategy correction

---

### 8) precedent_record.json
記錄「某種變更在某種條件下導致某種後果」。

作用：
- Edda retrieval
- governance memory
- cross-world reuse

---

### 9) governance_adjustment.json
記錄 outcome 如何回流到 law / chief。

作用：
- loop closure
- evolution
- next-cycle bias

---

## 7. Canonical Contracts

ARC 的 stage contract 很清楚。
Thyra 也要有 cycle contract。

---

### Contract A — Observe Contract

**Input**
- latest world snapshot
- external events
- unresolved incidents
- open outcome windows

**Output**
- observation_batch.json

**Definition of Done**
- 本輪觀察材料已被標準化
- 每筆 observation 有來源、時間、範圍、重要度

---

### Contract B — Change Proposal Contract

**Input**
- observation batch
- chief profile
- active laws
- recent precedents

**Output**
- one or more change_proposal.json

**Definition of Done**
- proposal 具有明確 scope、reasoning、target、expected effect
- proposal 不是 generic instruction，而是 world change

---

### Contract C — Judgment Contract

**Input**
- change proposal
- invariants
- constitution
- active laws
- risk rules
- simulation policy

**Output**
- judgment_report.json

**Definition of Done**
- proposal 已被分類為 approve / reject / simulate / escalate
- risk class 已明確
- judgment 可被審計

---

### Contract D — Apply Contract

**Input**
- approved proposal
- current world snapshot

**Output**
- applied_change.json
- new world_snapshot.json
- opened outcome window

**Definition of Done**
- change 已套用或已回滾
- diff 可見
- 新 snapshot 已保存

---

### Contract E — Outcome Contract

**Input**
- applied change
- outcome window metrics
- baseline snapshot

**Output**
- outcome_report.json
- precedent_record.json

**Definition of Done**
- 後果已判定
- metrics 有前後比較
- precedent 已可檢索

---

### Contract F — Governance Adjustment Contract

**Input**
- outcome report
- precedent retrieval
- current laws
- chief configs

**Output**
- governance_adjustment.json

**Definition of Done**
- law / chief / policy 的修正已形成可執行提案
- adjustment 可進入下一輪 cycle

---

## 8. 產品語言與工程語言必須對齊

Thyra 如果要像 ARC 那樣有概念—架構對齊感，
就必須強迫自己：

### 外面說什麼，裡面就叫什麼。

應該保留為第一級名詞的詞：

- World
- Snapshot
- Observation
- Change Proposal
- Judgment
- Apply
- Rollback
- Pulse
- Outcome
- Precedent
- Law Adjustment
- Chief

應避免核心退化成：

- Task
- Job
- Worker
- Run
- Queue
- Generic Event

這些詞不是不能存在，
但不能成為產品骨架。

---

## 9. Core Engineering Shape

Thyra 的最小工程骨架應該長這樣：

```text
[External Events / Human Actions / Timers]
↓
Observation Builder
↓
Chief Runtime
↓
Change Proposal Bundle
↓
Judge / Simulate / Escalate
↓
Apply / Reject / Rollback
↓
Pulse Emitter
↓
Outcome Collector
↓
Precedent Recorder
↓
Law / Chief Adjustment Engine
↓
Next Cycle
```

這是 Thyra 的 canonical runtime。

---

## 10. 對應模組

### A. World Kernel
負責：
- world state
- snapshots
- continuity
- world boundaries

### B. Change Engine
負責：
- proposal schema
- diff
- simulate
- judge
- apply
- rollback

### C. Chief Runtime
負責：
- chief profiles
- cadence
- observation interpretation
- proposal generation
- conflict resolution

### D. Pulse / Surface
負責：
- SSE pulse
- summary
- tonight page
- world health exposure
- human ingress

### E. Outcome Engine
負責：
- metrics
- outcome windows
- verdicts
- scoring

### F. Memory / Precedent Layer
負責：
- precedent recording
- retrieval
- change → outcome trace

---

## 11. 與其他 repo 的對位

### Thyra
負責主循環：
- world
- change
- judgment
- cycle
- outcome
- governance adjustment

### Karvi
負責外部動作與 actuation：
- dispatch
- side effects
- long-running external work

Karvi 是手腳，不是法官。

### Edda
負責 precedent spine：
- change/outcome memory
- retrieval
- long-term governance memory

Edda 是判例庫，不是 runtime controller。

### Völva / surface layer
負責人類入口與感知：
- founding flow
- pulse UI
- summaries
- commands
- owned surface

---

## 12. MVP Slice

如果只做最小可對齊版本，不該直接做「完整平台」。
應先做一個 canonical slice：

### Slice 1 — One World, Three Chiefs, Five Change Types

**世界**
- Midnight Market

**Chiefs**
- Economy Chief
- Safety Chief
- Event Chief

**Change Types**
1. adjust_stall_capacity
2. adjust_spotlight_weight
3. throttle_entry
4. pause_event
5. modify_pricing_rule

**Metrics**
- congestion score
- stall fill rate
- checkout conversion
- complaint rate
- fairness score

**Cycle Cadence**
- 每 15 分鐘一輪 observe/propose/judge/apply
- 每晚結束產生 morning summary
- 每個重大 change 開 1 個 outcome window

這個 slice 一跑通，Thyra 就會開始有「像 ARC 一樣骨感清楚」的感覺。

---

## 13. Canonical UI Center

Thyra 的中心頁不應該是 Agent Board。
而應該是：

### Center = World Pulse + Pending Changes + Outcome Windows

也就是首頁應優先看到：

- 世界現在活不活
- 有哪些待判 change
- 哪些 change 剛生效
- 哪些 outcome window 正在觀察
- 哪些 precedent 剛形成
- 哪條 law 可能要修

這會直接把心智模型固定在：

> 世界治理

而不是：

> agent orchestration

---

## 14. 判準：怎樣算「像 ARC 一樣對齊」？

不是文件寫得像。
而是以下四件事同時成立：

### 1. 概念詞直接變成系統詞
world / change / judgment / precedent 真的存在於程式與資料模型裡。

### 2. 每輪 cycle 都能落成固定 artifacts
不是只有 logs，而是 canonical artifacts。

### 3. UI 中心反映 cycle，而不是反映 agent activity
首頁在看世界怎麼變，不是在看 agent 講了什麼。

### 4. 每次變更都能被 outcome 和 precedent 關回去
不是 apply 完就結束，而是會回寫治理。

---

## 15. 最後一句

> **ARC 的核心是把研究變成可執行流程。**
>
> **Thyra 的核心是把世界變成可治理循環。**
>
> 如果 ARC 的骨架是 stage machine，
> 那 Thyra 的骨架就必須是：
>
> **world cycle + change artifacts + outcome feedback**

---

相關文件：
- `change-proposal-schema-v0.md` — 變更提案 schema
- `judgment-rules-v0.md` — 判斷規則
- `world-cycle-api.md` — API 映射
- `pulse-and-outcome-metrics-v0.md` — 脈搏與後果
- `midnight-market-canonical-slice.md` — 最小實例
- `shared-types.md` — 跨文件型別