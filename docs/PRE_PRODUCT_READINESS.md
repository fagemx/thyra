# Pre-Product Readiness：產品化前必須跑順的能力清單

**Date**: 2026-03-12
**Purpose**: 在談 Command Center UI 之前，三 repo 系統必須端到端無話可說。本文件定義所有必須驗證的能力、預期行為、驗收標準，以及 Karvi / Edda 各自需要升級的內容。

---

## 概覽

```
Stage 0: 三服啟動與連通
Stage 1: 治理生命週期完整跑通
Stage 2: 跨 repo 整合鏈路
Stage 3: 降級與韌性
Stage 4: 觀測與審計完整性
Stage 5: Loop Runner 實戰循環
Stage 6: Territory Federation
```

### 驗證方式圖例

| 標記 | 意義 |
|---|---|
| 🤖 | 可完全自動化（寫成 test 或 script） |
| 👤 | 需要人工操作或判斷 |
| 🤖👤 | 程序驗證為主，但首次需人工確認環境 |

---

## Stage 0：三服啟動與連通

> 最基本的前提：三個 server 能同時跑，互相認得到。

### 0-1. Thyra 啟動 🤖

| 項目 | 說明 |
|---|---|
| **做什麼** | `bun run dev` 或 `bun src/index.ts` 啟動 Thyra |
| **預期行為** | 監聽 `:3462`，SQLite 初始化，所有 route mount 完成 |
| **驗收標準** | `GET /api/health` → `{ ok: true, version: "0.1.0" }` |
| **當前狀態** | ✅ 已實現 |
| **自動化** | script 內 `curl localhost:3462/api/health` assert |

### 0-2. Karvi 啟動 🤖

| 項目 | 說明 |
|---|---|
| **做什麼** | 在 `C:\ai_agent\karvi` 啟動 Karvi server |
| **預期行為** | 監聽 `:3461`，blackboard 初始化 |
| **驗收標準** | `GET /api/health/preflight` → `{ ready: true, ... }` |
| **當前狀態** | ✅ Node.js 自研 HTTP server，23 個 route 模組 |
| **自動化** | script 內 `curl localhost:3461/api/health/preflight` assert |

### 0-3. Edda 啟動 🤖👤

| 項目 | 說明 |
|---|---|
| **做什麼** | 在 `C:\ai_agent\edda` 啟動 `edda serve` |
| **預期行為** | 監聽 `:3463`，Axum server，SQLite event store |
| **驗收標準** | `GET /api/health` → `{ ok: true }` |
| **當前狀態** | ✅ Rust/Axum binary |
| **自動化** | 首次需確認 `cargo build` 成功，之後可自動 |

### 0-4. Thyra → Karvi 連通 🤖

| 項目 | 說明 |
|---|---|
| **做什麼** | Thyra 啟動時自動 `registerWebhookUrl()` + `startMonitor()` |
| **預期行為** | POST `/api/controls` → Karvi 設定 `event_webhook_url` |
| **驗收標準** | Thyra log: `[thyra] webhook registered on karvi`。`GET /api/bridges/karvi/status` → `{ ok: true }` |
| **當前狀態** | ✅ 已實現（`src/index.ts:59-65`）。尚未三服驗證。 |
| **自動化** | smoke test 可涵蓋 |

### 0-5. Thyra → Edda 連通 🤖

| 項目 | 說明 |
|---|---|
| **做什麼** | `GET /api/bridges/edda/status` |
| **預期行為** | Thyra 呼叫 Edda `/api/health`，回報連通 |
| **驗收標準** | `{ ok: true, data: { healthy: true } }` |
| **當前狀態** | ✅ 已實現。注意：`index.ts` 未自動啟動 Edda monitor（只啟動 Karvi monitor）。 |
| **自動化** | smoke test 可涵蓋 |

### 0-6. 一鍵三服啟動 👤→🤖

| 項目 | 說明 |
|---|---|
| **做什麼** | 需要一個 script 或 docker-compose 同時起三服 |
| **預期行為** | 一條指令，三個 process，各自 port |
| **驗收標準** | 3 秒內三個 health check 都通過 |
| **當前狀態** | 🔲 **不存在**。目前需手動開三個 terminal。這是 dogfood 最大阻礙。 |
| **自動化** | 寫完 script 後可自動化 |

---

## Stage 1：治理生命週期完整跑通 🤖

> 全部可自動化。核心治理鏈：Village → Constitution → Chief → Law → Loop。

### 1-1. Village 建立 🤖
- `POST /api/villages` → `{ ok: true, data: { id, status: "active" } }`
- ✅ 12 tests

### 1-2. Constitution 建立 + Budget Sync 🤖
- `POST /api/villages/:vid/constitutions` → active constitution + 自動 sync budget 到 Karvi
- ✅ 28 tests。budget sync 需三服驗證。

### 1-3. Constitution 不可變性（THY-01）🤖
- 嘗試修改 → 拒絕。只能 revoke + supersede。
- ✅ 測試覆蓋

### 1-4. Chief 權限約束（THY-09）🤖
- permissions ⊆ Constitution allowed_permissions，否則拒絕
- ✅ 22 tests

### 1-5. Skill Verified Binding（THY-14）🤖
- 只有 verified skill 能 bind 到 chief
- ✅ 20 tests

### 1-6. Law 提案與風險評估（THY-02, THY-03）🤖
- Low → enacted，Medium → pending_approval，High → 拒絕自動提案
- ✅ 26 tests

### 1-7. Law → Edda 記錄 🤖
- Law enacted 時 fire-and-forget `POST /api/decide` 到 Edda
- ✅ 已實現。需三服驗證 Edda 真的收到。

---

## Stage 2：跨 Repo 整合鏈路

> 三 repo HTTP 通訊。全部可自動化（寫成 E2E test），但首次需三服同時運行。

### 2-1. Thyra → Karvi：Dispatch Project 🤖
- `POST /api/bridges/karvi/dispatch` → Karvi `POST /api/projects`
- ✅ 雙端有實現。需三服驗證。

### 2-2. Thyra → Karvi：Single Task + Budget 拒絕 🤖
- 正常 → 200。超 budget → Karvi 回 409 BUDGET_EXCEEDED → Thyra 回 409
- ✅ 雙端有實現。需三服驗證。

### 2-3. Thyra → Karvi：Budget Sync 🤖
- Constitution 建立時 `POST /api/controls` → Karvi controls 更新
- ✅ Thyra 端實現。**需驗證 Karvi 是否正確存取這些值**。

### 2-4. Karvi → Thyra：Webhook Event 🤖 ⚠️
- Karvi step 完成 → POST 到 Thyra `/api/webhooks/karvi`
- ⚠️ **已確認有 payload 格式 mismatch**（見下方 Karvi 升級清單）
- 這是最關鍵的整合點。

### 2-5. Thyra → Edda：記錄 Decision 🤖
- `POST /api/bridges/edda/decide` → Edda `POST /api/decide`
- ✅ **格式完全匹配**。已確認 Edda 端 response `{ event_id, superseded? }` 與 Thyra 預期一致。

### 2-6. Thyra → Edda：查詢 Precedents 🤖
- `POST /api/bridges/edda/query` → Edda `GET /api/decisions?q=...`
- ✅ **格式完全匹配**。Edda `AskResult` 結構與 Thyra `EddaQueryResult` 一致。

### 2-7. Thyra → Edda：記錄 Note 🤖
- `POST /api/bridges/edda/note` → Edda `POST /api/note`
- ✅ **格式完全匹配**。

### 2-8. Thyra → Edda：查詢 Event Log 🤖 ⚠️
- `queryEventLog()` → Edda `GET /api/log`
- ⚠️ **已確認有格式 mismatch**（見下方 Edda 升級清單）

### 2-9. 完整鏈路 E2E 🤖👤
- Village → Constitution → Budget Sync → Chief → Dispatch → Webhook → Audit
- 🔲 **從未在三服同時運行時跑過**。smoke test step 7 是模擬 webhook。
- 首次需 👤 確認環境，之後可 🤖。

---

## Stage 3：降級與韌性

### 3-1. Karvi 離線時 Thyra 不 crash 🤖
- 不啟動 Karvi，只跑 Thyra + Edda → 所有非 Karvi 功能正常
- ✅ 實現。可寫自動化 test。

### 3-2. Edda 離線時 Thyra 不 crash 🤖
- 不啟動 Edda → 治理鏈路正常，Edda 記錄 silently fail
- ✅ 實現。

### 3-3. Karvi 中途斷線 + 自動重連 🤖👤
- Kill Karvi → 等 30 秒 → 重啟 → monitor 自動重連 + 重新 register webhook
- ✅ 實現。首次需手動觀察 log，之後可寫 script。

### 3-4. Webhook 冪等性 🤖
- 同一 event_id 送兩次 → 第二次 `{ duplicate: true }`
- ✅ 實現 + 測試覆蓋。

### 3-5. Network Timeout 不阻塞 🤖
- Bridge timeout（Karvi 10s, Edda 5s）→ 不卡 Thyra
- ✅ 實現。需壓測驗證。

---

## Stage 4：觀測與審計完整性

### 4-1. Audit Log 覆蓋率 🤖

跑完完整鏈路後，audit_log 必須有以下 20 種 action：

| 動作 | action | entity_type |
|---|---|---|
| 建 village | `create_village` | `village` |
| 建 constitution | `create_constitution` | `constitution` |
| Supersede | `supersede_constitution` | `constitution` |
| Revoke | `revoke_constitution` | `constitution` |
| 建 chief | `create_chief` | `chief` |
| Bind skill | `bind_skill` | `chief` |
| Propose law | `propose_law` | `law` |
| Enact law | `enact_law` | `law` |
| Revoke law | `revoke_law` | `law` |
| 建 skill | `create_skill` | `skill` |
| Verify skill | `verify_skill` | `skill` |
| Dispatch | `karvi_dispatch` | `karvi_project` |
| Budget sync | `karvi_budget_sync` | `karvi_controls` |
| Webhook event | `karvi_event` | `karvi_event` |
| Edda decision | `edda_decide` | `edda_decision` |
| Loop start | `start_cycle` | `loop_cycle` |
| Loop action | `loop_action` | `loop_cycle` |
| Loop finish | `finish_cycle` | `loop_cycle` |
| Territory | `create_territory` | `territory` |
| Agreement | `create_agreement` | `agreement` |

✅ 各模組都有寫入。可自動化驗證。

### 4-2. Village 範圍 Audit 查詢 🤖
- `GET /api/villages/:vid/audit` → 只含該 village 記錄
- ✅ 30 tests

### 4-3. Audit 查詢效能 🤖
- 1000+ 筆時 < 50ms
- 🔶 未做。可寫 benchmark script。

---

## Stage 5：Loop Runner 實戰循環

### 5-1. Loop Cycle 基本流程 🤖
- start → observe → decide（null in Phase 0）→ finish
- ✅ 30 tests。但只在 mock bridge 中跑過。

### 5-2. Loop Observe 含 Karvi Events 🤖
- 合併 internal audit + Karvi webhook events → top 20
- ✅ 實現。需真實 Karvi events 驗證。

### 5-3. Loop Decide 含 Edda Precedents 🤖
- Phase 0: query Edda → null。Phase 1: 餵 LLM。
- ✅ 已接入。

### 5-4. Risk Assessment + Budget Gate 🤖
- SI-1~SI-7 硬檢查 + budget gate
- ✅ 19 tests

### 5-5. Loop Abort（SI-1）🤖
- `POST /abort` → AbortController → cycle `aborted`
- ✅ 測試覆蓋

### 5-6. Loop Timeout 🤖
- timeout_ms 到期 → cycle `timeout`
- ✅ 測試覆蓋

---

## Stage 6：Territory Federation

### 6-1. Territory + SI-7 🤖
- 所有 village 需 active constitution + `cross_village` permission
- ✅ 25 tests

### 6-2. Agreement Workflow 🤖
- pending → all approve → active
- ✅ 測試覆蓋

---

## 驗收總表

| Stage | 項目數 | 🤖 可自動 | 🤖👤 需首次手動 | 👤 需手動 | 缺失 |
|---|---|---|---|---|---|
| 0: 三服連通 | 6 | 4 | 1 | 0 | 1 |
| 1: 治理週期 | 7 | 7 | 0 | 0 | 0 |
| 2: 跨 Repo | 9 | 7 | 1 | 0 | 0 |
| 3: 降級韌性 | 5 | 4 | 1 | 0 | 0 |
| 4: 審計 | 3 | 3 | 0 | 0 | 0 |
| 5: Loop | 6 | 6 | 0 | 0 | 0 |
| 6: Territory | 2 | 2 | 0 | 0 | 0 |
| **總計** | **38** | **33** | **3** | **0** | **1** |

**結論：38 項中 33 項可完全自動化，3 項首次需人工確認，1 項（一鍵啟動）需新建。不需要純手動的項目。**

---

# Karvi 升級清單

> Karvi repo: `C:\ai_agent\karvi`，Node.js，zero-dependency

## 已確認正常的 API（不需改動）

| Endpoint | 狀態 | 備註 |
|---|---|---|
| `POST /api/controls`（接收 webhook URL + budget） | ✅ | 完整支持 `event_webhook_url`、`step_timeout_sec`、`usage_limits` |
| `POST /api/projects` | ✅ | 回傳 `{ project: { id, taskIds }, taskCount }` |
| `POST /api/tasks/:id/dispatch` | ✅ | 支援 409 BUDGET_EXCEEDED |
| `POST /api/tasks/:id/cancel` | ✅ | 完整 cancel + cleanup |
| `GET /api/board` | ✅ | 含 controls |
| `GET /api/status?fields=` | ✅ | 支援 core/steps/errors/metrics/events/agent_metrics |
| `GET /api/tasks/:id/progress` | ✅ | 含 pipeline + budget |
| `GET /api/health/preflight` | ✅ | 環境檢查，60 秒 cache |

## 🔴 必須修復：Webhook Payload 格式 Mismatch

**問題**：Karvi 發出的 webhook 格式與 Thyra 期望的不一致。

**Karvi 實際發送**（`server/step-worker.js` `emitWebhookEvent()`）：
```json
{
  "version": "karvi.event.v1",
  "event_id": "evt_xxx",
  "event_type": "step_succeeded",
  "occurred_at": "ISO8601",
  "event": "step_succeeded",
  "ts": "ISO8601",
  "taskId": "task-1",
  "stepId": "step-abc",
  "state": "succeeded"
}
```

**Thyra 期望**（`KarviWebhookPayloadSchema`）：
```json
{
  "event_type": "step_completed",
  "event_id": "evt_xxx",
  "timestamp": "ISO8601",
  "payload": {
    "task_id": "task-1",
    "step_index": 0,
    "state": "done"
  }
}
```

### 差異清單

| 欄位 | Karvi 發送 | Thyra 期望 | 修哪邊 |
|---|---|---|---|
| 時間欄位名 | `occurred_at` | `timestamp` | 兩邊都改或選一邊 |
| Event type 值 | `step_succeeded` / `step_failed` / `step_started` / `step_cancelled` / `step_dead` | `step_completed` | 需要 mapping |
| Payload 包裝 | 扁平（直接在 envelope） | 巢狀 `payload: { ... }` | 需要結構調整 |
| Task ID 欄位 | `taskId` (camelCase) | `task_id` (snake_case) | 命名風格 |
| Step 識別 | `stepId`（unique ID） | `step_index`（0-based 數字） | **語意不同** |
| State 值 | `succeeded` / `failed` / `dead` | `done` / `failed` | 需要 mapping |

### 建議修法

**選項 A（推薦）：Karvi 端調整 `emitWebhookEvent()` 格式**

修改 `server/step-worker.js`，讓 envelope 符合 `karvi.event.v1` 契約：
```javascript
const envelope = {
  event_type: mapEventType(eventType),  // step_succeeded → step_completed
  event_id: `evt_${crypto.randomUUID()}`,
  timestamp: new Date().toISOString(),
  payload: {
    task_id: payload.taskId,
    step_id: payload.stepId,
    step_index: computeStepIndex(task, payload.stepId),
    state: mapState(payload.state),     // succeeded → done
    ...otherPayloadFields
  }
};
```

**選項 B：Thyra 端做 adapter**

在 `normalizeKarviEvent()` 裡加一層 mapping。但這違反「Karvi 對外契約應該穩定」的原則。

**選項 C（務實折衷）：雙邊都改**

- Karvi 加 `payload` 包裝 + `timestamp` 欄位
- Thyra 的 `normalizeKarviEvent()` 接受兩種 event type naming（`step_succeeded` 和 `step_completed` 都認）

### 工作量估計

| 改動 | 影響檔案 | 複雜度 |
|---|---|---|
| Karvi: `emitWebhookEvent()` 改格式 | `server/step-worker.js` | 小（~30 行） |
| Karvi: 加 `step_index` 計算 | `server/step-worker.js` | 小（從 task.steps 算 index） |
| Karvi: event type mapping | `server/step-worker.js` | 小（switch/map） |
| 測試 | 需新增 webhook payload 測試 | 中 |

## 🟡 建議改善：Controls 未真正 enforce

| 問題 | 說明 |
|---|---|
| `step_timeout_sec` | Karvi 接收但**不 enforce**。step 沒有按此 timeout 自動停止。 |
| `usage_limits` | Karvi 接收但**不 enforce**。沒有 dispatch 配額限制。 |

**影響**：Thyra 以為 sync 了 budget → Karvi 會限制，但 Karvi 不會。目前 Thyra 自己也有 budget gate（RiskAssessor），所以不會爆炸，但語意不一致。

**建議**：Phase 1 不急修。先靠 Thyra 端的 budget gate。Phase 2 再讓 Karvi enforce。

---

# Edda 升級清單

> Edda repo: `C:\ai_agent\edda`，Rust/Axum

## 已確認正常的 API（不需改動）

| Endpoint | 狀態 | 備註 |
|---|---|---|
| `GET /api/health` | ✅ | `{ ok: true }` 完全匹配 |
| `GET /api/decisions?q=&limit=&all=&branch=` | ✅ | `AskResult` 結構完全匹配 Thyra 的 `EddaQueryResult` |
| `POST /api/decide` | ✅ | `{ event_id, superseded? }` 完全匹配 |
| `POST /api/note` | ✅ | `{ event_id }` 完全匹配 |
| `GET /api/decisions/:eventId/outcomes` | ✅ | Thyra 接受 generic JSON，相容 |

## 🔴 必須修復：`GET /api/log` Response 格式 Mismatch

**問題**：Thyra 的 `queryEventLog()` 無法正確解析 Edda 的回應。

**Edda 實際回傳**（`crates/edda-serve/src/lib.rs:329-390`）：
```json
{
  "events": [
    {
      "ts": "2026-03-12T...",
      "event_type": "note",
      "event_id": "evt-123",
      "branch": "main",
      "detail": "session note"
    }
  ]
}
```

**Thyra 期望**（`edda-bridge.ts:228-247`）：
```typescript
// 直接 cast 為 array
return await res.json() as EddaLogEntry[];

interface EddaLogEntry {
  event_id: string;
  type: string;      // ← Edda 回 "event_type"
  summary: string;   // ← Edda 回 "detail"
  ts: string;
  branch?: string;
  tags?: string[];   // ← Edda 沒有此欄位
}
```

### 差異清單

| 欄位 | Edda 回傳 | Thyra 期望 | 修哪邊 |
|---|---|---|---|
| 外層結構 | `{ events: [...] }` 包裝 | 直接 `[...]` array | 需改一邊 |
| 事件類型欄位 | `event_type` | `type` | 命名不同 |
| 摘要欄位 | `detail` | `summary` | 命名不同 |
| Tags | 不存在 | `tags?: string[]` | Edda 缺欄位（但 Thyra 端是 optional） |

### ⚠️ 為什麼 unit test 沒抓到

Thyra 的 `edda-bridge.test.ts:367-413` 用 mock server 回傳**直接 array**，繞過了 Edda 的真實 `{ events: [...] }` 包裝。所以 unit test 全 pass 但真實整合會壞。

### 建議修法

**選項 A（推薦）：Thyra 端修 `queryEventLog()`**

```typescript
const data = await res.json();
const entries = Array.isArray(data) ? data : (data.events ?? []);
return entries.map(e => ({
  event_id: e.event_id,
  type: e.event_type ?? e.type,
  summary: e.detail ?? e.summary,
  ts: e.ts,
  branch: e.branch,
  tags: e.tags,
}));
```

好處：不需改 Edda（Rust 改動成本較高），Thyra 端更 defensive。

**選項 B：Edda 端改 response 格式**

修改 `crates/edda-serve/src/lib.rs` 的 `get_log` handler。但需要 Rust 改動 + 重新 build。

**選項 C（務實折衷）：雙邊都改**

- Edda: 在 `LogEntry` 加 `type` alias 和 `summary` alias（backward compatible）
- Thyra: 處理 `{ events: [...] }` 包裝

### 工作量估計

| 改動 | 影響檔案 | 複雜度 |
|---|---|---|
| Thyra: 修 `queryEventLog()` | `src/edda-bridge.ts` | 小（~10 行） |
| Thyra: 修 test mock | `src/edda-bridge.test.ts` | 小 |
| Edda: 改 LogEntry struct | `crates/edda-serve/src/lib.rs` | 中（需 Rust build） |

## ✅ Edda 其他 API 不需改動

Edda 的核心 API（`/api/decisions`、`/api/decide`、`/api/note`、`/api/decisions/:id/outcomes`）**全部與 Thyra 期望完全匹配**。這是之前 issue #4 對齊工作的成果。

---

# 三 Repo 整合 Action Items

## P0：必須修才能跑通

| # | Repo | Issue | 問題 | 修法 | 工作量 |
|---|---|---|---|---|---|
| **K-1** | Karvi | [karvi#442](https://github.com/fagemx/karvi/issues/442) | Webhook payload 格式 mismatch | 改 `emitWebhookEvent()` | 中 |
| **E-1** | Thyra | [thyra#57](https://github.com/fagemx/thyra/issues/57) | `queryEventLog()` 無法解析 Edda response | 修 Thyra adapter | 小 |
| **T-1** | Thyra | [thyra#58](https://github.com/fagemx/thyra/issues/58) | 一鍵啟動 script | 新增 `scripts/dev-all.sh` | 小 |

## P1：跑通後應補

| # | Repo | Issue | 問題 | 說明 |
|---|---|---|---|---|
| **T-2** | Thyra | [thyra#59](https://github.com/fagemx/thyra/issues/59) | Edda monitor 未自動啟動 | `index.ts` 加 `eddaBridge.startMonitor()` |
| **T-3** | Thyra | [thyra#60](https://github.com/fagemx/thyra/issues/60) | smoke test step 7 是模擬 webhook | 加真實 webhook 驗證（blocked by karvi#442） |
| **K-2** | Karvi | [karvi#445](https://github.com/fagemx/karvi/issues/445) | `step_timeout_sec` 只存不 enforce | Phase 2 再處理 |
| **K-3** | Karvi | [karvi#446](https://github.com/fagemx/karvi/issues/446) | `usage_limits` 只存不 enforce | 目前靠 Thyra budget gate |

## P2：加分項

| # | Repo | Issue | 問題 | 說明 |
|---|---|---|---|---|
| **K-4** | Karvi | [karvi#447](https://github.com/fagemx/karvi/issues/447) | Webhook 無 retry | fire-and-forget，失敗不重試 |
| **E-2** | Edda | [edda#266](https://github.com/fagemx/edda/issues/266) | `GET /api/log` 缺 `tags` | Thyra 端 optional，不阻塞 |

---

## 最大未知風險（更新）

之前有三個未知，現在經過 code 審計，狀態更新為：

| 風險 | 之前 | 現在 | 結論 |
|---|---|---|---|
| Karvi webhook payload 格式 | ❓ 不確定 | 🔴 **確認 mismatch** | 必須修（K-1） |
| Karvi controls 消化方式 | ❓ 不確定 | 🟡 **存但不 enforce** | 不阻塞，靠 Thyra budget gate |
| Edda API response 格式 | ❓ 不確定 | 🟢 **5/6 完全匹配** | 只有 `/api/log` 需修（E-1） |

---

*一句話：需要修的東西比想像中少。K-1（webhook 格式）+ E-1（log 格式）+ T-1（啟動 script）修完，三服就能跑通。*
