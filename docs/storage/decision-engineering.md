# decision-engineering.md

> 狀態：`working draft`
>
> 目的：定義我們現在其實在做的是什麼。
>
> 這份文件不是在講：
> - 一個具體產品
> - 一組 tracks
> - 一個 world runtime
>
> 它要回答的是：
>
> > **為什麼我們會需要 skill、spec、track、pre-DAG、promotion 這些中間層？**
> > **它們合起來到底在工程化什麼？**

---

## 1. 一句話

> **Decision Engineering = 把原本只存在於聊天、腦中直覺、反覆修改裡的決策過程，外部化成可檢視、可 patch、可升格、可交接的工程流程。**

它不是把所有思考變硬。
而是把那些：

- 反覆會出錯
- 反覆會飄移
- 反覆會太早跳步
- 反覆會在 build 階段才爆炸

的關鍵決策，變成有結構的中介層。

---

## 2. 它不是什麼

### 誤解 1：skill 只是 prompt 包裝
不是。

在這裡，skill 更像：
> **決策協議的重播器**

它固定：
- 何時該問哪個問題
- 何時該產哪種文件
- 何時該停手
- 何時該 promotion

---

### 誤解 2：spec 只是比較長的筆記
不是。

在這裡，spec 不只是描述，
而是：
> **決策狀態的外部表示**

它讓系統知道：
- 現在概念穩了沒
- canonical form 有沒定
- 哪個邊界還在飄
- 哪份文件該 patch

---

### 誤解 3：track 只是文件版 todo list
也不是。

track 是：
> **已被授權進入執行層的工作分解狀態**

它和 spec 的差別不是「長短」，
而是：
- spec 定義「這東西是什麼」
- track 定義「這東西怎麼做」

---

### 誤解 4：多一層只是多 bureaucracy
不一定。

如果前置層多出來後，只是增加 paperwork，當然是壞事。
但如果它能提前暴露：

- 名稱漂移
- 邊界衝突
- world 假 closure
- 太早 build
- 假 selection
- 錯 regime routing

那這層就不是 bureaucracy，
而是：
> **早期錯誤檢測層。**

---

## 3. 核心問題：我們到底在工程化什麼？

不是在工程化「答案」。
而是在工程化：

# **決策與修改的流程**

也就是：

- 如何把模糊意圖轉成 search space
- 如何知道現在該不該 build
- 如何把聊天變成可檢視的 spec
- 如何 patch spec 而不是重聊一遍
- 如何知道什麼時候該 promotion
- 如何把已成熟的決策轉交給 planning / build / runtime

這整套，才是 decision engineering 的對象。

---

## 4. 為什麼這件事以前沒有被顯性化？

因為很多團隊都默認以下流程：

```text
聊天 / 直覺 / 靈感
→ 快速形成方案
→ 拆任務
→ 開始做
```

這在簡單問題上有效。
但在高不確定問題上，會不斷出現：

- build 錯東西
- tracks 排得很合理，但前提錯了
- 名詞一改，整包設計都散
- spec、planning、runtime 邊界混在一起
- 修改只能靠重聊，不是 patch

也就是說，問題不是大家不會做，
而是：

> **缺少一個可重複、可外部檢視的前置決策層。**

---

## 5. Decision Engineering 的三個核心轉換

---

### 5.1 從「聊天」到「外部狀態」
沒有 decision engineering 時，決策大多在對話流裡。
一旦對話結束或變長，很多細節就漂了。

有了 decision engineering 之後：

```text
聊天
→ spec / card / memo / route result
```

這些中介物變成外部狀態。
可以被：
- 看
- 改
- review
- handoff
- 記錄

---

### 5.2 從「重聊」到「patch」
沒有中介層時，發現問題常常只能：

- 重新解釋
- 重新整理
- 重新理解
- 重新下決策

有了 spec / track / memo 之後，問題會變成：

- 是 `canonical-cycle.md` 要改？
- 還是 `shared-types.md` 撞了？
- 是 `path-check` 判太早？
- 還是 `probe-commit` 的 signal 判準錯了？

這就是從**口頭修正**變成**結構化 patching**。

---

### 5.3 從「感覺差不多可以做了」到「promotion」
沒有 promotion rule 時，常見兩種錯：

- 太早做
- 太晚做

Decision engineering 的一個關鍵就是把這件事顯性化：

> **什麼條件成立，才算概念穩到可以交給下一層？**

這就是 promotion。

---

## 6. 它和一般工程流程的差別

### 一般工程流程
比較像在處理：
- implementation
- tasks
- dependencies
- execution

### Decision engineering
處理的是：
- 問題 framing
- realization selection
- world / vehicle / path 的成形
- maturity gate
- spec 修正與升格

換句話說：

> 一般工程是在工程化「怎麼做」
> decision engineering 是在工程化「到底做什麼，以及何時配做」

---

## 7. 三種狀態載體

Decision engineering 不是抽象哲學。
它需要依附在不同種類的外部狀態上。

---

### 7.1 Skill
skill 是：
> **決策協議的可重播容器**

它規定：
- 何時用
- 用什麼順序想
- 何時停
- 何時轉交其他 skill / layer

例如：
- `arch-spec`
- `project-plan`

---

### 7.2 Spec
spec 是：
> **概念與邊界的狀態載體**

它承載：
- 母題
- canonical form
- schema
- APIs
- slice
- demo path
- promotion rules

它不是最終答案，
是可被檢視與 patch 的中間狀態。

---

### 7.3 Track / Task
track 是：
> **概念已成熟後的執行狀態載體**

它承載：
- work breakdown
- dependency DAG
- batch order
- verification
- DoD

所以：
- skill 是 protocol
- spec 是 definition state
- track 是 execution state

三者各自不同。

---

## 8. 典型流程：從模糊到執行

Decision engineering 典型會長這樣：

```text
聊天 / 模糊問題
→ intent-router
→ path-check
→ space-builder
→ probe-commit
→ arch-spec stack
→ review / patch / add / shared-types
→ promotion
→ project-plan
→ forge / code
→ live runtime
→ thyra governance
→ edda precedent
```

這裡每一層都不是多餘的。
它們是不同類型不確定性的處理層。

---

## 9. Decision Engineering 不是 DAG orchestration

這點要明確切開。

### DAG orchestration 在處理
- 已知工作節點
- 依賴順序
- 平行執行
- completion

### Decision engineering 在處理
- 節點還沒出現之前
- realization path 還沒固定之前
- 哪條路值得被 build
- 哪個 world 值得 instantiate
- 哪個決策值得升格

所以：

> **DAG 是 decision engineering 之後的層。**

Decision engineering 不是 DAG，
但它會產生 DAG 的輸入。

---

## 10. 三層模型

這可以當成整套系統最清楚的總圖。

---

### Layer 1 — Pre-DAG Decision Layer
處理：
- intent
- path certainty
- realization space
- probe / commit

典型模組：
- intent-router
- path-check
- space-builder
- probe-commit

---

### Layer 2 — Planning / DAG Layer
處理：
- tracks
- tasks
- dependencies
- validation

典型模組：
- project-plan
- karvi dispatch planning

---

### Layer 3 — Live Runtime / Governance Layer
處理：
- state
- change
- judgment
- pulse
- outcomes
- precedent-fed adaptation

典型模組：
- Thyra
- world runtime
- governance loop

---

### Spine — Memory / Precedent
貫穿所有層：
- intent classification precedents
- failed probes
- commit memos
- build decisions
- runtime outcomes

典型模組：
- Edda

---

## 11. 為什麼這種工程化是值得的？

因為它把原本最容易出錯的地方，提前變成可操作物。

---

### 11.1 提前暴露誤解
不是在 build 階段才發現：
- 其實這不是 world
- 其實 buyer 沒定
- 其實這只是 dashboard
- 其實 vehicle 根本沒選

---

### 11.2 允許局部修正
不是整體重想，而是局部 patch。

---

### 11.3 允許交接
你不是只能靠某個人腦內保留 context。
而是可以把：
- spec stack
- commit memo
- promotion package
交給下一層。

---

### 11.4 形成 precedent
以後可以知道：
- 什麼時候太早 build
- 哪種 probe 是假 signal
- 哪種 closure 是假的
- 哪種 naming drift 最常發生

這時候 decision engineering 才會越來越強。

---

## 12. 最常見的 anti-patterns

### 1. 把聊天直接當 spec
沒有結構，無法 patch。

### 2. 把 spec 直接當 planning pack
少了 promotion 和 decomposition。

### 3. 把所有決策壓成一份 god doc
之後無法局部修改。

### 4. 把所有 regime 拉平成同一種 selection
例如 economic / governance / expression 共用一套評分語言。

### 5. 太早進 build
這是最貴的錯。

### 6. 無限停在 spec，不 promotion
這是另一種貴錯。

---

## 13. 這整套的真正單位是什麼？

不是 file。
不是 markdown。
不是 skill。

真正單位是：

# **decision state transition**

也就是：

- 模糊意圖 → routed intent
- routed intent → checked path
- checked path → candidates
- candidates → probed signal
- signal → commit memo
- commit memo → build plan
- build result → runtime state
- runtime outcome → precedent

文件與 skill 只是把這些 transition 固定下來的載體。

---

## 14. 最後一句

> **Decision Engineering 不是把討論變官僚，也不是把直覺變僵硬。**
>
> **它是在做一件更實際的事：讓那些原本靠聊天與感覺反覆修改的關鍵決策，擁有自己的外部狀態、自己的升格條件、自己的 patch 路徑、以及自己的記憶。**
>
> 只有這樣，從聊天到 spec，到 track，到 code，到 runtime，整條鏈才不會每一層都重新發明一次問題。

---

相關文件：
- `decision-state-storage.md` — 狀態分層與落地
- `storage-topology-v0.md` — 五層 storage 拓樸圖
- `cross-layer-ids-v0.md` — 跨層 ID 對齊
- `persistence-policy-v0.md` — 寫入規則
- `promotion-handoff-schema-v0.md` — 升格 handoff 包
- `promotion-rollback-v0.md` — 升格退回機制
- `edda-ingestion-triggers-v0.md` — Edda 寫入觸發條件