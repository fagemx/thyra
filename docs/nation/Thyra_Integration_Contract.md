我覺得**完全有可能，而且這其實不只是可行，還很像你長期最值得做的方向之一**。

因為你現在其實已經隱約分出兩個層次了：

* **Thyra**：高抽象目標、邊界、法律、預算、審批、評分、判例
* **sidecar / domain runtime**：在某個具體領域裡真的做事，例如遊戲引擎、內容系統、設計工具、資料流程

你之前那個遊戲 sidecar，其實已經很像一個「creative execution/runtime plane」；而 Thyra 那條則更像「governance/control plane」。

所以你現在問的，其實不是「能不能接」，而是：

> 能不能定義一套**通用接入公約**，讓不同領域的 AI-native 應用，都能被 Thyra 治理？

我的答案是：

## 可以，而且應該拆成兩條路一起做

### 路 1：Thyra-native 開發準則

給**新做的專案**。

也就是你說的第一種：
從一開始就規定，這個應用如果想成為「AI 治理 AI 優先」的應用，它就要遵守一組開發準則。

### 路 2：legacy sidecar 接入準則

給**既有應用**。

也就是你說的第二種：
一開始沒為 AI 設計、node 很多、沒有乾淨接口、甚至狀態很亂的系統，先用 sidecar 包一層，把它變成 Thyra 能看懂、能管、能評分、能審計的形狀。

---

# 我會怎麼定義這件事

我不會把它叫成單純的 API 或 SDK。
我會把它定義成：

## **Thyra Integration Contract**

或中文：

## **Thyra 接入公約**

它不是單純「工具怎麼被呼叫」，
而是規定一個應用如果要被 Thyra 治理，至少要暴露什麼能力。

---

# 這個公約最少要包含 6 個介面

這是我覺得最核心的地方。

## 1. Goal Interface

應用必須能接收**高抽象目標**。

例如：

* 遊戲引擎 sidecar：做出一個 chapter 1 的可玩關卡
* Blog Village：每週產 2 篇內容
* 設計工具：做出一組可交付素材
* 資料流程：產一份報表與異常分析

也就是 Thyra 下來的不是低階命令，而是：

* goal
* constraints
* budget
* approval policy
* evaluator config

---

## 2. Capability Manifest

應用必須清楚宣告自己能做什麼。

不是讓 Thyra 猜。

例如：

* `build_level_payload`
* `prepare_dialogue`
* `publish_content`
* `render_asset`
* `extract_scene_summary`

而且每個 capability 要有：

* input schema
* output schema
* estimated cost
* required skill
* risk level
* rollback support

這會是 Thyra 決策的基本素材。

---

## 3. Observe Interface

應用必須能被觀察，不然 Thyra 沒法治理。

最少要能給：

* current status
* progress
* recent signals/events
* outputs/references
* current budget usage
* failures / blocked reasons

這也是你現在在 Karvi 黑板那裡想補的東西：
Thyra 不一定要變成黑板，但它一定要看得到 runtime 的 read model。

---

## 4. Evaluation Interface

這是最重要的。

應用必須有固定評分函式，或至少能提供**固定評分所需的原始指標**。

也就是：

* 遊戲 sidecar：能不能生成可玩關卡、錯誤率、完成率、構建成功率
* Blog Village：完成率、回滾率、成本效率、成效變化
* 設計系統：交付率、審核通過率、返工率

沒有這個，Thyra 只能「治理流程」，不能「治理效果」。

---

## 5. Approval / Risk Interface

應用必須能接受：

* auto
* pending approval
* blocked
* rollback required

這代表 domain runtime 不是無條件執行。
它要能接收 Thyra 的風險裁決，並保留：

* stop
* cancel
* revert
* ask-human

---

## 6. Audit / Snapshot Interface

每次重要行動與結果都必須可寫回：

* audit log
* decision snapshot
* outcome summary
* evidence refs

這樣 Edda 才能真正長成判例層，而不是一般日誌層。

---

# 所以你可以有兩種接入模式

這裡是最實際的。

## A. Thyra-native App

新開發專案直接照公約做。

### 特徵

* 一開始就有 capability manifest
* 一開始就有 observe/read model
* 一開始就有 evaluator
* 一開始就有 risk/approval hooks
* 一開始就能寫 decision artifacts

### 適合誰

* 你自己之後做的新系統
* 願意跟你一起做 AI-native 應用的社群開發者
* 明確想做「治理優先」產品的人

### 這條路的價值

這會形成一種新的開發文化：

**不是先做功能，再想怎麼接 AI；而是從第一天就假設這個系統未來會被治理層調度。**

---

## B. Thyra-sidecar App

既有系統用 sidecar 接入。

### 特徵

sidecar 負責幾件事：

* 把亂的本地狀態抽成 read model
* 把原本零散的操作包成 capability
* 把應用自己的事件轉成標準 signals
* 補一層 evaluator
* 補一層 risk/approval/rollback hook

### 這條路很像你說的遊戲引擎 case

很多現成工具：

* 節點很多
* API 混亂
* 沒有 AI-friendly 資料結構
* 沒有固定評分
* 沒有審計與回放

這時候你不可能直接把 Thyra 接進去。
你要先做一個 sidecar，把它「治理化」。

---

# 我會把 sidecar 的角色定義得更清楚

不是單純 adapter。
而是：

## **治理轉接器**

它的任務是把一個原本不治理友善的系統，轉成 Thyra 能理解的 6 個介面。

所以 sidecar 不是只做：

* 呼叫 API
* 包裝 function

而是做：

### 1. State Extraction

抽出可觀測狀態

### 2. Action Wrapping

把應用操作封成 capability

### 3. Risk Gate Hook

把關鍵操作掛上 approval/rollback

### 4. Evaluator

定義固定裁判

### 5. Snapshot / Audit Hook

把重要狀態寫回 Thyra/Edda

---

# 所以你最終可能真的會發展出一個「雙層準則」

我會這樣命名：

## 層 1：Thyra Native Design Rules

給新應用

比如要求：

* 必須有 manifest
* 必須有 evaluator
* 必須有 bounded action set
* 必須能寫 snapshot
* 必須有 rollback semantics

## 層 2：Thyra Sidecar Retrofit Rules

給既有應用

比如要求：

* 必須先抽 read model
* 必須先定 capability wrapper
* 必須先補 evaluator
* 必須先標記 high-risk actions
* 必須先補 audit/snapshot bridge

---

# 你提到「國家 / 村莊規則」這件事，我覺得是成立的

因為如果你真的把這套公約做起來，Thyra 就不只是管理單一 app。

它會變成：

## Nation / Territory / Village 的治理層級模型

### Nation

全域憲法與原則

* 不可突破的風險邊界
* 全域預算政策
* 全域 approval policy
* 合規底線

### Territory

領域級規則

* 遊戲開發領域
* 內容營運領域
* 設計素材領域
* 數據分析領域

### Village

單一具體應用

* Blog Village
* Match3 Village
* Asset Village
* Report Village

這時候 Thyra 就真的不只是某個專案的 control plane，
而是：

**多領域 AI 治理 AI 應用的憲法層。**

這其實很大，而且很有辨識度。

---

# 但我也要講一個現實面

這件事很值得做，但**不能一開始就做成超大標準組織**。

比較對的順序是：

## 第一步

先做一份最小接入公約 v0.1

只定：

* manifest
* observe
* evaluate
* risk
* audit

## 第二步

做兩個 reference implementation

* 一個 Thyra-native
* 一個 Thyra-sidecar

例如：

* Blog Village = native
* 遊戲引擎 sidecar = retrofit

## 第三步

再從這兩個案例抽成更穩的 spec

這樣你不是在空中立法，
而是在真實案例中抽象。

---

# 我對這方向的整體看法

我覺得這件事比單做某個 app 更有長期價值。

因為你不是在做：

* 一個遊戲工具
* 一個內容工具
* 一個工作流工具

你在做的是：

## **讓不同領域的應用都能被治理層接管的接入方法**

這其實比 MCP 更高一層。
MCP 主要回答的是：

* 工具有哪些
* 怎麼呼叫

但你這套如果做出來，回答的是：

* 在什麼目標下呼叫
* 在什麼邊界下呼叫
* 什麼時候停
* 什麼叫變好
* 什麼叫高風險
* 怎麼留下判例

這不是單純 tool protocol，
而是**bounded autonomy protocol**。

---

# 我的結論

## 我非常看好這方向，而且我認為你應該正式把它命名出來

例如：

* Thyra Integration Contract
* Governed Runtime Contract
* Village Runtime Contract

先有名字，這件事才會從「想法」變成「可以被遵守的準則」。

## 我最建議你現在做的，不是再想更多領域

而是先定一版：

### 《Thyra Integration Contract v0.1》

內容只包含：

* 6 個必要介面
* Native 規則
* Sidecar 規則
* 兩個 reference app

這樣你就會開始從單一系統設計者，變成一個**治理型應用生態的規格制定者**。

如果你要，我下一則可以直接幫你把
**《Thyra Integration Contract v0.1》** 草案寫出來。


####

下面是我先幫你整理的草案版。
我先把它寫成**可討論、可切 v0.2、可拿去約束新專案與 sidecar**的格式。

---

# 《Thyra Integration Contract v0.1》草案

## 0. 目的

`Thyra Integration Contract` 是一份**接入公約**。
它定義任何應用如果想被 Thyra 治理，最少必須暴露哪些能力、遵守哪些邊界、提供哪些可觀測與可評估介面。

它不是單純的 tool API，也不是單純的 agent protocol。
它回答的是：

* Thyra 可以對這個應用下什麼層級的目標
* 這個應用必須如何回報狀態
* 什麼叫高風險、待審批、可回滾
* 什麼叫「變好」
* 決策與結果如何留下可追溯記錄

這份草案建立在你目前已經明確的三層分工上：**Thyra 管治理、Karvi 管執行、Edda 管記憶**；同時延續你已經採用的 **Versioned / JSON / Schema-first / 最小化** 原則。

---

## 1. 適用範圍

本公約支援兩種接入模式：

### A. Thyra-native

給**新開發的應用**。
從第一天起就依照 Thyra 的治理需求設計。

### B. Thyra-sidecar

給**既有應用**。
透過 sidecar / adapter / wrapper，把原本不 AI-friendly、不治理友善的系統轉成 Thyra 可接入的形狀。

---

## 2. 非目標

v0.1 明確**不處理**這些事情：

* 不定義完整 Nation / 國家級治理
* 不要求應用直接採用 Thyra 內部資料表
* 不要求應用直接使用 Karvi 作為執行引擎
* 不要求應用直接使用 Edda 作為唯一記憶系統
* 不規定 UI 形式
* 不處理多租戶與權限系統

這和你目前 Thyra 路線裡「先村莊、後領地、不做自有執行引擎、不做自有記憶」的策略一致。

---

## 3. 核心心智模型

```text
Human
  → Village Pack / Authoring Surface
  → Thyra Compiler / Governance Artifacts
  → Thyra Decision + Risk + Law Lifecycle
  → Domain Runtime / Sidecar / Adapter
  → Observe + Evaluate + Record
  → Human review / supersede / continue
```

更簡單地說：

* **人類**負責寫目標與規則
* **Thyra**負責 bounded decision
* **Domain Runtime** 負責真的做事
* **Evaluator** 負責固定裁判
* **Audit / Snapshot / Memory** 負責留下可比較記錄

Village Pack 現在已經明確是「單一人類設定入口 → domain-aware compiler → 現有模組 API」，而不是 ORM 表單；Constitution 仍然只能 supersede，不可 update。

---

## 4. 接入公約的 6 個必要介面

任何 Thyra 可治理應用，至少必須提供以下 6 類能力。

---

### 4.1 Goal Interface

應用必須能接收**高抽象目標**，而不是只接低階命令。

#### 最低要求

* 接收 `goal`
* 接收 `constraints`
* 接收 `budget`
* 接收 `approval policy`
* 接收 `evaluator config`

#### 範例

* Blog Village：每週穩定產出 2 篇文章
* Game Sidecar：生成一個 chapter-1 可玩關卡
* Report Village：產出本週異常分析摘要

---

### 4.2 Capability Manifest

應用必須清楚宣告「自己能做什麼」。

#### 最低要求

每個 capability 至少描述：

* `capability_key`
* `description`
* `input_schema`
* `output_schema`
* `estimated_cost`
* `risk_level`
* `required_skill`
* `rollback_supported`

#### 範例

* `research_topic`
* `draft_content`
* `build_level_payload`
* `assemble_demo_run`
* `publish_content`

這和 Karvi 現有把執行層責任放在 deliverable contract / tool tier gate 的方向一致：治理在 Thyra，執行契約仍由執行層持有。

---

### 4.3 Observe Interface

應用必須可被觀察，否則 Thyra 無法治理。

#### 最低要求

應用至少要能提供：

* `status`
* `progress`
* `recent_signals`
* `recent_failures`
* `outputs`
* `budget_usage`

Karvi 對 Thyra 暴露的 `GET /api/board`、`GET /api/status`、`GET /api/tasks/:id/progress`、`GET /api/events`，就是這種 observe surface 的典型例子。

---

### 4.4 Evaluation Interface

應用必須能被固定裁判評估。

#### 最低要求

必須具備以下其中一種：

1. 提供固定 `evaluate()` 實作
2. 提供固定 evaluator 所需的原始 metrics

#### 原則

* evaluator 寫在 code 裡
* AI 不可修改 evaluator 本體
* Thyra 只能提供 evaluator config，不能讓 AI 自改評分規則

這和你目前在 Decision Engine Phase 1.5 想做的 `CycleMetrics / DecideSnapshot / golden fixtures / replay` 完全一致。

---

### 4.5 Approval / Risk Interface

應用必須接受 Thyra 的風險與審批結果。

#### 最低要求

至少支援這幾種狀態：

* `auto`
* `pending_approval`
* `blocked`
* `rollback_required`

#### 必須可執行的控制

* `abort`
* `cancel`
* `rollback` 或等價的 recover 行為
* `ask_human`

這和 Thyra 目前的 RiskAssessor hard invariants 一致：必須有 reason、必須可回滾、人類永遠可停止、成本不能越界。

---

### 4.6 Audit / Snapshot Interface

每次重要行動都必須能留下治理記錄。

#### 最低要求

至少能寫回：

* `audit_event`
* `decision_snapshot`
* `outcome_summary`
* `evidence_refs`
* `engine_version`

Decision Engine v0.2 已經明確定義了 `DecideSnapshot` 與 `CycleMetrics`，這正是未來做 engine version compare 的基礎。

---

## 5. 最小資料契約（建議版）

下面是 v0.1 建議的最小 shape，不要求一字不差，但語義要對齊。

---

### 5.1 GoalEnvelope

```ts
interface GoalEnvelope {
  goal_id: string;
  domain: string;                  // blog | game | report | design ...
  objective: string;
  constraints: Record<string, unknown>;
  budget: {
    max_cost_per_action?: number;
    max_cost_per_loop?: number;
    max_cost_per_day?: number;
  };
  approval_policy: {
    medium_risk_requires_human: boolean;
    high_risk_requires_human: boolean;
  };
  evaluator_config?: Record<string, unknown>;
}
```

---

### 5.2 CapabilityManifest

```ts
interface CapabilityManifest {
  runtime_id: string;
  runtime_version: string;
  capabilities: CapabilitySpec[];
}

interface CapabilitySpec {
  capability_key: string;
  description: string;
  input_schema_ref: string;
  output_schema_ref: string;
  estimated_cost: number;
  risk_level: 'low' | 'medium' | 'high';
  required_skill?: string;
  rollback_supported: boolean;
}
```

---

### 5.3 ObserveSnapshot

```ts
interface ObserveSnapshot {
  runtime_id: string;
  status: 'idle' | 'running' | 'blocked' | 'failed' | 'waiting_approval';
  progress?: number;
  recent_signals: Array<{
    kind: string;
    message: string;
    at: string;
  }>;
  outputs?: Record<string, unknown>;
  budget_usage?: {
    current_loop?: number;
    current_day?: number;
  };
}
```

---

### 5.4 EvaluationResult

```ts
interface EvaluationResult {
  evaluator_version: string;
  score: number;
  metrics: Record<string, number>;
  summary: string;
}
```

---

### 5.5 GovernanceDecisionRecord

```ts
interface GovernanceDecisionRecord {
  decision_id: string;
  goal_id: string;
  engine_version: string;
  chosen_capability?: string;
  status: 'auto' | 'pending_approval' | 'blocked' | 'executed' | 'rolled_back';
  reasoning_summary: string;
  evidence_refs: string[];
  timestamp: string;
}
```

---

## 6. Thyra-native 規則

新應用若要標榜自己是 **Thyra-native**，至少要滿足：

### 必備

* 有 Capability Manifest
* 有 Observe Interface
* 有固定 Evaluation Interface
* 有 Risk / Approval hooks
* 有 Audit / Snapshot hooks
* 所有重要 action 都有 rollback semantics 或明確不可回滾說明

### 建議

* 使用 versioned JSON schema
* 將 human authoring 與 runtime config 分離
* 將 high-risk capability 明確標記
* 將 evaluator 與 runtime 邏輯分離

---

## 7. Thyra-sidecar 規則

既有應用若要透過 sidecar 接入，至少要補這 5 件事：

### 7.1 State Extraction

把原本混亂狀態抽成可讀 ObserveSnapshot。

### 7.2 Action Wrapping

把原本零散操作封成 Capability Manifest。

### 7.3 Risk Gate Hook

在高風險操作前插入 approval / rollback / abort。

### 7.4 Fixed Evaluator

補一個固定 evaluator 或固定 metrics pipeline。

### 7.5 Audit Bridge

把重要決策、操作與結果寫回 Thyra / Edda 可讀的紀錄格式。

這正是你 sidecar 專案的價值所在：把一個原本不治理友善的系統，包成 agentic runtime 可接入層。sidecar 目前已經有 blackboard、IR、Karvi planner/executor、tools、adapters 這些平台骨架，但最缺的是把其中一條 runtime 主線真正跑通。

---

## 8. 與現有 Thyra / Karvi / Edda 的對應

### Thyra

負責：

* Goal interpretation
* Constitution / Law / Chief
* Decision / Risk / Approval
* Compile / supersede / lifecycle
* Evaluation orchestration
* Audit / snapshot orchestration

### Karvi

負責：

* Task / project dispatch
* Progress / status / signals
* Deliverable contract
* Tool tier gate
* Runtime execution

### Edda

負責：

* Decision precedent
* Outcome memory
* Similar-case retrieval
* Case law / postmortem

這個分工和你 three-repo architecture 文件裡的責任切分是一致的。

---

## 9. v0.1 合規等級

我建議 v0.1 先做三個等級。

### Level A — Observable

* 有 Capability Manifest
* 有 Observe Interface
* 有 basic audit

### Level B — Governable

* Level A 全部滿足
* 有固定 evaluator
* 有 risk / approval hooks
* 有 rollback / cancel 語義

### Level C — Thyra-native

* Level B 全部滿足
* human authoring 可經由 single entry compile
* versioned contracts 完整
* decision snapshot / metrics 完整
* 可支援 engine version compare / replay

---

## 10. 兩個參考實作

### Reference App 1 — Blog Village（Thyra-native）

* Human 透過 `village.yaml`
* Village Pack compile 成 Constitution / Chief / Laws / Skills
* evaluateVillage() 固定
* DecideSnapshot / CycleMetrics 可回放與比較
  這與你目前的 Village Pack 與 Decision Engine 規格直接對齊。

### Reference App 2 — Game Engine Sidecar（Thyra-sidecar）

* 既有引擎 / runtime 不改核心
* sidecar 提供 manifest / observe / evaluator / audit bridge
* Thyra 從高抽象 goal 下到 sidecar
* sidecar 再對接 domain runtime

---

## 11. 建議的 v0.2 討論題

這份草案之後，我覺得最值得討論的 5 個問題是：

1. `GoalEnvelope.domain` 要不要做 namespace
2. evaluator config 允許調到什麼程度
3. Capability risk level 是 runtime 自報還是 Thyra override
4. Snapshot 與 audit 的最小必填欄位
5. Sidecar 要不要強制 expose health/discovery endpoint

---

## 12. 一句話收尾

**`Thyra Integration Contract v0.1` 的本質，不是定義工具怎麼被呼叫，而是定義一個應用怎麼變成「可被治理、可被評分、可被審批、可被留下判例」的自治單元。**

如果你要，我下一則就接著把它收斂成更正式的 spec 版，像這樣：

* `Motivation`
* `Terminology`
* `Required Interfaces`
* `Conformance Levels`
* `Reference Implementations`
* `Open Questions`

這樣就更像一份真的可以發出去給社群看的草案。


######


下面是我幫你收斂成比較正式、可發佈討論的版本。

---

# Thyra Integration Contract v0.1-draft

**狀態**：Draft
**目的**：定義一個應用或 sidecar 若要被 Thyra 治理，最少必須暴露哪些能力、遵守哪些邊界、提供哪些可觀測/可評估/可審計介面。
**設計基礎**：沿用三 repo 的契約原則：**Versioned、JSON、Schema-first、最小化**。

## 1. Motivation

Thyra 的角色不是執行引擎，而是治理層：它管理 village、constitution、chief、law、risk、loop 與 dashboard；Karvi 負責執行與 step 契約，Edda 負責決策記憶與查詢。三 repo 之間已經隱含了跨層治理需求，但目前只對 Thyra/Karvi/Edda 內部切分說得清楚，還沒有對「外部應用如何接入」形成正式公約。

Village Pack v0.1 已經把「單一人類設定入口 → compiler → 既有 lifecycle API」這件事講清楚，而且明確保留 immutability：Constitution 只能 supersede，Law 只能 propose/revoke/replace，Skill 只做 verified binding。這使得「單一 authoring surface」已經有實作方向，現在適合再往上一層收斂成接入規格。

## 2. Scope

本規格只定義 **治理接入契約**。
它不規定應用必須採用哪個 UI、哪種資料庫、哪個執行框架，也不要求應用直接採用 Thyra 的內部資料表。它只規定一個應用要如何成為「可被 Thyra 治理的自治單元」。這與 three-repo 架構中「Thyra owns loop / governance、Karvi owns execution、Edda owns memory」的切分一致。

### 2.1 In Scope

* 高抽象目標如何送入 domain runtime
* domain runtime 必須公開哪些 capability / observe / evaluate / audit 介面
* 如何表達 risk / approval / rollback
* 如何形成可比較的 decision / outcome 記錄

### 2.2 Out of Scope

* Nation / Territory 的完整治理層級
* 多租戶權限系統
* UI 樣式
* 特定執行引擎綁定
* LLM provider / prompt 細節
* 內部 DB schema 實作

## 3. Terminology

### 3.1 Thyra

治理層。負責 village、constitution、chief、law、risk、loop、dashboard，以及 bounded autonomy 的決策與審批。

### 3.2 Karvi

執行層。負責 task/project dispatch、progress/status/signals、deliverable contract、tool tier gate，以及事件流。

### 3.3 Edda

決策記憶層。負責 append-only ledger、決策查詢、draft/approve/reject、post-mortem、通知與決策依賴。

### 3.4 Village

Thyra 中的一個自治域。對應一個明確目標與邊界，例如 Blog Village。Village Pack 現在就是以 village 為 authoring 單位。

### 3.5 Capability

某個 runtime 可被 Thyra 調用的明確能力。它必須有清楚的 input/output、風險、成本與回滾語義。

### 3.6 Evaluator

固定裁判。它負責把一輪或多輪運作結果轉成可比較分數或固定指標。它必須由程式碼固定，不可由 AI 自改。Decision Engine v0.2 已經為 replay / snapshot / metrics 做好基礎。

### 3.7 Sidecar

給既有應用的治理轉接層。它把原本不治理友善的系統，轉成符合本規格的 capability / observe / evaluate / audit 介面。你的遊戲 sidecar repo已經有 shared/ir/karvi/blackboard/tools/adapters/systems 的平台骨架，但黑板與部分 adapter 仍未實作完整。

## 4. Design Principles

1. **Bounded autonomy first**
   Thyra 可以決策，但不能自我授權突破 Constitution、RiskAssessor 或 approval policy。RiskAssessor 目前已有 7 個 safety invariants，包含 human stop、reason、rollback、cost 等硬限制。

2. **Single authoring surface, modular runtime**
   人類可以透過單一入口（如 Village Pack）設定，但底層仍維持 constitution/chief/law/skill 等模組分離。Village Pack 已明確採取這個方向。

3. **Schema-first and versioned**
   所有跨層契約都應帶版本號，採 JSON / schema-first，不破壞向後相容。`governance.decision.v1` 已經是一個現成例子。

4. **Evaluation is mandatory**
   沒有固定裁判，就沒有自治改進的比較基礎。

5. **Observability before optimization**
   在導入 LLM、SSE 或 planner 之前，必須先有 observe、snapshot、metrics、replay。

## 5. Conformance Levels

### Level A — Observable

一個 runtime 若要宣稱 Level A，必須：

* 提供 Capability Manifest
* 提供 Observe Interface
* 提供 basic audit / outcome 回報

### Level B — Governable

在 Level A 之上，還必須：

* 提供固定 Evaluation Interface
* 接受 Thyra 的 risk / approval 狀態
* 支援 abort / cancel / rollback 或明確聲明不可回滾

### Level C — Thyra-native

在 Level B 之上，還必須：

* 提供 single authoring surface 或等價 compile layer
* 提供 versioned decision snapshot / metrics
* 支援 replay / engine version compare
* 將 high-risk capability 明確標記並對接審批流程

## 6. Required Interfaces

本節是 v0.1 的核心。

### 6.1 Goal Interface

runtime **必須**能接收高抽象目標，而非只接收低階命令。

#### Required fields

* `goal_id`
* `domain`
* `objective`
* `constraints`
* `budget`
* `approval_policy`
* `evaluator_config`（optional but recommended）

#### Recommended shape

```ts id="8e5fum"
interface GoalEnvelope {
  goal_id: string;
  domain: string;
  objective: string;
  constraints: Record<string, unknown>;
  budget: {
    max_cost_per_action?: number;
    max_cost_per_loop?: number;
    max_cost_per_day?: number;
  };
  approval_policy: {
    medium_risk_requires_human: boolean;
    high_risk_requires_human: boolean;
  };
  evaluator_config?: Record<string, unknown>;
}
```

### 6.2 Capability Manifest

runtime **必須**清楚宣告可被治理層使用的能力。

#### Required fields per capability

* `capability_key`
* `description`
* `input_schema_ref`
* `output_schema_ref`
* `estimated_cost`
* `risk_level`
* `rollback_supported`

#### Recommended shape

```ts id="6nqlnp"
interface CapabilityManifest {
  runtime_id: string;
  runtime_version: string;
  capabilities: CapabilitySpec[];
}

interface CapabilitySpec {
  capability_key: string;
  description: string;
  input_schema_ref: string;
  output_schema_ref: string;
  estimated_cost: number;
  risk_level: 'low' | 'medium' | 'high';
  required_skill?: string;
  rollback_supported: boolean;
}
```

這個設計與 Karvi 的 deliverable contract、tool tier gate 分工一致：治理層負責「何時、為何、能否做」，執行層負責「怎麼做」。

### 6.3 Observe Interface

runtime **必須**可被觀察。Thyra 不一定要變成黑板，但必須能讀到 runtime 的 read model。

#### Required fields

* `status`
* `progress`
* `recent_signals`
* `recent_failures`
* `outputs`
* `budget_usage`

#### Recommended shape

```ts id="i2jtbs"
interface ObserveSnapshot {
  runtime_id: string;
  status: 'idle' | 'running' | 'blocked' | 'failed' | 'waiting_approval';
  progress?: number;
  recent_signals: Array<{
    kind: string;
    message: string;
    at: string;
  }>;
  outputs?: Record<string, unknown>;
  budget_usage?: {
    current_loop?: number;
    current_day?: number;
  };
}
```

Karvi 現有對 Thyra 暴露的 `/api/status`、`/api/events`、webhook 與進度查詢，就是這類 observe interface 的基礎；但現在 observe path 仍比 command path 弱。

### 6.4 Evaluation Interface

runtime **必須**能被固定裁判評估。

#### Requirements

* evaluator 本體由 code 定義
* evaluator config 可由 human authoring layer 提供
* AI 不可修改 evaluator 本體
* 至少提供 `score` 或固定 metrics 集

#### Recommended shape

```ts id="36j6bl"
interface EvaluationResult {
  evaluator_version: string;
  score: number;
  metrics: Record<string, number>;
  summary: string;
}
```

### 6.5 Approval / Risk Interface

runtime **必須**接受 Thyra 的治理裁決。

#### Required states

* `auto`
* `pending_approval`
* `blocked`
* `rollback_required`

#### Required controls

* `abort`
* `cancel`
* `rollback`（或等價 recover）
* `ask_human`

這點與 RiskAssessor 的現有安全不變式直接對齊。

### 6.6 Audit / Snapshot Interface

runtime **必須**能留下決策與結果的可比較記錄。

#### Required fields

* `decision_id`
* `goal_id`
* `engine_version`
* `chosen_capability`
* `status`
* `reasoning_summary`
* `evidence_refs`
* `timestamp`

#### Recommended shape

```ts id="6i06lm"
interface GovernanceDecisionRecord {
  decision_id: string;
  goal_id: string;
  engine_version: string;
  chosen_capability?: string;
  status: 'auto' | 'pending_approval' | 'blocked' | 'executed' | 'rolled_back';
  reasoning_summary: string;
  evidence_refs: string[];
  timestamp: string;
}
```

`governance.decision.v1` 已經證明 versioned governance record 在 Thyra/Edda 間是自然的契約方向。

## 7. Native Conformance

一個新應用若要宣稱自己是 **Thyra-native**，除了符合第 6 節全部介面外，還應滿足：

* authoring surface 與 runtime config 分離
* high-risk capability 明確標記
* 所有重要 action 有 rollback 或 no-rollback 聲明
* 可由 compile layer 生成或更新治理 artefacts
* 與 Thyra 契約採 versioned JSON schema

Village Pack 與 Thyra 的現有 constitution/chief/law lifecycle 已經提供了這種 native path 的第一個參考。

## 8. Sidecar Conformance

既有應用若要透過 sidecar 接入，sidecar **至少**要補齊：

1. **State Extraction**
   把原本零散或非結構化狀態抽成 ObserveSnapshot。

2. **Action Wrapping**
   把原本操作封裝成 Capability Manifest。

3. **Risk Gate Hook**
   在高風險操作前接 Thyra 的 approval / rollback / abort。

4. **Fixed Evaluator**
   補一個固定 evaluator 或固定 metrics pipeline。

5. **Audit Bridge**
   把 decision / outcome / trace 回寫給 Thyra / Edda。

你的遊戲 sidecar repo已經很接近一個 sidecar 平台骨架，但目前 blackboard store 與部分 adapter 仍是 `Not implemented`，所以它更像「可演進為 sidecar contract 參考實作」而不是完成版。

## 9. Compile and Immutability Semantics

如果某個接入實作採用 single authoring surface（如 Village Pack），它 **必須**尊重底層 lifecycle semantics，而不是直接 update row。

### Required semantics

* Constitution change → **supersede**, never update
* Law strategy change → **revoke + propose**, never update
* Skill list → **bind/unbind verified skills only**
* Chief permissions → **must be subset of constitution.allowed_permissions**

Village Pack v0.1 已經把這些 compile 規則寫得很清楚，這可直接作為本規格的 reference semantics。

## 10. Reference Implementations

### 10.1 Reference A — Blog Village

型別：Thyra-native
入口：`village.yaml`
編譯：Village Pack compiler
治理物件：constitution / chief / laws / skills / evaluator config
裁判：固定 `evaluateVillage()`
記錄：DecideSnapshot / CycleMetrics / audit / Edda
這與現在的 Village Pack、Decision Engine、LoopRunner 路線直接對齊。

### 10.2 Reference B — Game Engine Sidecar

型別：Thyra-sidecar
入口：結構化 game spec
轉接層：shared / ir / blackboard / tools / adapters
輸出：可被 Thyra 調用的 capability、可被讀取的 observe state、固定 evaluator、decision/audit bridge
目前適合作為 retrofit 參考，而不是完成標準件。

## 11. Compliance Checklist

一個 runtime 在宣稱自己符合 TIC v0.1 前，應能回答以下問題：

* 我是否能接收高抽象 goal，而不是只接低階命令？
* 我是否能清楚宣告所有 capability？
* 我是否能提供固定 observe snapshot？
* 我是否有固定 evaluator 或固定 metrics？
* 我是否接受 pending_approval / blocked / rollback_required？
* 我是否能寫出可比較的 decision / outcome 記錄？
* 若採 single authoring surface，我是否尊重 immutability lifecycle？

## 12. Open Questions for v0.2

這份 v0.1 還有幾個值得下一輪討論的點：

1. `domain` 要不要 namespace 化，例如 `content/blog`、`game/match3`
2. evaluator_config 的可變範圍到哪裡為止
3. capability 的 risk level 由 runtime 自報，還是 Thyra 可 override
4. audit record 與 decision snapshot 的最低必填欄位
5. 是否要求 sidecar 一定提供 discovery/health endpoint
6. 是否需要正式定義：

   * `governance.patch.v1`
   * `governance.policy.v1`
   * `governance.metric.v1`
   * `governance.decision.v1`
     three-repo 規劃已明確列出這些待定義契約方向。

## 13. Summary

**Thyra Integration Contract v0.1** 不是在定義「工具怎麼被呼叫」，而是在定義「一個應用怎麼變成可被治理、可被評分、可被審批、可留下判例的自治單元」。
它同時支援：

* 新應用走 **Thyra-native**
* 舊應用走 **Thyra-sidecar retrofit**

而它的最小成功標準，不是漂亮的 API，而是能讓 Thyra 真的對外部 runtime 做到：

**給目標 → 看狀態 → 判風險 → 執行 → 打分 → 留記錄 → 下輪變更更有根據。**

如果你要，我下一步會建議直接把這份再壓成兩個配套文件：
**`tic-v0.1-checklist.md`** 和 **`tic-v0.1-example-blog-village.md`**。
