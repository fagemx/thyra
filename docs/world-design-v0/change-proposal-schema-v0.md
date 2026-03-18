# change-proposal-schema-v0.md

> 狀態：`working draft`
>
> 型別定義見 `./shared-types.md`。本文件中的型別為簡化參考，以 shared-types.md 為準。
>
> 目的：把 **change** 變成 Thyra 的第一級公民。
>
> 這份文件不是在定義 generic task payload。
> 它定義的是：
>
> **世界如何被提案改變、如何被判斷、如何被套用、如何被回滾、如何進入 precedent。**

---

## 1. 為什麼先做這份

如果 `world` 是 Thyra 的本體，
那 `change proposal` 就是 Thyra 的動詞。

沒有穩定的 change schema，Thyra 很容易退化成：

- 一堆 agent 在講建議
- 一個 admin panel 在改資料
- 一條 loop 在 dispatch task
- 一個 log system 在記錄結果

那樣不叫治理，只叫操作。

所以這份文件的目標很簡單：

> **任何會改變世界的事，都必須先變成一個可被審核的 change proposal。**

---

## 2. 第一原則

### 2.1 Change proposal 不是 task
task 是「做什麼」。
change proposal 是「世界哪裡要變、怎麼變、為什麼變、風險是什麼」。

---

### 2.2 Change proposal 不是 prompt
它不能只是自然語言建議。
它必須能被：

- 顯示
- judge
- simulate
- apply
- rollback
- compare
- retrieve as precedent

---

### 2.3 Change proposal 一定是 world-scoped
所有 proposal 都必須明確回答：

- 改哪個 world
- 改哪個 object / region / rule
- 影響範圍在哪
- 預期改變哪些結果

---

### 2.4 Proposal 必須和 judgment / outcome 對得起來
沒有這種情況：

- 提案很抽象
- judgment 很模糊
- 套用很隨意
- outcome 跟 proposal 對不上

proposal 必須是整條治理鏈的 anchor。

---

## 3. Canonical Lifecycle

```text
draft
→ proposed
→ judged
→ approved | rejected | simulation_required | escalated
→ applied | cancelled
→ outcome_window_open
→ outcome_closed
→ precedent_recorded
→ archived
```

這不是 optional 流程。
這是 canonical lifecycle。

---

## 4. Proposal 的最小結構

每個 proposal 都應該分成 7 層：

1. **Identity**
2. **Target**
3. **Intent**
4. **Diff**
5. **Governance**
6. **Expected Outcome**
7. **Traceability**

---

## 5. Schema v0

下面先用 JSON-like schema 表示。

```ts
type ChangeProposal = {
id: string; // cp_...
worldId: string; // world_midnight_market_001
cycleId: string; // cycle_2026_03_18_2000
status: ChangeProposalStatus;

kind: ChangeKind; // adjust_stall_capacity, throttle_entry...
title: string; // human-readable
summary: string; // one-line summary

target: ChangeTarget;
intent: ChangeIntent;
diff: ChangeDiff;

governance: GovernanceBlock;
expectedOutcome: ExpectedOutcomeBlock;
trace: TraceBlock;

createdAt: string;
createdBy: ProposalAuthor;
judgedAt?: string;
appliedAt?: string;
outcomeWindowId?: string;
};

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

---

## 6. Identity

```ts
type ProposalAuthor =
| { type: "chief"; chiefId: string }
| { type: "human"; userId: string }
| { type: "system"; source: string };

type ChangeKind =
| "adjust_stall_capacity"
| "adjust_spotlight_weight"
| "throttle_entry"
| "pause_event"
| "resume_event"
| "modify_pricing_rule"
| "reassign_zone_priority"
| "tighten_safety_threshold"
| "relax_safety_threshold"
| "law_patch"
| "chief_permission_patch";
```

這一層要回答：

- 這是什麼類型的改變？
- 誰提的？
- 屬於哪一輪 cycle？

---

## 7. Target

```ts
type ChangeTarget = {
scope: "world" | "zone" | "stall" | "event" | "entry_gate" | "law" | "chief";
objectIds: string[]; // e.g. ["zone_a"], ["event_20260318_opening"]
selectors?: Record<string, string | number | boolean>;
blastRadius: "local" | "regional" | "global";
};
```

這一層是為了避免「提案看起來很合理，但不知道動到哪」。

### 例子
- `scope=zone`, `objectIds=["zone_a"]`
- `scope=entry_gate`, `objectIds=["north_gate"]`
- `scope=law`, `objectIds=["law_review_threshold_01"]`

---

## 8. Intent

這一層不是 diff，而是目的。

```ts
type ChangeIntent = {
objective: string; // e.g. "reduce congestion near north gate"
reason: string; // why now
urgency: "low" | "medium" | "high" | "critical";
timeHorizon: "immediate" | "tonight" | "daily" | "weekly";
triggerType:
| "scheduled_review"
| "metric_threshold"
| "incident_response"
| "human_request"
| "precedent_followup"
| "chief_initiative";
};
```

這一層回答：

- 為什麼現在要改？
- 是長期優化還是緊急處理？
- 是哪種 trigger 引發？

---

## 9. Diff

這是整份 schema 的中心。
不能只寫「想調整一下流量」。
要寫成可 apply / rollback 的 diff。

```ts
type ChangeDiff = {
mode: "patch" | "replace" | "append" | "remove";
operations: DiffOperation[];
};

type DiffOperation = {
op: "set" | "inc" | "dec" | "enable" | "disable" | "add" | "remove";
path: string; // dot path in world state
before?: unknown;
after?: unknown;
delta?: number;
unit?: string;
};
```

---

### 例子 1：調整 Zone A 攤位上限
```json
{
"mode": "patch",
"operations": [
{
"op": "set",
"path": "zones.zone_a.stallCapacity",
"before": 20,
"after": 15
}
]
}
```

### 例子 2：北門限流
```json
{
"mode": "patch",
"operations": [
{
"op": "set",
"path": "entryGates.north_gate.throttle.enabled",
"before": false,
"after": true
},
{
"op": "set",
"path": "entryGates.north_gate.throttle.maxPerMinute",
"before": 120,
"after": 80
}
]
}
```

### 例子 3：提高 prime slot 價格
```json
{
"mode": "patch",
"operations": [
{
"op": "inc",
"path": "pricing.slotRules.prime.multiplier",
"before": 1.2,
"after": 1.32,
"delta": 0.12,
"unit": "x"
}
]
}
```

---

## 10. Governance Block

這一層回答：

- 風險多少
- 要不要 simulate
- 需不需要人審
- rollback strategy 是什麼

```ts
type GovernanceBlock = {
requestedRiskClass: "low" | "medium" | "high" | "critical";
autoApplyEligible: boolean;
simulationRequired: boolean;
humanApprovalRequired: boolean;

invariantsChecked?: string[]; // e.g. ["budget_cap", "safety_floor"]
constitutionRefs?: string[]; // immutable rules
lawRefs?: string[]; // active laws consulted
precedentRefs?: string[]; // similar cases from Edda

rollbackPlan: {
strategy: "inverse_patch" | "restore_snapshot" | "manual_only";
rollbackScope: "proposal_only" | "proposal_bundle" | "full_cycle";
rollbackWindowMinutes: number;
};
};
```

---

## 11. Expected Outcome Block

這一層是 proposal 跟 outcome 的對齊面。

```ts
type ExpectedOutcomeBlock = {
hypotheses: string[]; // what should improve
watchedMetrics: WatchedMetric[];
expectedDirection: "improve" | "stabilize" | "decrease_risk" | "increase_throughput";
outcomeWindow: {
openForMinutes: number;
evaluationAt: string | null;
};
};

type WatchedMetric = {
metric: string; // congestion_score, complaint_rate...
direction: "up" | "down" | "stable";
expectedDelta?: number;
tolerance?: number;
};
```

---

### 例子
```json
{
"hypotheses": [
"北門壅塞會下降",
"總體進場量不應下降超過 10%"
],
"watchedMetrics": [
{
"metric": "north_gate_congestion_score",
"direction": "down",
"expectedDelta": 15
},
{
"metric": "total_entry_volume",
"direction": "stable",
"tolerance": 0.1
},
{
"metric": "complaint_rate",
"direction": "down"
}
],
"expectedDirection": "decrease_risk",
"outcomeWindow": {
"openForMinutes": 60,
"evaluationAt": null
}
}
```

---

## 12. Trace Block

這一層是為了讓 proposal 不只是當下臨時決定。

```ts
type TraceBlock = {
sourceObservations: string[]; // observation IDs
sourceIncidents?: string[]; // incident IDs
sourceHumanRequests?: string[]; // request IDs
sourceCycleSummaries?: string[]; // previous cycle summary IDs
notes?: string[];
};
```

這一層回答：

- 這個 proposal 是看了什麼才提出？
- 它不是憑空長出來的嗎？

---

## 13. Judgment Report Schema

proposal 之後一定接 judgment。

```ts
type JudgmentReport = {
id: string;
proposalId: string;
worldId: string;

verdict: "approved" | "approved_with_constraints" | "rejected" | "simulation_required" | "escalated" | "deferred";
riskClass: "low" | "medium" | "high" | "critical";

reasons: string[];
failedChecks?: string[];
simulationPlan?: SimulationPlan;
approver?: {
type: "system" | "human";
id: string;
};

generatedAt: string;
};
```

```ts
type SimulationPlan = {
mode: "shadow" | "counterfactual" | "dry_run";
durationMinutes: number;
watchedMetrics: string[];
};
```

> ⚠️ 正式版本見 `./shared-types.md` §6.6。本文件版本為簡化參考，以 shared-types.md 為準。

---

## 14. Applied Change Schema

proposal 被批准後，不是只改 DB，要留下 canonical record。

```ts
type AppliedChange = {
id: string;
proposalId: string;
worldId: string;

appliedDiff: ChangeDiff;
appliedBy: {
type: "system" | "human";
id: string;
};

snapshotBeforeId: string;
snapshotAfterId: string;

openedOutcomeWindowId?: string;
appliedAt: string;
};
```

---

## 15. Outcome Report Schema

```ts
type OutcomeReport = {
id: string;
proposalId: string;
worldId: string;
outcomeWindowId: string;

verdict: "beneficial" | "harmful" | "neutral" | "inconclusive";
metricResults: MetricResult[];
sideEffects?: string[];
summary: string;

evaluatedAt: string;
};
```

```ts
type MetricResult = {
metric: string;
baseline: number | string | boolean | null;
observed: number | string | boolean | null;
delta?: number;
expectedDirection: "up" | "down" | "stable";
actualDirection: "up" | "down" | "stable";
matchedExpectation: boolean;
};
```

> ⚠️ 正式版本見 `./shared-types.md` §6.9。`sideEffects` 正式型別為 `SideEffectResult[]`（結構化物件），不是 `string[]`。

---

## 16. Precedent Record Schema

這一層不是單純 log，而是 change → outcome 的壓縮知識。

```ts
type PrecedentRecord = {
id: string;
worldType: string; // market, town, port
proposalKind: ChangeKind;
targetPattern: string; // zone:entry_gate, law:pricing_rule...
contextTags: string[]; // peak_hour, high_traffic, creator_night
outcomeVerdict: "beneficial" | "harmful" | "neutral" | "inconclusive";

summary: string;
proposalId: string;
outcomeReportId: string;

createdAt: string;
};
```

---

## 17. Proposal 的風險分級原則

風險不是看字面，而是看 blast radius + reversibility + latency of harm。

### Low
- 影響局部
- 可快速回滾
- 後果容易觀察

例：
- 調整單一 zone 的 spotlight 權重
- 單一 event slot 順序微調

### Medium
- 影響多個區域
- 可回滾但會有營運副作用
- 需要 outcome window

例：
- 入口限流
- pricing multiplier 調整
- 攤位容量重配

### High
- 影響整體流量 / 收入 / 安全
- 回滾成本高
- 可能破壞世界感或秩序

例：
- 關閉主活動
- 大幅改票價
- 降低 safety threshold

### Critical
- 可能破壞 invariants
- 可能造成不可逆傷害
- 只能人類發起或確認

例：
- 關掉核心 safety gate
- 覆蓋世界根憲法
- 清空一整晚的 booking 狀態

---

## 18. Proposal Bundle

單一 chief 可能一次提多個 proposal，但系統真正判的是 bundle。

```ts
type ProposalBundle = {
id: string;
worldId: string;
cycleId: string;
chiefId: string;
proposalIds: string[];

strategySummary: string;
priority: "normal" | "urgent" | "critical";

createdAt: string;
};
```

### 為什麼要 bundle
因為世界改變很少是單一 patch。
例如限流常常同時伴隨：
- 壓低北門進量
- 抬高南門引導
- 暫停某 spotlight 活動

這三個得一起 judge，不然容易局部最佳化。

---

## 19. Midnight Market：5 個 canonical change kinds

如果 Thyra 要先有 ARC 那種骨感，先固定 5 個 change kind 就夠了：

### 1. adjust_stall_capacity
改某 zone / category 可承載攤位量

### 2. adjust_spotlight_weight
改今晚曝光導向

### 3. throttle_entry
針對某入口 / 某時段限流

### 4. pause_event
暫停某活動 / 某 slot

### 5. modify_pricing_rule
改 slot / booth / promotion 定價規則

這 5 個夠跑出：
- 經濟
- 安全
- 節奏
- 流量
- 公平
- rollback

---

## 20. Proposal Example — 完整例子

```json
{
"id": "cp_20260318_2015_north_gate_01",
"worldId": "world_midnight_market_001",
"cycleId": "cycle_20260318_2000",
"status": "proposed",
"kind": "throttle_entry",
"title": "Throttle north gate during peak congestion",
"summary": "Reduce north gate throughput for 60 minutes to lower congestion and complaints.",
"target": {
"scope": "entry_gate",
"objectIds": ["north_gate"],
"blastRadius": "regional"
},
"intent": {
"objective": "reduce congestion near north gate",
"reason": "north gate congestion crossed alert threshold twice within one cycle",
"urgency": "high",
"timeHorizon": "immediate",
"triggerType": "metric_threshold"
},
"diff": {
"mode": "patch",
"operations": [
{
"op": "set",
"path": "entryGates.north_gate.throttle.enabled",
"before": false,
"after": true
},
{
"op": "set",
"path": "entryGates.north_gate.throttle.maxPerMinute",
"before": 120,
"after": 80
}
]
},
"governance": {
"requestedRiskClass": "medium",
"autoApplyEligible": false,
"simulationRequired": true,
"humanApprovalRequired": false,
"invariantsChecked": ["crowd_safety_floor"],
"constitutionRefs": ["const_no_unsafe_density"],
"lawRefs": ["law_peak_hour_flow_control"],
"precedentRefs": ["prec_peak_congestion_northgate_v2"],
"rollbackPlan": {
"strategy": "inverse_patch",
"rollbackScope": "proposal_only",
"rollbackWindowMinutes": 90
}
},
"expectedOutcome": {
"hypotheses": [
"north gate congestion score drops by at least 15 points",
"complaint rate decreases within 60 minutes",
"total entry volume stays within 10% of baseline"
],
"watchedMetrics": [
{
"metric": "north_gate_congestion_score",
"direction": "down",
"expectedDelta": 15
},
{
"metric": "complaint_rate",
"direction": "down"
},
{
"metric": "total_entry_volume",
"direction": "stable",
"tolerance": 0.1
}
],
"expectedDirection": "decrease_risk",
"outcomeWindow": {
"openForMinutes": 60,
"evaluationAt": null
}
},
"trace": {
"sourceObservations": [
"obs_20260318_2000_traffic_01",
"obs_20260318_2000_complaint_03"
],
"sourceIncidents": [
"inc_20260318_northgate_queue_02"
],
"notes": [
"Event Chief requested no full event pause before 21:00"
]
},
"createdAt": "2026-03-18T20:15:00+08:00",
"createdBy": {
"type": "chief",
"chiefId": "chief_safety"
}
}
```

---

## 21. UI 中心應該怎麼顯示 proposal

首頁不要顯示成「agent 說了什麼」。
要顯示成：

- **What will change**
- **Why now**
- **Risk**
- **Expected effect**
- **Rollback plan**
- **Precedents**
- **Decision status**

也就是 proposal card 應該是世界治理卡，不是 chat bubble。

---

## 22. v0 範圍控制

這份 schema 不要一開始就想包住所有世界。

v0 只做三件事：

1. **Midnight Market**
2. **5 個 canonical change kinds**
3. **single-world scope**

不要一開始就做：
- cross-world proposals
- federated territory changes
- asset rights / chain settlement
- multi-stage negotiation protocols

那些是 v2 以後。

---

## 23. 最後一句

> **如果 `world` 是 Thyra 的名詞中心，**
> **那 `change proposal` 就是 Thyra 的句法中心。**
>
> 沒有穩定的 change proposal schema，
> Thyra 就只會像一組很會說話的 agents；
> 有了它，Thyra 才開始像一個真正的治理系統。

---

如果你要，我下一步最自然就是接：

1. `world-cycle-api.md`
2. `midnight-market-canonical-slice.md`
3. `judgment-rules-v0.md`

我建議下一個接 **3**，因為 change schema 定完，下一個最需要落地的就是 judge。