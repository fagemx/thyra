# shared-types.md

> 狀態：`canonical`
>
> 目的：所有跨文件共用型別的 **single source of truth**。
>
> 規則：
> - 其他文件引用型別時，引用這份，不重新定義
> - 如果某個型別只在一份文件內部使用，不需要放這裡
> - 修改這份文件等同修改架構契約

---

## 1. 基礎型別

### 1.1 Regime

```ts
type Regime =
  | "economic"
  | "capability"
  | "leverage"
  | "expression"
  | "governance"
  | "identity";
```

6 個 regime，不多不少。v0 不再新增。

---

### 1.2 API Response Envelope（THY-11）

所有 Thyra API 統一使用：

```ts
// 成功
{ ok: true, data: T }

// 失敗
{ ok: false, error: { code: string, message: string } }
```

不使用 `{ error: { code, message, details } }` 格式。

---

## 2. Intent Router 層

### 2.1 IntentRoute

Router 的唯一輸出型別。

```ts
type IntentRoute = {
  primaryRegime: Regime;
  secondaryRegimes?: Regime[];

  confidence: number; // 0-1
  signals: string[];
  rationale: string[];

  keyUnknowns: string[];
  suggestedFollowups: string[];
};
```

注意：
- 用 `primaryRegime` 不用 `regime`
- 用 `keyUnknowns` 不用 `missingFields`
- **不含 `likelyNextStep`** — 那是 path-check 的責任

---

## 3. Path Check 層

### 3.1 PathCheckResult

```ts
type PathCheckResult = {
  certainty: "low" | "medium" | "high";
  route: "space-builder" | "forge-fast-path" | "space-builder-then-forge";

  fixedElements: FixedElement[];
  unresolvedElements: UnresolvedElement[];
  whyNotReady?: string[];
  whyReady?: string[];

  recommendedNextStep: string;
};

type FixedElement = {
  kind: "intent" | "domain" | "form" | "buyer" | "loop" | "build_target";
  value: string;
};

type UnresolvedElement = {
  kind: "domain" | "form" | "buyer" | "loop" | "build_target" | "signal";
  reason: string;
  severity: "blocking" | "important" | "nice_to_have";
};
```

注意：
- 3 種 route，不是 2 種（`space-builder-then-forge` 是常見中間態）
- `fixedElements` / `unresolvedElements` 是結構化物件，不是 `string[]`

---

## 4. Space Builder 層

### 4.1 RealizationCandidate

Space Builder 的輸出。也是 probe-commit 層的輸入。

```ts
type RealizationCandidate = {
  id: string;
  regime: Regime;

  form: RealizationForm;
  domain?: string;
  vehicle?: string;
  worldForm?: WorldForm;

  description: string;
  whyThisCandidate: string[];
  assumptions: string[];

  probeReadinessHints?: string[];
  timeToSignal: "short" | "medium" | "long";
  notes: string[];
};

type RealizationForm =
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

type WorldForm =
  | "market"
  | "commons"
  | "town"
  | "port"
  | "night_engine"
  | "managed_knowledge_field";
```

注意：
- 通用 candidate 的 `form` 是 `RealizationForm`（10 值）
- governance regime 進一步用 `worldForm` 指定具體 world 類型（`WorldForm`，6 值）
- 不再有獨立的 `CandidateInput` 型別 — 直接用 `RealizationCandidate`
- 不含 `personFit: number` / `testability: number` 等數值分數（v0 用結構化 verdict，不用 0-100 分數）

### 4.2 GovernanceWorldCandidate（governance regime 特化）

```ts
type GovernanceWorldCandidate = RealizationCandidate & {
  worldForm: WorldForm; // 必填（不是 optional）
  stateDensity: "low" | "medium" | "high";
  changeClarity: "low" | "medium" | "high";
  governancePressure: "low" | "medium" | "high";
  outcomeVisibility: "low" | "medium" | "high";
  cycleability: "low" | "medium" | "high";
  likelyMinimumWorldShape: string[];
  mainRisks: string[];
};
```

注意：density/clarity 等改用 3 級字串，不用 `number`，和 v0 不做數值分數的原則一致。

---

## 5. Probe-Commit 層

### 5.1 ProbeableForm

Shell 必做的轉換。所有 regime 共用骨架。

```ts
type ProbeableForm = {
  candidateId: string;
  regime: Regime;

  hypothesis: string;
  testTarget: string;
  judge: string;
  cheapestBelievableProbe: string;
  disconfirmers: string[];
};
```

### 5.2 SignalPacket

Probe 跑完後的標準化輸出。

```ts
type SignalPacket = {
  candidateId: string;
  probeId: string;
  regime: Regime;

  signalType: string; // regime-specific，不做 union enum
  strength: "weak" | "moderate" | "strong";
  evidence: string[];
  negativeEvidence?: string[];
  interpretation: string;
  nextQuestions: string[]; // 複數
};
```

注意：
- `signalType` 是 `string`，因為不同 regime 的 signal 類型完全不同
- 用 `nextQuestions`（複數），不用 `nextQuestion`

### 5.3 EvaluatorOutput

每個 regime-specific evaluator 的輸出。

```ts
type EvaluatorOutput = {
  verdict: "commit" | "hold" | "discard";
  rationale: string[];
  evidenceUsed: string[];
  unresolvedRisks: string[];
  recommendedNextStep: string[];
  handoffNotes?: string[];
};
```

### 5.4 EvaluatorInput

```ts
type EvaluatorInput = {
  candidate: RealizationCandidate;
  probeableForm: ProbeableForm;
  signals: SignalPacket[];
  context?: Record<string, unknown>;
};
```

### 5.5 CommitMemo

最終交給 Forge 的決策包。由 shell 從 EvaluatorOutput 組合而成。

```ts
type CommitMemo = {
  candidateId: string;
  regime: Regime;
  verdict: "commit" | "hold" | "discard";

  rationale: string[];
  evidenceUsed: string[];
  unresolvedRisks: string[];

  whatForgeShouldBuild: string[];
  whatForgeMustNotBuild: string[];

  recommendedNextStep: string[];
};
```

注意：
- 用 `whatForgeMustNotBuild`（統一命名），不用 `whatForgeMustNotAssume` 或 `whatForgeMustNotBuildYet`
- 不再有獨立的 `ProbeDecision` 型別 — `CommitMemo` 就是最終決策輸出

### 5.6 EconomicCommitMemo（economic regime 特化）

```ts
type EconomicCommitMemo = CommitMemo & {
  buyerHypothesis: string;
  painHypothesis: string;
  paymentEvidence: string[];
  whyThisVehicleNow: string[];
  nextSignalAfterBuild: string[];
};
```

---

## 6. Canonical Cycle 層（World Governance）

### 6.1 WorldMode

世界的整體生命週期狀態。

```ts
type WorldMode =
  | "setup"
  | "open"
  | "peak"
  | "managed"
  | "cooldown"
  | "closed";
```

注意：
- 6 個離散值，不使用 compound string（如 `"peak / unstable"`）
- 如果需要 sub-qualifier，用獨立欄位（如 `stability: "stable" | "unstable"`），不混進 mode

### 6.2 CycleMode

從 WorldMode 派生的 cycle 判斷上下文。

```ts
type CycleMode =
  | "normal"    // WorldMode: setup | open | managed
  | "peak"      // WorldMode: peak
  | "incident"  // 任何 WorldMode 下的緊急事件
  | "shutdown"; // WorldMode: cooldown | closed
```

映射規則：
- `setup` / `open` / `managed` → `normal`
- `peak` → `peak`
- 任何 mode 下出現 incident → `incident`（覆蓋）
- `cooldown` / `closed` → `shutdown`

### 6.3 Verdict（Judgment）

```ts
type Verdict =
  | "approved"
  | "approved_with_constraints"
  | "rejected"
  | "simulation_required"
  | "escalated"
  | "deferred";
```

6 個值。`approved_with_constraints` 和 `deferred` 是必要的。

### 6.4 ChangeProposalStatus

```ts
type ChangeProposalStatus =
  | "draft"
  | "proposed"
  | "judged"
  | "approved"
  | "approved_with_constraints"
  | "rejected"
  | "simulation_required"
  | "escalated"
  | "deferred"
  | "applied"
  | "cancelled"
  | "rolled_back"
  | "outcome_window_open"
  | "outcome_closed"
  | "archived";
```

注意：
- 包含所有 `Verdict` 值作為可能的 status
- 新增 `rolled_back` 狀態
- lifecycle phase 和 judgment verdict 是同一個 enum 的不同階段

### 6.5 ChangeKind

```ts
// v0 MVP：5 個核心
type ChangeKindMVP =
  | "adjust_stall_capacity"
  | "adjust_spotlight_weight"
  | "throttle_entry"
  | "pause_event"
  | "modify_pricing_rule";

// 完整版：11 個
type ChangeKind =
  | ChangeKindMVP
  | "resume_event"
  | "reassign_zone_priority"
  | "tighten_safety_threshold"
  | "relax_safety_threshold"
  | "law_patch"
  | "chief_permission_patch";
```

v0 只實作 `ChangeKindMVP`（5 個），但 schema 預留完整版。

### 6.6 JudgmentReport

唯一正式版本。使用 layerResults 結構。

```ts
type JudgmentReport = {
  id: string;
  proposalId: string;
  cycleId: string;

  layerResults: {
    structural: LayerResult;
    invariants: LayerResult;
    constitution: LayerResult;
    contextual: LayerResult;
  };

  finalVerdict: Verdict;
  finalRiskClass: "low" | "medium" | "high";
  constraints?: string[];
  simulationPlan?: SimulationPlan;
  escalationTarget?: string;
  rollbackRequirements: string[];

  rationale: string;
  createdAt: string;
};

type LayerResult = {
  passed: boolean;
  issues: string[];
  verdict: Verdict;
};

type SimulationPlan = {
  mode: "dry_run" | "shadow" | "counterfactual";
  durationMinutes: number;
  watchedMetrics: string[];
};
```

注意：
- 用 `finalVerdict`（不是 `verdict`）
- 用 `finalRiskClass`（不是 `riskClass`）
- 包含 `layerResults`（四層結構）
- 包含 `cycleId`

### 6.7 Concern

```ts
type Concern = {
  kind: string;
  severity: "low" | "medium" | "high" | "critical";
  targetId?: string;
  summary: string;
};
```

### 6.8 PulseFrame

```ts
type PulseFrame = {
  id: string; // 不用 pulseId
  worldId: string;
  cycleId?: string;

  healthScore: number;
  mode: WorldMode;
  stability: "stable" | "unstable" | "critical";
  dominantConcerns: Concern[]; // 結構化物件，不是 string[]

  metrics: Record<string, number>;
  timestamp: string;
};
```

注意：
- ID 欄位用 `id`，不用 `pulseId`
- `dominantConcerns` 是 `Concern[]`，不是 `string[]`
- `stability` 用獨立欄位，不混進 `mode`

### 6.9 OutcomeReport

```ts
type OutcomeReport = {
  id: string;
  appliedChangeId: string;
  outcomeWindowId: string;

  primaryObjectiveMet: boolean;
  expectedEffects: ExpectedEffectResult[];
  sideEffects: SideEffectResult[];

  verdict: OutcomeVerdict;
  recommendation: OutcomeRecommendation;
  notes: string[];
  createdAt: string;
};

type ExpectedEffectResult = {
  metric: string;
  baseline: number;
  observed: number;
  delta: number;
  matched: boolean;
};

type SideEffectResult = {
  metric: string;
  baseline: number;
  observed: number;
  delta: number;
  severity: "negligible" | "minor" | "significant";
};

type OutcomeVerdict =
  | "beneficial"
  | "neutral"
  | "harmful"
  | "inconclusive";

type OutcomeRecommendation =
  | "reinforce"
  | "retune"
  | "watch"
  | "rollback"
  | "do_not_repeat";
```

注意：
- `sideEffects` 是 `SideEffectResult[]`（結構化），不是 `string[]`
- 包含 `primaryObjectiveMet` 和 `recommendation`
- `OutcomeRecommendation` 會驅動 `GovernanceAdjustment` 的產生

### 6.10 PrecedentRecord

```ts
type PrecedentRecord = {
  id: string;
  worldId: string;
  worldType: string;
  proposalId: string;
  changeKind: ChangeKind;
  cycleId: string;

  context: string;
  decision: string;
  outcome: OutcomeVerdict;
  recommendation: OutcomeRecommendation;
  lessonsLearned: string[];
  contextTags: string[];

  createdAt: string;
};
```

### 6.11 GovernanceAdjustment

```ts
type GovernanceAdjustment = {
  id: string;
  worldId: string;
  triggeredBy: string; // outcomeReportId or precedentId

  adjustmentType: "law_threshold" | "chief_permission" | "chief_style" | "risk_policy" | "simulation_policy";
  target: string; // what law/chief/policy is being adjusted
  before: string;
  after: string;
  rationale: string;

  status: "proposed" | "approved" | "applied" | "rejected";
  createdAt: string;
};
```

### 6.12 Canonical Artifacts

9 個，不是 8 個：

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

---

## 7. 跨層共用

### 7.1 Edda 定位

> Edda 不是 pipeline 最後一格。
> Edda 是 **decision spine across all layers**。

Edda 在每一層都記錄：

| 層 | Edda 記什麼 |
|---|---|
| intent-router | regime classification, confidence, rationale |
| path-check | certainty, fixed/unresolved elements |
| space-builder | generated spaces, pruned spaces |
| probe-commit | probe designs, signal packets, commit memos |
| forge | build decisions |
| thyra | governance precedents, law adjustments |

### 7.2 RouterTestCase

```ts
type RouterTestCase = {
  id: string;
  input: string;

  expectedPrimary: Regime;
  expectedSecondary?: Regime[];
  shouldAskFollowup: boolean;
  expectedUnknowns?: string[];

  why: string[];
  commonFailureModes: string[];
};
```

注意：`expectedSecondary` 是 `Regime[]`，不是 `string[]`。
