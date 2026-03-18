# volva-working-state-schema-v0.md

> 狀態：`working draft`
>
> 目的：把 Völva 的 **working decision state** 從概念描述壓成可落地的資料結構。
>
> 這份文件不處理：
> - 長期 precedent（那是 Edda）
> - reviewable spec docs（那是 Git-backed docs）
> - live runtime world state（那是 Thyra runtime）
>
> 它只回答：
>
> > **在聊天還在進行、意圖還在收斂、candidate 還在生成與篩選時，Völva 應該把哪些狀態持久化？**

---

## 1. 一句話

> **Völva 的 working state 是 decision-in-motion 的工作記憶。**
>
> 它要能跨回合續接、被局部 patch、被升格成 spec，但不應被誤當成最終設計真相。

---

## 2. 設計原則

### 原則 1：先支援續接，不先追求完全正規化
v0 先讓 router / path-check / candidate / probe 能穩定續接。

### 原則 2：current snapshot + append-only event 雙軌
- snapshot 用來快速恢復當前狀態
- event 用來保留重要 transition

### 原則 3：card 是 UX 單位，session 是狀態單位
一個 session 可有多張 card；decision state 不應綁死在單一卡片上。

### 原則 4：working state 可改，但重要 transition 要留痕
例如：
- regime 改判
- candidate 被 prune / commit
- promotion check verdict 改變

### 原則 5：ID 穩定比 schema 完美更重要
之後不管升格到 spec 或寫進 Edda，都需要穩定 object ids。

---

## 3. 核心資料模型

### 3.1 DecisionSession

```ts
type DecisionSession = {
  id: string;                    // ds_...
  conversationId?: string;       // 對應聊天 thread/session
  userId?: string;
  title?: string;

  primaryRegime?: Regime;
  secondaryRegimes?: Regime[];
  routingConfidence?: number;    // 0-1

  pathCertainty?: "low" | "medium" | "high";
  routeDecision?: "space-builder" | "space-builder-then-forge" | "forge-fast-path";

  stage:
    | "routing"
    | "path-check"
    | "space-building"
    | "probe-design"
    | "probe-review"
    | "commit-review"
    | "spec-crystallization"
    | "promotion-check"
    | "done";

  status: "active" | "paused" | "promoted" | "archived";

  keyUnknowns: string[];
  currentSummary?: string;

  createdAt: string;
  updatedAt: string;
};
```

### 3.2 CardSnapshot

```ts
type CardSnapshot = {
  id: string;                    // card_...
  sessionId: string;
  kind: "world" | "workflow" | "task" | "decision";
  version: number;

  summary: string;
  payload: Record<string, unknown>;

  isCurrent: boolean;
  createdAt: string;
};
```

### 3.3 CandidateRecord

```ts
type CandidateRecord = {
  id: string;                    // cand_...
  sessionId: string;
  regime: Regime;

  form:
    | "service"
    | "productized_service"
    | "tool"
    | "workflow_pack"
    | "learning_path"
    | "practice_loop"
    | "medium"
    | "world"
    | "operator_model"
    | "community_format";

  domain?: string;
  vehicle?: string;
  worldForm?: string;

  description: string;
  whyThisExists: string[];
  assumptions: string[];

  status:
    | "generated"
    | "pruned"
    | "probe-ready"
    | "probing"
    | "hold"
    | "committed"
    | "discarded";

  personFit?: "low" | "medium" | "high";
  testability?: "low" | "medium" | "high";
  leveragePotential?: "low" | "medium" | "high";

  createdAt: string;
  updatedAt: string;
};
```

### 3.4 ProbeRecord

```ts
type ProbeRecord = {
  id: string;                    // probe_...
  sessionId: string;
  candidateId: string;
  regime: Regime;

  hypothesis: string;
  judge: string;
  probeForm: string;
  cheapestBelievableProbe: string;
  disconfirmers: string[];

  budgetBucket?: "signal" | "setup" | "fulfillment" | "reserve";
  estimatedCost?: number;

  status: "draft" | "running" | "completed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
};
```

### 3.5 SignalPacket

```ts
type SignalPacket = {
  id: string;                    // sig_...
  probeId: string;
  candidateId: string;
  regime: Regime;

  signalType: string;
  strength: "weak" | "moderate" | "strong";
  evidence: string[];
  negativeEvidence?: string[];
  interpretation: string;
  nextQuestions: string[];

  createdAt: string;
};
```

### 3.6 CommitMemoDraft

```ts
type CommitMemoDraft = {
  id: string;                    // commit_...
  sessionId: string;
  candidateId: string;
  regime: Regime;

  verdict: "commit" | "hold" | "discard";
  rationale: string[];
  evidenceUsed: string[];
  unresolvedRisks: string[];
  recommendedNextStep: string[];
  handoffNotes?: string[];

  createdAt: string;
};
```

### 3.7 PromotionCheckDraft

```ts
type PromotionCheckDraft = {
  id: string;                    // promo_...
  sessionId: string;
  targetType: "arch-spec" | "project-plan" | "thyra-runtime";
  targetPath?: string;

  checklistResults: Record<string, boolean>;
  blockers: string[];
  verdict: "ready" | "not_ready" | "partial";
  notes?: string[];

  createdAt: string;
};
```

---

## 4. 支援型別

```ts
type Regime =
  | "economic"
  | "capability"
  | "leverage"
  | "expression"
  | "governance"
  | "identity";
```

---

## 5. 最小資料表建議

### decision_sessions
- `id` PK
- `conversation_id`
- `user_id`
- `title`
- `primary_regime`
- `secondary_regimes_json`
- `routing_confidence`
- `path_certainty`
- `route_decision`
- `stage`
- `status`
- `key_unknowns_json`
- `current_summary`
- `created_at`
- `updated_at`

### card_snapshots
- `id` PK
- `session_id` FK
- `kind`
- `version`
- `summary`
- `payload_json`
- `is_current`
- `created_at`

### candidate_records
- `id` PK
- `session_id` FK
- `regime`
- `form`
- `domain`
- `vehicle`
- `world_form`
- `description`
- `why_exists_json`
- `assumptions_json`
- `status`
- `person_fit`
- `testability`
- `leverage_potential`
- `created_at`
- `updated_at`

### probe_records
- `id` PK
- `session_id` FK
- `candidate_id` FK
- `regime`
- `hypothesis`
- `judge`
- `probe_form`
- `cheapest_probe`
- `disconfirmers_json`
- `budget_bucket`
- `estimated_cost`
- `status`
- `started_at`
- `completed_at`

### signal_packets
- `id` PK
- `probe_id` FK
- `candidate_id` FK
- `regime`
- `signal_type`
- `strength`
- `evidence_json`
- `negative_evidence_json`
- `interpretation`
- `next_questions_json`
- `created_at`

### commit_memo_drafts
- `id` PK
- `session_id` FK
- `candidate_id` FK
- `regime`
- `verdict`
- `rationale_json`
- `evidence_used_json`
- `unresolved_risks_json`
- `recommended_next_step_json`
- `handoff_notes_json`
- `created_at`

### promotion_check_drafts
- `id` PK
- `session_id` FK
- `target_type`
- `target_path`
- `checklist_results_json`
- `blockers_json`
- `verdict`
- `notes_json`
- `created_at`

---

## 6. Append-only event log

除了 current snapshot tables，建議再有一張事件表：

### decision_events

```ts
type DecisionEvent = {
  id: string;                    // evt_...
  sessionId: string;
  eventType:
    | "route_assigned"
    | "route_changed"
    | "path_checked"
    | "candidate_generated"
    | "candidate_pruned"
    | "probe_started"
    | "probe_completed"
    | "signal_recorded"
    | "commit_drafted"
    | "promotion_checked"
    | "spec_crystallized";

  objectType: "session" | "card" | "candidate" | "probe" | "signal" | "commit" | "promotion";
  objectId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

### 為什麼需要 event log
- current tables 適合恢復當前狀態
- event log 適合追蹤 transition
- 之後寫入 Edda 也更容易抽取重要事件

---

## 7. 讀寫模式

### 高頻更新：DecisionSession / CardSnapshot / CandidateRecord
每輪對話都可能更新。

### 中頻更新：ProbeRecord / SignalPacket / CommitMemoDraft
只在進 probe 與 review 時更新。

### 低頻更新：PromotionCheckDraft
只在升格前後出現。

### append-only：DecisionEvent
重要 transition 一律 append。

---

## 8. Working state 與 spec 的邊界

### L1 working state 適合放
- 還在變的 regime 判定
- 還沒選定的 candidates
- 草稿級 probe
- still-in-motion 的 unknowns

### 不適合直接放成 spec 的
- 每輪 follow-up 問題
- 暫時性的 ranking
- 還沒穩定的命名試驗

### 何時升成 spec
當某塊狀態已經：
- 名字穩定
- 可被 review
- 值得被人直接 patch
- 對後續 planning / runtime 有交接價值

---

## 9. 與 `decision-state-storage.md` 的關係

- 這份文件只定 L1：Völva working state
- L2 spec / L3 plan / L4 runtime / L5 precedent 的拓樸，見 `decision-state-storage.md` 與 `storage-topology-v0.md`

---

## 10. v0 不做什麼

- 不先做完美 normalized schema
- 不把 spec docs 直接鏡像進 DB
- 不在 Völva DB 裡放 Thyra runtime state
- 不把所有 event 都自動寫入 Edda
- 不做跨 repo 強一致同步

---

## 11. 最後一句

> **Völva 的 working state 應該像「決策工作記憶」：可續接、可 patch、可升格，但不假裝自己就是最終真相。**
>
> 它的任務不是永久保存一切，而是把 still-in-motion 的 decision state 穩定托住，直到那些狀態成熟到值得被 crystallize 成 spec，或被摘要成 precedent。
