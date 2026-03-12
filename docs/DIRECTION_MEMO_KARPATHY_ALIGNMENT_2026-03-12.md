# Direction Memo: Karpathy "Bigger IDE" × Thyra Alignment

**Date**: 2026-03-12
**Contributors**: Claude (architecture analysis) + GPT (product strategy)
**Context**: Karpathy 提出 "Bigger IDE" 願景。本 memo 整合雙 AI 分析，定義 Thyra 的產品方向與下一步行動。

---

## 0. 一句話結論

**用 Karpathy 的外殼，把 Thyra 的內核推到更大的命題裡。**

不做新 IDE。做 **Agent Command Center** — 上層是可見性與控制感，底層是 Thyra 的治理 runtime。

```
Command center on top, governance kernel underneath.
```

---

## 1. 戰略判決

### 不該做的三條錯路

1. **硬做完整 IDE** — 會被 editor / tabs / diff / terminal UX 吞掉，正面撞 Cursor / VS Code / Zed
2. **只做 backend** — 太抽象，外人看不懂價值
3. **把所有 Karpathy 概念塞進 core** — 會把治理模型搞亂

### 正確路線：70/30

- **70% 做自己**：Thyra runtime、policy/audit、org control plane、Karvi/Edda integration
- **30% 借 Karpathy**：命題方式、UI 入口、command center 形態、agent-first 展示

### 產品定位

不是 IDE，而是：

- **Agent Ops for developers**
- **A control plane for coding agents across sessions, tools, and machines**
- 中文：**跨 session、跨工具、跨機器的 AI 開發代理控制中樞**

切到一個比較新、比較空的賽道 — 不跟大玩家搶編輯器入口。

---

## 2. Karpathy "Bigger IDE" 核心主張

- IDE 不再只是編輯器，而是 **agent 的運行環境**
- 人類角色從「寫 code」轉為「審核 / 導航 / 治理」
- Agent 需要 **自主性** 但也需要 **護欄**（governance + guardrails）
- 關鍵能力：agent 能自主行動，但風險行為需要人類確認

## 3. Thyra 為什麼天然適合

Thyra repo 不是 editor 核心，而是 **agent team runtime**：

| Thyra Domain | 本質 |
|---|---|
| village | 組織 / 工作空間隔離 |
| constitution | 可執行治理規則（不可變） |
| chief | 有權限與技能約束的 agent profile |
| law | 自動化規則 / 政策 |
| loop | observe → decide → act 自主迴圈 |
| territory | 跨 village 聯邦 / 共享範圍 |
| Karvi bridge | 執行面 dispatch |
| Edda bridge | 決策與記憶面 |

已經有的治理資料表：villages / constitutions / chiefs / laws / loop_cycles / territories / agreements / audit_log / skills

**這整套是 control plane backend，不是 code editor。**

### Thyra × Karpathy 對應

| Karpathy 概念 | Thyra 對應 |
|---|---|
| Agent autonomy | Chief + Skill binding + Loop Runner |
| Guardrails / governance | Constitution + Safety Invariants（7 條硬編碼） |
| Risk-based HITL | Risk 三級：Low 自動、Medium 人確認、High 人發起 |
| Execution environment | Karvi（dispatch + event webhook） |
| Memory / learning | Edda（decide + query + precedents） |
| Audit trail | audit_log（append-only） |

---

## 4. 產品三層架構

### 表層：Agent Command Center（UI — 可見性 + 操作感）

使用者真正看到和操作的介面。市場共鳴在這裡。

四個核心畫面：

#### A. Agent Board
- Agent 卡片、狀態燈、任務、成本、最近事件
- 狀態 = idle / running / blocked / failed
- 資料來源：`chief` + `loop_cycles` + `karvi project/task`

#### B. Policy Drawer
- Constitution / permissions / budget / laws / safety invariants
- 為什麼能做 / 不能做 — 一般 IDE 沒有，我們有優勢

#### C. Activity Timeline
- 整合 audit + Karvi events + Edda decisions
- 比單純 terminal log 更有產品味

#### D. Run Detail
- Loop 狀態、每次 decision、blocked reason、cost

### 中層：Org Runtime（核心護城河）

定義「一組 agent 如何協作」的可執行結構：

- 角色定義：planner / coder / reviewer / researcher
- 拓撲定義：誰派任務給誰
- Run policy：並行、審批、重試、終止條件
- Template：可以 fork 一套 agent team

**這是真正最值錢的地方。**

### 底層：Machine Fabric（基礎設施 — 難但黏）

多機器、多 session、多 attach：

- Host inventory / SSH / remote attach
- Session health / reconnect / recover
- Agent 分布在哪裡

> 這塊 Thyra 目前缺，需要新增 Host Fabric service，不要硬塞進 village/chief domain。

---

## 5. UI Naming Adapter

內核繼續用 Thyra 自己的語言，UI 對外翻譯成直覺語言：

| Internal (Thyra) | External (UI) |
|---|---|
| village | workspace / org / team |
| constitution | policy / operating rules |
| chief | agent profile / agent role |
| law | automation rule / enacted policy |
| loop | autonomous run / cycle |
| territory | federation / shared scope |

不需要重寫核心，只在上層做 naming adapter。

---

## 6. Aggregate API 設計

不要讓前端直接拼 chiefs / loops / bridges / audit，做一層 BFF：

```
GET /api/control/agents          — agent 列表（chief + loop + karvi 聚合）
GET /api/control/agents/:id      — 單一 agent 詳情
GET /api/control/orgs            — workspace / village 視圖
GET /api/control/timeline        — 整合 audit + karvi + edda
GET /api/control/policies/:vid   — policy panel（constitution + laws + risk）
```

Agent card 組裝方式：
- `agent_id` = chief.id
- `display_name` = chief.name
- `role` = chief.role
- `status` = idle (無 active loop) / running (有 cycle) / blocked (risk/budget) / failed (error)
- `host` = 從 Karvi / future host registry 補
- `usage` = budget + external usage summary

---

## 7. 執行路線圖

### Phase 0（✅ 已完成）：E2E Integration

> 先確保三 repo 能真正跑起來。

Deliverables：
1. ✅ Karvi webhook URL 自動註冊（PR #20）
2. ✅ Audit log 查詢 API（PR #21）
3. ✅ E2E smoke test 15 步全流程（PR #38）
4. ✅ 289 tests, 0 failures, TSC clean

### Phase 1：看見與控制（Command Center MVP）

> 讓使用者覺得：原本很亂，現在終於看得懂。

三件後端工作：
1. **Aggregate API** — UI 專用聚合 endpoint
2. **Event Stream** — SSE/WebSocket（loop updated / law enacted / dispatch sent / karvi event / budget changed）
3. **UI Naming Adapter** — 內核語意 → UI 語意翻譯

四個 UI 畫面：
- Agent Board / Policy Drawer / Activity Timeline / Run Detail

MVP 必須有的 5 功能：
1. Agent List（名稱、任務、狀態、host、最近活動）
2. Session Drill-down（log、terminal、context、usage）
3. Host Inventory（機器、agent 分佈、連線健康度）
4. Command Center Actions（hide/show、pause/resume、open terminal、reattach）
5. Basic Telemetry（active agents、token/cost、runtime、error count）

### Phase 2：模板化協作

- planner-coder-reviewer 模板
- research squad 模板
- issue-to-PR 模板
- 可 fork / 修改 / 管理 agent team

### Phase 3：Org Code + Cross-machine

- Fork agent team + 改 roles / topology / policy
- Host inventory / SSH attach / remote terminal
- Session continuity / recover

### Phase 4：Advanced Governance

- Multi-agent 衝突解決
- 自動 rollback
- 策略推薦（Edda 判例 → 治理建議）

---

## 8. 真正的護城河

不是 UI，是這三個：

### 1. Agent State Model
怎麼定義 agent / session / task / host / usage / topology — 資料核心。

### 2. Org Runtime
別人可以做 dashboard，但不一定能做 build / run / manage / fork agent teams — 未來最值錢。

### 3. Governance Kernel
Constitution + Safety Invariants + Risk gating + Audit — 大多數 agent 工具沒有的。

---

## 9. 商業化路徑（參考）

### Open Source Core
- Local command center / single machine
- Basic telemetry / agent list / session panel
- 目的：擴散

### Pro
- Multi-host / SSH / org templates
- Saved layouts / richer telemetry / history replay
- 目的：重度個人開發者付費

### Team
- Shared org runtime / role templates
- Policy / approvals / audit trail / team dashboards
- 目的：小團隊與企業試探

---

## 10. 差距分析（Capability Delta）

### 已完成 ✅（14/20）
- 完整治理模型：Village → Constitution → Chief → Law → Loop
- Skill Registry 與 verified binding
- Safety Invariants 硬編碼（7 條，不可覆寫）
- 三 repo 整合（Karvi bridge + Edda bridge）
- Webhook 雙向通訊
- 決策追蹤（Edda decide/query）
- Governance v1 schemas（patch / policy / metric / decision）
- Audit log 查詢 API
- Budget control + Karvi sync
- Law lifecycle + Edda ledger
- Loop observe → Karvi events
- Loop decide → Edda precedents
- Territory / Agreement federation
- E2E smoke test（15 步）

### 部分完成 🔶（3/20）
- E2E 實際三 server 驗證（smoke test 已寫，待實際運行）
- Multi-agent 協調（edda coordination 基礎存在）
- 策略推薦（precedents 注入已有，主動推薦未做）

### 尚未開始 🔲（3/20）
- Command Center UI（aggregate API + 四畫面）
- IDE 整合（VS Code extension / CLI）
- Host Fabric（SSH / remote / session continuity）

---

## 11. 核心信念

**Thyra 不是要成為 IDE，而是成為任何 "Bigger IDE" 都需要的治理層。**

```
Karpathy's "Bigger IDE"
    ↓ 需要
Agent Command Center（UI 入口）
    ↓ 驅動自
Thyra Governance Runtime（治理內核 — 我們的位置）
    ↓ 管轄
Karvi Execution Runtime（執行層）
    ↓ 學習自
Edda Decision Memory（記憶層）
```

**走 Karpathy 的入口，但不走 Karpathy 的產品本體。**

---

*Generated from dual-AI analysis (Claude + GPT) on 2026-03-12. Covers Karpathy research alignment, product strategy, and architectural integration plan.*
