# Working Contract v0

> 狀態：`working contract`
>
> 目的：這不是最終 spec，也不是直接可實作的 API 契約。
> 它的角色是把目前已經足夠穩定、足以約束後續討論的 world 路線固定下來。
>
> 主要來源：`docs/世界補充2.md`

---

## 1. 這份文件要固定什麼

這份 `Working Contract v0` 主要固定六件事：

1. `Thyra` 到底在治理什麼。
2. 什麼才算 `minimum world`。
3. 一個 world 至少要有哪些層。
4. 人類、mixed agent、world 之間的關係如何分工。
5. 多世界系統裡，什麼應該可攜，什麼必須在地。
6. 什麼樣的 proof 才能證明我們做的是 `world runtime`，而不是生成器或 agent workflow。

---

## 2. 核心定位

`Thyra` 目前的工作定位不是：

- agent org chart
- AI employee management
- generic agent control panel

`Thyra` 目前的工作定位是：

> **a governance layer for governable world runtimes**

也就是：

- 我們真正保護的對象不是 agent
- 我們真正保護的對象是 world
- agent 是世界中的執行者，不是產品本體

因此這條路線的主視角不是：

- 誰在做事
- 誰卡住
- 哪個 agent 成本高

而是：

- 世界現在是什麼狀態
- 哪些變更合法
- 哪些變更應該被擋下
- 世界是否朝目標穩定演化

---

## 3. Minimum World 文法

目前採用的最小文法是：

> **`minimum world = state + change + judge`**

### 3.1 `state`

回答：

- 世界現在是什麼
- 世界由哪些穩定物件、關係、規則構成

典型對應：

- IR
- schema
- world model
- board snapshot
- runtime state

### 3.2 `change`

回答：

- 世界怎麼變
- 哪些變更是合法形狀
- 哪些變更可回滾、可比較、可追溯

典型對應：

- patch
- diff
- transaction
- apply
- rollback

### 3.3 `judge`

回答：

- 這個 change 之後世界變好還是變壞
- 有沒有破壞一致性
- 有沒有超出 law / constitution 邊界

典型對應：

- validation
- evaluator
- constitution
- law
- precedent
- simulation

### 3.4 最小文法的含義

這裡的關鍵不是單純有三種模組，而是三種存在條件：

- 沒有 `state`，沒有世界
- 沒有 `change`，沒有演化
- 沒有 `judge`，沒有治理

所以 minimum world 真正要制度化的，不只是靜態 state，而是：

> **可被 judge 的 change over state**

---

## 4. 什麼不算世界

下面這些東西目前不應該被升格成 world：

- 單輪 prompt playground
- 一次性輸出的 generator
- 沒有穩定 state 的 workflow
- 沒有合法 change 形狀的 automation
- 沒有 continuity、沒有 history 的 pipeline

因此：

`YAML -> 結果`

最多只能證明：

- compiler 很強
- generator 很強

不能證明：

- 世界存在
- 世界可被治理
- 世界能被長期經營

---

## 5. World 的四層

目前 working contract 採用四層 world 結構：

### 5.1 Founding Layer

回答：

- 這個 world 一開始想成為什麼
- 根本目標與根本邊界是什麼

典型對應：

- `Village Pack`
- `village.yaml`
- 初始 constitution / budget / evaluator / skill binding

這一層的定位是：

> `seed / charter / founding document`

它不是世界本體。

### 5.2 Runtime Layer

回答：

- 世界現在活成什麼樣
- 當前有哪些 state、relations、budgets、pending changes

典型對應：

- current state
- tasks
- active laws
- transactions
- board / surface
- local events

### 5.3 Memory Layer

回答：

- 這個 world 怎麼變成現在這樣
- 類似變更以前發生過什麼

典型對應：

- precedent
- snapshots
- outcomes
- audit
- rollback history
- reputation / lesson memory

### 5.4 Interface Layer

回答：

- 人與 AI 如何進入這個 world
- 這個 world 如何被觀看、治理、參與

典型對應：

- authoring surface
- governance dashboard
- resident UI
- approval surface
- publication / public feed

---

## 6. 人機角色合約

目前 working contract 不接受「所有人都直接操作同一個後台」這種想像。

人類在 world 系統中的角色至少分成四種：

### 6.1 Architect / Legislator

負責：

- 建 world
- 定 constitution
- 定高層目標
- 設定初始 evaluator / budget / constraints

這一層主要對應 `Village Pack`。

### 6.2 Governor / Operator

負責：

- 看 world health
- review change
- approve / reject
- rollback / supersede
- 觀察 precedent 與 simulation

### 6.3 Resident / Participant

負責：

- 在世界中生活、互動、創作、經營、交易

### 6.4 Proxy / Mixed Agent Owner

負責：

- 透過個人代理處理高層意圖翻譯
- 管理跨世界摘要
- 把自然語言願望轉成合法 proposal

---

## 7. Mixed Agent 合約

目前 working contract 假設：

> **人不應該直接裸連 world，world 也不應該直接吃到完整的人。**

中間必須存在一層：

> **mixed agent / personal steward**

它不是：

- 普通 assistant
- world chief
- world governance authority

它更像：

- private steward
- world representative
- continuity carrier

### 7.1 Mixed Agent 的責任

- 往上理解 human intent
- 往下理解 world 的合法語法與風險邊界
- 處理低風險代理
- 整理需要人回來批准的例外

### 7.2 Mixed Agent 與 Chief 必須分離

這是目前的硬邊界：

- `chief` 是世界內公職，對 constitution 與 world governance 負責
- `mixed agent` 是私人代理，對人的意圖與授權負責

兩者不能混成同一個角色。

---

## 8. 多世界與多表面

目前 working contract 不採用「單一大宇宙」模型。

採用的是：

> **multi-world + multi-surface + shared protocol**

### 8.1 多世界

世界不是一個，而是很多個局部世界，例如：

- content village
- game world
- design world
- media universe
- shop / channel / community world

### 8.2 多表面

目前至少承認四種 surface：

- `private surface`
- `local surface`
- `territory surface`
- `public / cross-world surface`

這代表：

- 社會不是靠一個總黑板成立
- 而是靠多個可見表面與互動層次成立

### 8.3 Shared Protocol

世界之間不是直接互相亂 call。

它們至少需要：

- 共通協議
- 可公開表面
- 治理邊界

也就是：

- 哪些資訊可被別的 world 讀到
- 哪些 change 可跨世界引用或傳播
- 哪些 interaction 需要 approval

---

## 9. 可攜與在地的邊界

目前 working contract 採用下面這個原則：

> **portable self, local worlds, federated protocol**

### 9.1 可攜的東西

可以跨世界攜帶的通常是：

- identity
- 高層偏好
- 價值傾向
- 風險容忍度
- 摘要式記憶
- reputation / trust attestation
- claim / capability reference

### 9.2 必須在地的東西

必須 `local-first` 的通常是：

- world state
- local law interpretation
- local social graph
- local economy
- pending changes
- 原始事件流
- 本地角色地位

### 9.3 Working Rule

跨世界應優先攜帶：

- attestation
- claim
- summary

不應優先攜帶：

- raw object
- raw state dump
- full persona dump

---

## 10. 產品畫面與主語言

如果承認上面的 contract，產品主視圖就不應該先是：

- agent board
- session list
- token cost panel

而應該先是：

- world health
- pending changes
- change review
- active laws
- simulation result
- precedent alerts

也就是：

> `Change Review / World Health / Policy Surface`
>
> 比 `Agent Board` 更接近產品本體

agent 可以存在，但應是 secondary view。

---

## 11. Proof Contract

目前 working contract 明確規定：

> **要證明的是 world runtime，不是單次生成能力。**

### 11.1 弱 proof

`YAML -> 結果`

只能證明：

- 能生成
- 能編譯
- 能把高層設定落成作品

### 11.2 強 proof

`YAML -> 結果 -> patch -> evaluate -> rollback/supersede -> continuity`

才能證明：

- 這個 world 有持續 state
- 這個 world 有合法 change
- 這個 world 有 judge
- 這個 world 可被治理
- 這個 world 不是每輪重開新局

### 11.3 Demo 原則

最有說服力的不是第一次生成，而是第二次、第三次：

- world 已存在
- change 被 apply
- consistency 仍然保住
- rollback 真的回得去
- precedent 真的能被引用

---

## 12. 第一個 exemplar 的選擇規則

第一個 exemplar 不應追求：

- 最通用
- 最大敘事
- 最像宇宙

第一個 exemplar 應追求：

- 最高密度
- 最清楚的 state
- 最清楚的 change
- 最清楚的 validation
- 最清楚的 rollback
- 最明顯的 precedent 價值

所以目前比較合理的候選是：

- game / sidecar 類世界
- content world
- design / asset world
- 虛擬人 / 敘事宇宙

更抽象地說：

> 第一個 exemplar 不一定是遊戲，
> 但應該是一種可被人類看見其演變、且演變有規則、有一致性壓力、有評估需求的媒介。

---

## 13. 商業路徑合約

目前不採用「先賣抽象平台」的路徑。

working contract 假設的商業順序是：

1. 先賣垂直結果或 sidecar 改造
2. 再把共通治理能力抽成 Thyra layer
3. 最後才談 spec / ecosystem / certification

原因是：

- 抽象平台太早賣不動
- 大公司更容易吃掉通用基建
- 真正的護城河在世界設計、evaluator、law、precedent、sidecar integration

---

## 14. 目前的 Invariants

以下條件現在可以視為 `Working Contract v0` 的 invariants：

1. `Thyra` 治理的是 world，不是 agent。
2. `minimum world = state + change + judge`。
3. `Village Pack` 是 founding layer，不是 world 本體。
4. `mixed agent` 與 `chief` 不能混成同一角色。
5. 世界不是單一大宇宙，而是 multi-world network。
6. 世界不是單一總黑板，而是 multi-surface system。
7. 可攜的是 summary / attestation / claim，不是 raw object / raw persona。
8. `YAML -> 結果` 不能證明 world runtime；必須有 change + judge + continuity。
9. 第一個 exemplar 應選高密度 world，而不是最通用 world。
10. 產品主視圖應以 world health / change review / policy surface 為中心。

---

## 15. 目前還沒定案的部分

下面這些現在還不能假裝已定案：

- mixed agent 的具體權限模型
- cross-world identity contract
- attestation 的正式 schema
- local rights envelope 的正式 schema
- territory / federation 的正式 protocol
- 哪個垂直 world 要成為第一個 canonical exemplar
- 哪個媒介最適合做第一個外部 demo

這些應該視為 `open questions`，而不是偷偷變成預設事實。

---

## 16. 一句話版本

如果把整份 `Working Contract v0` 壓成一句話：

> **我們正在做的不是 agent 管理系統，而是讓特定領域成為 AI 可居住、可變更、可裁判、可治理、可持續演化的 world runtime。**

而 `Thyra` 在其中扮演的是：

> **世界的治理層，而不是執行者本身。**
