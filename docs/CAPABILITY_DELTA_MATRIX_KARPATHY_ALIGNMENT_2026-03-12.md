# Capability Delta Matrix: Karpathy "Bigger IDE" × Thyra

**Date**: 2026-03-12

## Product Layer Mapping

| Product Layer | 負責什麼 | 狀態 |
|---|---|---|
| **Command Center UI** | Agent Board / Policy Drawer / Timeline / Run Detail | 🔲 未開始 |
| **Aggregate API (BFF)** | UI 聚合 endpoint + event stream | 🔲 未開始 |
| **Org Runtime** | Governance kernel — 已是核心優勢 | ✅ 完成 |
| **Execution Bridge** | Karvi dispatch + webhook | ✅ 完成 |
| **Memory Bridge** | Edda decide + query + precedents | ✅ 完成 |
| **Host Fabric** | SSH / remote / multi-machine | 🔲 未開始 |

## Detailed Capability Matrix

| # | Capability | Karpathy Vision | Thyra Status | Gap | Phase |
|---|---|---|---|---|---|
| 1 | Agent Autonomy | Agent 能自主執行任務 | ✅ Chief + Loop Runner + Skill binding | — | Done |
| 2 | Governance Model | 明確的權限邊界 | ✅ Constitution（不可變）+ permissions 子集約束 | — | Done |
| 3 | Risk-based HITL | 高風險需人類確認 | ✅ Low/Medium/High 三級制 | — | Done |
| 4 | Safety Invariants | 硬性安全底線 | ✅ 7 條 SI 硬編碼，不可覆寫 | — | Done |
| 5 | Execution Dispatch | Agent 能觸發外部動作 | ✅ Karvi bridge（dispatch task/project） | — | Done |
| 6 | Event Feedback | 執行結果回傳 | ✅ Webhook v1 envelope + normalizeKarviEvent | — | Done |
| 7 | Decision Memory | 記住過去的決策 | ✅ Edda bridge（decide + query） | — | Done |
| 8 | Audit Trail | 所有行為可追溯 | ✅ audit_log append-only + query API | — | Done |
| 9 | Budget Control | 資源使用限制 | ✅ Constitution budget + Karvi sync | — | Done |
| 10 | Law Lifecycle | 規則提案/評估/執行 | ✅ LawEngine + Edda ledger | — | Done |
| 11 | Governance Schemas | 跨 repo 契約格式 | ✅ v1 schemas（patch/policy/metric/decision） | — | Done |
| 12 | Territory Federation | 跨 village 協作 | ✅ TerritoryCoordinator + agreements | — | Done |
| 13 | Skill Registry | Agent 能力管理 | ✅ verified binding + prompt builder | — | Done |
| 14 | Loop Precedents | 歷史決策注入 | ✅ Edda precedents → loop decide | — | Done |
| 15 | E2E Integration | 三 repo 能實際跑通 | 🔶 Smoke test 已寫（15 步），待三 server 驗證 | 驗證環境 | P0 |
| 16 | Aggregate API | UI 聚合 endpoint | 🔲 需要 /api/control/* BFF 層 | 新增模組 | P1 |
| 17 | Event Stream | 即時看到 agent 行為 | 🔲 目前只有 REST polling | SSE/WS | P1 |
| 18 | Agent Board UI | Agent 列表 + 狀態 + 操作 | 🔲 無 | 前端開發 | P1 |
| 19 | Policy Drawer UI | Constitution/permissions/budget 可視化 | 🔲 無 | 前端開發 | P1 |
| 20 | Activity Timeline UI | 整合 audit + karvi + edda | 🔲 無 | 前端開發 | P1 |
| 21 | Run Detail UI | Loop 狀態 / decision / cost | 🔲 無 | 前端開發 | P1 |
| 22 | UI Naming Adapter | 內核語意 → UI 語意 | 🔲 village→workspace, chief→agent 等 | 翻譯層 | P1 |
| 23 | Org Templates | 可 fork agent team 配置 | 🔲 無 | 新功能 | P2 |
| 24 | Multi-agent Coord | 多 agent 衝突解決 | 🔶 edda coordination 基礎存在 | 實際衝突處理 | P2 |
| 25 | Host Inventory | 多機器管理 | 🔲 無 | 新 service | P3 |
| 26 | SSH / Remote Attach | 跨機器 terminal | 🔲 無 | 基礎設施 | P3 |
| 27 | Session Continuity | Reconnect / recover | 🔲 無 | 基礎設施 | P3 |
| 28 | Auto Rollback | 失敗時自動回滾 | 🔲 無 | 新功能 | P4 |
| 29 | Strategy Recommend | 從歷史學習最佳策略 | 🔶 Edda precedents 注入已有 | 主動推薦 | P4 |
| 30 | IDE Extension | VS Code / CLI 整合 | 🔲 無 | 另一入口 | P3+ |

## Legend

- ✅ = 已實現，有測試覆蓋
- 🔶 = 部分實現或有基礎設施
- 🔲 = 尚未開始

## Summary by Phase

| Phase | Items | 狀態 |
|---|---|---|
| **Done** | #1–#14（治理核心 + 三 repo 整合） | ✅ 14/30 |
| **P0** | #15（E2E 實際驗證） | 🔶 smoke test ready |
| **P1** | #16–#22（Command Center MVP — BFF + Event Stream + 4 UI 畫面） | 🔲 7 items |
| **P2** | #23–#24（Org Templates + Multi-agent） | 🔲 2 items |
| **P3** | #25–#27, #30（Host Fabric + IDE Extension） | 🔲 4 items |
| **P4** | #28–#29（Rollback + Strategy） | 🔲 2 items |

## 護城河評估

| 護城河 | 描述 | 當前強度 |
|---|---|---|
| **Governance Kernel** | Constitution + SI + Risk + Audit — 大多數 agent 工具沒有 | 🟢 強 |
| **Agent State Model** | agent / session / task / host / usage 資料核心 | 🟡 有基礎，需 aggregate |
| **Org Runtime** | Build / run / manage / fork agent teams | 🟡 有模型，需模板化 |
| **Cross-machine Fabric** | Multi-host attach / recover / continuity | 🔴 未開始 |

## 結論

**治理核心 100% 完成。下一步是「讓人看見」— Aggregate API + Command Center UI。**

不是加更多 governance 功能，而是 **驗證 → 可視化 → 整合**。

---

*Generated from dual-AI analysis (Claude + GPT) on 2026-03-12.*
