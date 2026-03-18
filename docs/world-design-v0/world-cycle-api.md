# world-cycle-api.md

> 狀態：`working draft`
>
> 型別定義見 `./shared-types.md`。本文件中的型別為簡化參考，以 shared-types.md 為準。
>
> 目的：把 `canonical-cycle.md`、`change-proposal-schema-v0.md`、`judgment-rules-v0.md` 壓成一組**可實作的 world-facing API**。
>
> 這份文件不是 generic workflow API。
> 它定義的是：
>
> **一個世界如何被觀察、如何提出 change、如何被 judge、如何 apply、如何發出 pulse、如何追 outcome、如何形成 precedent，並進入下一輪。**

---

## 1. 設計目標

Thyra 的 API 不應該讓人感覺是在操作：

- jobs
- tasks
- workers
- runs

而應該讓人感覺是在操作：

- worlds
- cycles
- observations
- change proposals
- judgments
- applied changes
- outcome windows
- precedents
- governance adjustments
- pulse

也就是：

> **API 語言必須和產品語言、資料模型語言對齊。**

---

## 2. Canonical Cycle 對應 API

Canonical cycle 是：

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

API 就應直接映射這條鏈：

```text
/worlds
/worlds/:id/cycles
/cycles/:id/observations
/cycles/:id/proposals
/proposals/:id/judgment
/proposals/:id/apply
/applied-changes/:id/rollback
/worlds/:id/pulse
/outcome-windows/:id
/precedents
/governance-adjustments
```

---

## 3. v0 範圍

這份 API 只定義 **single-world canonical cycle**。

v0 不做：

- cross-world federation
- cross-world proposals
- multi-tenant constitutional negotiation
- multi-world synchronized cycle
- market/town/port 全通用 meta layer

v0 目標是：

> **先讓一個 world 的 cycle 可閉環。**

---

## 4. Core Resources

Thyra v0 至少固定 10 個 resource：

1. `World`
2. `Cycle`
3. `ObservationBatch`
4. `ChangeProposal`
5. `JudgmentReport`
6. `AppliedChange`
7. `PulseFrame`
8. `OutcomeWindow`
9. `PrecedentRecord`
10. `GovernanceAdjustment`

這 10 個 resource 就是 Thyra API 的骨架。

---

## 5. Resource Graph

```text
World
├─ has many Cycles
├─ has many PulseFrames
├─ has many AppliedChanges
├─ has many OutcomeWindows
├─ has many PrecedentRecords
└─ has many GovernanceAdjustments

Cycle
├─ belongs to World
├─ has one ObservationBatch
├─ has many ChangeProposals
├─ may have one Summary
└─ may trigger next Cycle

ChangeProposal
├─ belongs to Cycle
├─ belongs to World
├─ has one JudgmentReport
├─ may produce one AppliedChange
└─ may open one OutcomeWindow
```

---

## 6. API Principles

### 6.1 Resource-first
API 以世界治理 resource 為中心，不以 command 字串為中心。

### 6.2 Append-heavy
重要治理物件以 append / record 為主，不做 silent mutation。

### 6.3 Explicit transitions
status 轉換要明確，不能隱性跳過。

### 6.4 Idempotent where possible
尤其是：
- apply
- rollback
- cycle close/open
- pulse emission trigger

### 6.5 Snapshot-aware
涉及 change 的 API 都應能連到 snapshot。

---

## 7. Base Path

```text
/api/v1
```

---

## 8. World APIs

這層回答：

> 世界是什麼、現在長什麼樣、有哪些活躍治理對象。

---

### 8.1 Create World

```http
POST /api/v1/worlds
```

#### Request
```json
{
"worldType": "market",
"slug": "midnight-market",
"name": "Midnight Market",
"templateId": "template_market_v0",
"packId": "pack_festival_v0"
}
```

#### Response
```json
{
"ok": true,
"data": {
"id": "world_midnight_market_001",
"worldType": "market",
"slug": "midnight-market",
"status": "active",
"activeCycleId": null,
"createdAt": "2026-03-18T20:00:00+08:00"
}
}
```

> ⚠️ 以下所有 response 範例應包裹在 THY-11 envelope 中：`{ ok: true, data: <response> }`。
> 部分範例為簡潔省略了 envelope，實際 API 必須包裹。

---

### 8.2 Get World

```http
GET /api/v1/worlds/:worldId
```

回傳 world 基本資料、active cycle、active laws、chiefs、最新 pulse。

---

### 8.3 Get Current World Snapshot

```http
GET /api/v1/worlds/:worldId/snapshot
```

#### Query
- `at=` optional timestamp
- `snapshotId=` optional explicit snapshot id

#### Response
```json
{
"snapshotId": "snap_20260318_2000",
"worldId": "world_midnight_market_001",
"state": { "...": "..." },
"createdAt": "2026-03-18T20:00:00+08:00"
}
```

---

### 8.4 List World Snapshots

```http
GET /api/v1/worlds/:worldId/snapshots
```

#### Query
- `limit`
- `before`
- `after`

---

### 8.5 Get World Status

```http
GET /api/v1/worlds/:worldId/status
```

回傳：
- current mode
- active cycle
- active outcome windows
- pending proposals
- unresolved incidents
- latest pulse summary

---

## 9. Cycle APIs

這層回答：

> 世界現在跑到哪一輪了？本輪看到了什麼？本輪做了哪些治理動作？

---

### 9.1 Open Cycle

```http
POST /api/v1/worlds/:worldId/cycles
```

#### Request
```json
{
"mode": "normal",
"openedBy": {
"type": "system",
"id": "scheduler"
}
}
```

#### Response
```json
{
"cycleId": "cycle_20260318_2000",
"worldId": "world_midnight_market_001",
"status": "open",
"mode": "normal",
"openedAt": "2026-03-18T20:00:00+08:00"
}
```

---

### 9.2 Get Active Cycle

```http
GET /api/v1/worlds/:worldId/cycles/active
```

---

### 9.3 Get Cycle

```http
GET /api/v1/cycles/:cycleId
```

---

### 9.4 Close Cycle

```http
POST /api/v1/cycles/:cycleId/close
```

close 時應做：
- freeze observation batch
- freeze proposal list
- emit cycle summary
- optionally queue next cycle

---

### 9.5 List Cycles

```http
GET /api/v1/worlds/:worldId/cycles
```

#### Query
- `status=open|closed`
- `mode=normal|peak|incident|shutdown`
- `limit`

---

## 10. Observation APIs

這層回答：

> 本輪治理材料是什麼。

---

### 10.1 Create Observation Batch

```http
POST /api/v1/cycles/:cycleId/observations
```

#### Request
```json
{
"source": "system",
"items": [
{
"type": "metric_threshold",
"entity": "north_gate",
"payload": {
"metric": "congestion_score",
"value": 87
},
"timestamp": "2026-03-18T20:03:00+08:00"
}
]
}
```

#### Response
```json
{
"observationBatchId": "obsb_20260318_2000",
"cycleId": "cycle_20260318_2000",
"count": 12,
"status": "sealed"
}
```

---

### 10.2 Get Observation Batch

```http
GET /api/v1/cycles/:cycleId/observations
```

---

### 10.3 Append External Event

這條是 ingress 入口的一部分。

```http
POST /api/v1/worlds/:worldId/events
```

外部事件先進 world event log，之後由 cycle 收斂成 observation。

#### Request
```json
{
"type": "checkout_completed",
"source": "owned_surface",
"payload": {
"slotId": "slot_prime_04",
"amount": 1200
},
"occurredAt": "2026-03-18T20:05:00+08:00"
}
```

---

## 11. Change Proposal APIs

這層回答：

> 世界具體打算怎麼變。

---

### 11.1 Create Proposal

```http
POST /api/v1/cycles/:cycleId/proposals
```

Body 直接使用 `ChangeProposal` schema。

#### Response
```json
{
"proposalId": "cp_20260318_2015_north_gate_01",
"status": "proposed"
}
```

---

### 11.2 List Proposals

```http
GET /api/v1/cycles/:cycleId/proposals
```

#### Query
- `status=proposed|judged|approved|applied|rejected`
- `chiefId=`
- `kind=`

---

### 11.3 Get Proposal

```http
GET /api/v1/proposals/:proposalId
```

---

### 11.4 Create Proposal Bundle

```http
POST /api/v1/cycles/:cycleId/proposal-bundles
```

適合多 proposal 一起 judge。

---

## 12. Judgment APIs

這層回答：

> 這個 change 現在能不能做、怎麼做。

---

### 12.1 Judge Proposal

```http
POST /api/v1/proposals/:proposalId/judgment
```

#### Request
```json
{
"requestedBy": {
"type": "system",
"id": "judge_engine_v0"
}
}
```

#### Response
```json
{
"judgmentId": "jr_20260318_2016_north_gate_01",
"proposalId": "cp_20260318_2015_north_gate_01",
"finalVerdict": "approved_with_constraints",
"finalRiskClass": "medium",
"constraints": [
{
"kind": "time_limited",
"payload": {
"minutes": 60
}
}
]
}
```

---

### 12.2 Get Judgment Report

```http
GET /api/v1/proposals/:proposalId/judgment
```

---

### 12.3 Rejudge Proposal

v0 允許在 world state 已變化後重判。

```http
POST /api/v1/proposals/:proposalId/rejudge
```

---

## 13. Apply / Rollback APIs

這層回答：

> judgment 過了之後，世界實際發生了什麼改變。

---

### 13.1 Apply Proposal

```http
POST /api/v1/proposals/:proposalId/apply
```

#### Request
```json
{
"appliedBy": {
"type": "system",
"id": "apply_engine_v0"
},
"idempotencyKey": "apply_cp_20260318_2015_north_gate_01"
}
```

#### Response
```json
{
"appliedChangeId": "ac_20260318_2017_north_gate_01",
"proposalId": "cp_20260318_2015_north_gate_01",
"snapshotBeforeId": "snap_20260318_2015",
"snapshotAfterId": "snap_20260318_2017",
"openedOutcomeWindowId": "ow_20260318_2017_01"
}
```

---

### 13.2 Get Applied Change

```http
GET /api/v1/applied-changes/:appliedChangeId
```

---

### 13.3 Rollback Applied Change

```http
POST /api/v1/applied-changes/:appliedChangeId/rollback
```

#### Request
```json
{
"reason": "complaint rate rose above rollback threshold",
"requestedBy": {
"type": "system",
"id": "rollback_guard"
}
}
```

#### Response
```json
{
"rollbackId": "rb_20260318_2040_01",
"status": "completed",
"restoredSnapshotId": "snap_20260318_2040"
}
```

---

## 14. Pulse APIs

這層回答：

> 世界現在活得怎麼樣。

---

### 14.1 Get Current Pulse

```http
GET /api/v1/worlds/:worldId/pulse
```

#### Response
```json
{
"id": "pulse_20260318_2020",
"worldId": "world_midnight_market_001",
"healthScore": 78,
"mode": "peak",
"stability": "unstable",
"activeCycleId": "cycle_20260318_2000",
"pendingProposalCount": 2,
"openOutcomeWindowCount": 3,
"dominantConcerns": [
{
"kind": "gate_congestion",
"severity": "high",
"targetId": "north_gate",
"summary": "north gate congestion above threshold"
},
{
"kind": "event_overheating",
"severity": "medium",
"targetId": "slot_prime_04",
"summary": "prime slot overheating"
}
],
"generatedAt": "2026-03-18T20:20:00+08:00"
}
```

---

### 14.2 Pulse Stream (SSE)

```http
GET /api/v1/worlds/:worldId/pulse/stream
```

SSE event types：
- `pulse.updated`
- `proposal.created`
- `proposal.judged`
- `proposal.applied`
- `outcome.updated`
- `rollback.executed`
- `cycle.opened`
- `cycle.closed`

這條是「世界在呼吸」最直接的 surface。

---

## 15. Outcome APIs

這層回答：

> 某個已套用的 change，最後造成什麼後果。

---

### 15.1 Get Outcome Window

```http
GET /api/v1/outcome-windows/:outcomeWindowId
```

---

### 15.2 Evaluate Outcome Window

```http
POST /api/v1/outcome-windows/:outcomeWindowId/evaluate
```

#### Response
```json
{
"outcomeReportId": "or_20260318_2117_01",
"verdict": "beneficial",
"metricResults": [
{
"metric": "north_gate_congestion_score",
"baseline": 87,
"observed": 65,
"delta": -22,
"matchedExpectation": true
}
]
}
```

---

### 15.3 Get Outcome Report

```http
GET /api/v1/outcome-reports/:outcomeReportId
```

---

### 15.4 List Open Outcome Windows

```http
GET /api/v1/worlds/:worldId/outcome-windows
```

#### Query
- `status=open|closed`
- `proposalId=`

---

## 16. Precedent APIs

這層回答：

> 這種 change 以前做過嗎？結果怎樣？

---

### 16.1 List Precedents

```http
GET /api/v1/worlds/:worldId/precedents
```

#### Query
- `kind=`
- `targetPattern=`
- `verdict=beneficial|harmful|neutral`
- `contextTag=`

---

### 16.2 Get Precedent

```http
GET /api/v1/precedents/:precedentId
```

---

### 16.3 Search Related Precedents

```http
POST /api/v1/precedents/search
```

#### Request
```json
{
"worldType": "market",
"proposalKind": "throttle_entry",
"contextTags": ["peak_hour", "festival_night"]
}
```

---

## 17. Governance Adjustment APIs

這層回答：

> outcome 之後，治理要怎麼被修正。

---

### 17.1 Create Governance Adjustment

```http
POST /api/v1/worlds/:worldId/governance-adjustments
```

#### Request
```json
{
"sourceOutcomeReportId": "or_20260318_2117_01",
"kind": "law_patch",
"summary": "Lower threshold for early congestion intervention at north gate",
"proposedChanges": [
{
"path": "laws.flow_control.peakInterventionThreshold",
"before": 85,
"after": 78
}
]
}
```

---

### 17.2 List Governance Adjustments

```http
GET /api/v1/worlds/:worldId/governance-adjustments
```

---

### 17.3 Apply Governance Adjustment

```http
POST /api/v1/governance-adjustments/:adjustmentId/apply
```

注意：這本質上仍應落回 `change proposal` / `judgment` 機制，
不要偷開後門直接改 law。

---

## 18. Human Command APIs

這層回答：

> 人怎麼插手世界，而不破壞 world-cycle 語義。

---

### 18.1 Submit Human Action

```http
POST /api/v1/worlds/:worldId/human-actions
```

#### Request
```json
{
"type": "request_change",
"summary": "Lower prime slot price for the last hour",
"payload": {
"suggestedKind": "modify_pricing_rule"
}
}
```

人類動作不應直接 mutate world，
而應進 observation / proposal pipeline。

---

### 18.2 Approve Escalated Proposal

```http
POST /api/v1/proposals/:proposalId/approve
```

---

### 18.3 Reject Escalated Proposal

```http
POST /api/v1/proposals/:proposalId/reject
```

---

## 19. Suggested State Transitions

### Change Proposal
```text
draft
→ proposed
→ judged
→ approved | approved_with_constraints | rejected | simulation_required | escalated | deferred
→ applied | cancelled
→ rolled_back (從 applied 回退)
→ outcome_window_open
→ outcome_closed
→ archived
```

### Cycle
```text
open
→ observation_sealed
→ proposals_closed
→ changes_applied
→ outcome_tracking
→ closed
```

### Outcome Window
```text
open
→ evaluating
→ closed
```

---

## 20. Idempotency Rules

以下 endpoint 應支援 `Idempotency-Key`：

- `POST /proposals/:id/apply`
- `POST /applied-changes/:id/rollback`
- `POST /worlds/:id/cycles`
- `POST /cycles/:id/close`

原因很簡單：
這些操作一旦重複，世界會真的變兩次。

---

## 21. Response Envelope（THY-11）

v0 應固定回應格式，與 Thyra 現有 API 一致。

### 成功
```json
{
"ok": true,
"data": {
"proposalId": "cp_...",
"status": "proposed"
}
}
```

### 失敗
```json
{
"ok": false,
"error": {
"code": "WORLD_STATE_CONFLICT",
"message": "Proposal before-state no longer matches current snapshot."
}
}
```

> 不使用 `{ error: { code, message, details } }` 格式。見 `./shared-types.md` §1.2。

建議 code 類型：
- `PROPOSAL_INVALID`
- `TARGET_NOT_FOUND`
- `WORLD_STATE_CONFLICT`
- `JUDGMENT_REQUIRED`
- `PROPOSAL_NOT_APPROVED`
- `ROLLBACK_NOT_ALLOWED`
- `OUTCOME_WINDOW_OPEN`
- `AUTHORITY_EXCEEDED`

---

## 22. Canonical Happy Path

這條要能一眼看出 Thyra 不是 generic orchestrator。

### Flow
1. scheduler 開一輪 cycle
2. world 收 external events
3. observations 被 seal
4. Safety Chief 提 proposal
5. judge engine 給 `approved_with_constraints`
6. apply engine 套用 change
7. pulse 更新
8. outcome window 開啟
9. 一小時後 evaluate outcome
10. 形成 precedent
11. governance adjustment 被提出
12. 下一輪 cycle 讀到 precedent

這才是 Thyra API 的 happy path。

---

## 23. Midnight Market v0 Minimal Endpoint Set

如果只做最小可跑版，我會先只做這 14 條：

### World / Cycle
- `POST /worlds`
- `GET /worlds/:id`
- `GET /worlds/:id/snapshot`
- `POST /worlds/:id/cycles`
- `GET /worlds/:id/cycles/active`
- `POST /cycles/:id/close`

### Observation / Proposal / Judgment
- `POST /cycles/:id/observations`
- `POST /cycles/:id/proposals`
- `GET /proposals/:id`
- `POST /proposals/:id/judgment`
- `POST /proposals/:id/apply`

### Pulse / Outcome / Precedent
- `GET /worlds/:id/pulse`
- `GET /worlds/:id/pulse/stream`
- `POST /outcome-windows/:id/evaluate`

這 14 條夠跑出第一個 canonical slice。

---

## 24. 對應到模組切法

如果照 repo 內工程切：

```text
src/routes/
worlds.ts
cycles.ts
observations.ts
proposals.ts
judgments.ts
applied-changes.ts
pulse.ts
outcome-windows.ts
precedents.ts
governance-adjustments.ts
human-actions.ts
```

背後 service：

```text
src/services/
world-service.ts
cycle-service.ts
observation-service.ts
proposal-service.ts
judgment-service.ts
apply-service.ts
rollback-service.ts
pulse-service.ts
outcome-service.ts
precedent-service.ts
governance-adjustment-service.ts
```

這種切法的好處是：
resource 和概念對齊，不會被 generic engine 吃掉。

---

## 25. 最後一句

> **如果 `canonical-cycle.md` 定的是 Thyra 的運作骨架，**
> **那 `world-cycle-api.md` 就是在把那副骨架露出來。**
>
> 只要 API 還在說 jobs / tasks / workers，
> Thyra 就還沒站穩。
>
> 只有當 API 本身就在說：
> `world → cycle → proposal → judgment → apply → pulse → outcome → precedent`
>
> 才會真的出現你說的那種：
> **概念跟架構是對齊的感覺。**

相關文件：
- `canonical-cycle.md` — 世界循環定義
- `change-proposal-schema-v0.md` — 變更提案 schema
- `judgment-rules-v0.md` — 判斷規則
- `pulse-and-outcome-metrics-v0.md` — 脈搏與後果
- `midnight-market-canonical-slice.md` — 最小實例
- `shared-types.md` — 跨文件型別