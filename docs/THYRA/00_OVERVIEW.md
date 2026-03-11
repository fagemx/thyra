# Thyra — Agent Governance & Capability Layer

## 定位

Thyra 是 AI agent 團隊的**治理層**。解決的問題不是「怎麼讓 AI 跑起來」（Cursor/Claude Code 已經做了），而是：

- **一支 agent 團隊怎麼分工？** — Chief 定義每個 agent 的角色、skill set、行為約束
- **agent 可以自己改策略到什麼程度？** — Constitution（不可改的硬規則）vs Law（AI 可自主調整的軟策略）
- **跑了 100 個任務之後，怎麼讓 agent 自己演化？** — 自治迴圈：觀察 → 決策 → 執行 → 評估 → 修法
- **出事了誰負責、怎麼回滾？** — Risk 分級 + 強制審批 + 回滾快照

**一句話**：Karvi 讓 agent 跑任務，Edda 記住 agent 做過什麼，Thyra 定義 agent **應該怎麼做**和**可以自己改什麼**。

---

## 目標用戶

產品設計給 AI-native 團隊，UX 設計讓非技術角色也能操作。

### 用戶分級

| 層級 | 誰 | 怎麼用 Thyra | 需要懂什麼 |
|------|-----|-------------|-----------|
| **Builder** | 工程師、AI 團隊 lead | 完整功能：寫 Constitution、設計 Chief 人格、開發 Skill、調 Law 參數、設計自治迴圈 | Agent 架構、prompt engineering、策略設計 |
| **Operator** | PM、營運、QA lead | Dashboard 操作：審批 AI 提的 Law（approve/reject）、啟停迴圈、看 Chief 能力地圖、追蹤效果 | 理解業務規則，能判斷「這條策略合不合理」 |
| **Executive** | 老闆、非技術主管 | 模板 + 概覽：從預設模板建 Village（「保守型」「快速迭代型」）、看全局儀表板、設預算上限 | 幾乎不需要技術知識，點按鈕就好 |

### 分級設計原則

- **核心能力不降級** — Constitution / Chief / Skill / Law 的完整表達力保留給 Builder
- **操作介面做簡化** — Operator 只需看到「AI 建議改 review 從 2 人降到 1 人，原因是品質穩定」→ 按 approve 或 reject
- **入口做模板化** — Executive 不需要從零建 Constitution，選「保守型 SaaS 團隊」模板一鍵生成
- **進階路徑暢通** — Executive 用模板建完，隨時可以切到 Builder 視角微調

類比：GitHub — 核心給開發者，Issues/Projects 非技術 PM 也能用，老闆看 Insights 就好。

### 核心痛點（Builder 視角）

| 痛點 | Thyra 解法 |
|------|-----------|
| 「每個 agent 都是 senior，但我想要一個保守的 reviewer + 一個激進的 implementer」 | Chief 人格系統：risk tolerance / skill set / constraints |
| 「agent 自己決定用 2 個 reviewer 還是 1 個，但 deploy 必須人類批准」 | Constitution（hard gate）+ Law（AI adjustable） |
| 「跑了 50 個 PR，review 策略應該根據品質數據自動調整」 | 自治迴圈 + law effectiveness 評估 |
| 「我有 3 個 repo，共用一套 review 標準但各自有特殊規則」 | Village 隔離 + Territory 共享 |
| 「某個 agent skill 在 A 專案驗證有效，想搬到 B 專案」 | Skill registry + Chief 能力規劃 |

---

## 三 Repo 分工

```
Thyra（治理 / 立法）
  ↓ 下發 constitution + law + chief config
Karvi（執行 / 執法）
  ↑ 回報 events + signals + metrics
Edda（記憶 / 判例）
  ↑↓ 歷史決策查詢 + 策略推薦
```

| Repo | 職責 | 類比 |
|------|------|------|
| Karvi | 執行任務、管 step pipeline、控制 runtime | 施工隊 |
| Edda | 記錄決策、追蹤因果、跨 session 記憶 | 檔案室 + 顧問 |
| **Thyra** | **定義 agent 行為規範、規劃能力、管理策略演化** | **管理層** |

---

## 核心概念

### 隱喻體系

| 概念 | 說明 | 技術對應 |
|------|------|---------|
| Village | 一個自治域（通常 = 一個 repo / 一個專案） | project scope + isolation boundary |
| Chief | agent 行為人格 = role + skills + constraints + personality | system prompt template + permission set |
| Constitution | 人類定的硬規則，AI 不能改 | policy-as-code, immutable after creation |
| Law | AI 可在 Constitution 框架內自主調整的策略 | mutable strategy config with audit trail |
| Loop | 有邊界的自治迴圈（固定預算 + 時間 + 目標） | bounded autonomy cycle (Karpathy pattern) |

### Agent 能力規劃

Thyra 管理的不只是「什麼時候跑什麼任務」，而是**整支 agent 團隊的能力架構**：

```
Village "my-saas"
├── Chief "Architect"
│   ├── Skills: [system-design, api-review, perf-audit]
│   ├── Risk: conservative
│   └── Constraints: [must: write ADR, must_not: change DB schema without approval]
│
├── Chief "Implementer"
│   ├── Skills: [coding, testing, refactoring]
│   ├── Risk: moderate
│   └── Constraints: [must: run tests, prefer: small PRs]
│
├── Chief "Reviewer"
│   ├── Skills: [code-review, security-audit]
│   ├── Risk: conservative
│   └── Constraints: [must: check OWASP top 10, avoid: style nitpicks]
│
└── Laws (AI 自主管理)
    ├── "PR < 300 lines → 1 reviewer; > 300 lines → 2 reviewers"
    ├── "CI 連續 green 5 次 → 降低 staging deploy 審批等級"
    └── "新人 Chief 前 10 個任務必須 human review"
```

### Skill Registry

Chief 的能力來自 Skill。Thyra 管理 skill 的生命週期：

```
定義 → 驗證 → 分配給 Chief → 跨 Village 共享 → 版本演化
```

- **Skill = 可重用的 agent 能力單元**（prompt template + tool access + constraints）
- 一個 Chief 可以有多個 Skills
- 同一個 Skill 可以分配給多個 Chiefs
- Skill 在 A 村驗證有效 → 透過 Territory 共享到 B 村

---

## 立法層設計

### 四層治理模型

```
Layer 0: Safety Invariants（硬編碼，任何人都不能改）
  "人類隨時可以按停止鍵"
  "單次花費不超過 $10"
  "所有 AI 決策必須有理由鏈"

Layer 1: Constitution（人類設定，AI 不能改）
  "PR 必須有 review"
  "不得自動 deploy 到 production"
  "每日預算上限 $100"

Layer 2: Law（AI 可在 Constitution 框架內調整）
  "review 數量 = f(PR 大小, 最近品質)"
  "staging deploy = auto if CI green 連續 N 次"
  "N 的值由 Chief 根據數據調整"

Layer 3: Tactics（單次執行決策，不持久化）
  "這個 PR 用 security reviewer 而非 general reviewer"
  "這次 deploy 多等 5 分鐘 warm-up"
```

### Law 生命週期

```
Chief 觀察數據
  → 提議 Law（propose）
    → Risk Assessor 評級
      → Low: 自動生效
      → Medium: 人類審批
      → High: 只有人類能發起
    → 生效後追蹤 effectiveness
      → 有效: 保持
      → 有害: 自動回滾 + 記錄到 Edda 判例
```

### Law 示例

```yaml
# AI 觀察到 PR 品質穩定上升 → 提議降低 review 門檻
law:
  category: code_review
  strategy:
    min_reviewers: 1          # 從 2 降到 1
    auto_approve_threshold: 95  # 品質分 > 95 自動通過
  evidence:
    source: "過去 30 天 PR 品質分: 平均 97, 最低 92"
    reasoning: "品質穩定，降低 review 成本不會增加風險"
    edda_refs: ["dec-xxx"]    # Edda 判例：上次類似調整的結果
  risk: medium                # 需要人類確認
```

---

## 模組清單

| Task | 模組 | 說明 | Phase |
|------|------|------|-------|
| T1 | Village Manager | 域隔離 + CRUD | P0 |
| T2 | Constitution Store | 不可變規則存儲 + 版本鏈 | P0 |
| T3 | Chief Engine | Agent 人格 + skill binding + 權限驗證 | P0 |
| T4 | Law Engine | 立法生命週期 + 合憲性檢查 | P0 |
| T5 | Risk Assessor | 三層風險評估 + Safety Invariants | P0 |
| T6 | Loop Runner | 自治迴圈引擎（observe → decide → act → evaluate） | P0 |
| T7 | Skill Registry | Skill 定義 + 版本 + 跨 Village 共享 | P0 |
| T8 | Dashboard | 治理面板：審批佇列 + 迴圈時間線 + 能力地圖 | P1 |
| T9 | Karvi Bridge | HTTP 橋接：下發任務 + 收事件 | P1 |
| T10 | Edda Bridge | HTTP 橋接：查判例 + 記決策 | P1 |
| T11 | Territory Coordinator | 跨 Village 協調 + Skill 共享 | P2 |

**Phase 0 (MVP): T1-T7, ~50h**
**Phase 1 (Integration): T8-T10, ~30h**
**Phase 2 (Multi-Village): T11, ~20h**

---

## Dependency Graph

```
T1 (Village Manager)
 ├── T2 (Constitution Store)
 │    ├── T4 (Law Engine)
 │    └── T5 (Risk Assessor)
 ├── T3 (Chief Engine)
 │    ├── T4 (Law Engine)
 │    └── T7 (Skill Registry) ←→ T3 互相依賴，但 T7 可先建骨架
 └── T7 (Skill Registry)

T3 + T4 + T5 → T6 (Loop Runner)
T6 → T8 (Dashboard)
T6 → T9 (Karvi Bridge)
T6 → T10 (Edda Bridge)
T1 + T6 + T7 → T11 (Territory)
```

---

## Batch 分配

### Batch 1（基礎 + Skill 骨架）
| Agent | Task |
|-------|------|
| Agent 1 | T1: Village Manager → T2: Constitution Store |
| Agent 2 | T7: Skill Registry（骨架：schema + CRUD，不含跨 Village） |

### Batch 2（引擎層，可並行）
| Agent | Task |
|-------|------|
| Agent 1 | T3: Chief Engine（整合 T7 的 skill binding） |
| Agent 2 | T5: Risk Assessor |

### Batch 3（Law 依賴 T2+T3）
| Agent | Task |
|-------|------|
| Agent 1 | T4: Law Engine |

### Batch 4（整合）
| Agent | Task |
|-------|------|
| Agent 1 | T6: Loop Runner |

### Batch 5（Phase 1，可並行）
| Agent | Task |
|-------|------|
| Agent 1 | T8: Dashboard |
| Agent 2 | T9: Karvi Bridge |
| Agent 3 | T10: Edda Bridge |

---

## Progress Tracker

### Phase 0 — MVP
```
[ ] T1: Village Manager
[ ] T2: Constitution Store
[ ] T3: Chief Engine
[ ] T4: Law Engine
[ ] T5: Risk Assessor
[ ] T6: Loop Runner
[ ] T7: Skill Registry
```

### Phase 1 — Integration
```
[ ] T8: Dashboard
[ ] T9: Karvi Bridge
[ ] T10: Edda Bridge
```

### Phase 2 — Multi-Village
```
[ ] T11: Territory Coordinator
```

---

## 技術棧

| 層 | 選型 | 理由 |
|----|------|------|
| 語言 | TypeScript 5.x | 前後端統一，型別安全 |
| Runtime | Bun (優先) / Node 22+ | 原生 TS、快速啟動 |
| Web Framework | Hono | 輕量、TS-first、跨 runtime |
| UI | React + Vite | Dashboard |
| 資料 | SQLite (better-sqlite3) → Postgres | 本地先跑通 |
| Schema | Zod | runtime validation + TS type |
| 測試 | Vitest | TS 原生 |

---

## 必讀文件

1. **`THYRA/CONTRACT.md`** — 架構契約（必讀）
2. **各 Task 文件** — `T1_VILLAGE_MANAGER.md` 等
3. **`karvi/server/docs/three-repo-architecture.md`** — 三 repo 全景
