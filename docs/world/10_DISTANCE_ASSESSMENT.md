# Distance Assessment

> 狀態：`snapshot` — 2026-03-15
>
> 目的：誠實記錄目前離 Product Vision v0 的距離，以及最短 demo 路徑。

---

## 1. 已完成的部分

### Governance Runtime（Thyra 核心）— 100%

- Village Manager — ✅
- Constitution Store — ✅
- Chief Engine — ✅
- Law Engine — ✅
- Risk Assessor — ✅
- Loop Runner — ✅
- Skill Registry — ✅
- Territory Coordinator — ✅
- Karvi Bridge — ✅
- Edda Bridge — ✅
- 12 route files, 259+ tests — ✅

### World 模組 — 80%

- assembleWorldState — ✅
- applyChange（13 change types）— ✅
- judgeChange（4-layer pipeline）— ✅
- snapshot / loadSnapshot / listSnapshots — ✅
- diffWorldState — ✅
- rollbackChange（v1 intent-only）— ✅
- verifyContinuity — ✅
- listPendingChanges — ✅
- World API schemas — ✅ #180 merged
- E2E test（10-step proof, 79 tests pass）— ✅

缺：
- WorldManager orchestrator — ❌ #178（worktree 有代碼待救）
- World API routes — ❌ #183
- Pack/apply endpoint — ❌ #182（worktree 有代碼待救）

### Village Pack Compiler — 100%

- 5-phase compile — ✅
- CLI — ✅
- Export — ✅

### Völva（人類入口）— 40%

- 骨架 + DB + LLM layer — ✅
- Card system（in-memory）— ⚠️ #33 待修
- Conductor state machine — ✅
- Settlement builder — ✅
- ThyraClient — ⚠️ #46 待對齊
- 實際跑通完整對話→建世界 — ❌

---

## 2. 沒做的部分

### Template 抽象 — 0%

- Market / Town / Port 模板概念 — 只有概念文件
- Template schema — ❌
- 模板 → Village Pack 的轉換 — ❌

### Domain Pack 機制 — 0%

- Pack 可插拔架構 — ❌
- Pet / Farm / Creator / Festival packs — ❌
- Pack → skills/laws 的映射 — ❌

### AI Chiefs 自主營運 — 0%

這是最大的缺口。

- Chief 持續決策 loop — ❌（LoopRunner 有骨架但不是自主營運）
- Chief 之間的衝突解決 — ❌
- Chief 提案 → judge → apply 自動化 — ❌
- 「世界自己在動」的核心機制 — ❌

### 活著的感覺（UI / 可視化）— 0%

- 世界健康度指標 — ❌
- 即時脈搏（數字在跳）— ❌
- 改值 → 影響鏈可視化 — ❌
- Dashboard — ❌（T8 只有 scaffold）

### Midnight Market exemplar — 0%

- Market 模板定義 — ❌
- 攤位/人流/價格/活動 state model — ❌
- Event/Economy/Safety/Lore chiefs — ❌
- 真實入口（人可以進來互動）— ❌
- 商業化接口 — ❌

---

## 3. 總覽

| 層 | 狀態 | 離 Product Vision 多遠 |
|----|------|----------------------|
| 治理引擎（Thyra core） | ✅ 完成 | 0 — 已經到位 |
| 世界底層（state/change/judge） | ✅ 大部分完成 | 差 API routes + orchestrator |
| 模板系統（Template × Pack） | ❌ 0% | 只有概念，沒有任何代碼 |
| 自主營運（AI chiefs 自己跑） | ❌ 0% | 最大缺口 |
| 活的感覺（UI / 可視化） | ❌ 0% | 完全沒有 |
| Midnight Market（第一個 exemplar） | ❌ 0% | 還沒開始 |
| Völva（人類入口） | ⚠️ 40% | 骨架在，核心功能待補 |

---

## 4. 最短 demo 路徑

目標：跑通「打開看到世界在呼吸，改一個值看它跳」。

```
Step 1: 完成 WorldManager + pack/apply         [1-2 天]
        救回 worktree 代碼，commit + merge

Step 2: 加 World API routes                     [1 天]
        7 個 endpoint 掛到 index.ts

Step 3: 最小 Dashboard                          [2-3 天]
        一個數字在跳 + 改值按鈕 + 即時回饋

Step 4: 一個 hardcoded Market template YAML     [1 天]
        Midnight Market 的 founding document

Step 5: 用 pack/apply 建立 Midnight Market      [< 1 天]
        POST /api/villages/pack/apply

Step 6: 接 LoopRunner 讓 chiefs 自動跑          [3-5 天]
        世界開始自己在動
```

**預估：2-3 週可以有最小 demo。**

完整的 Midnight Market（攤位、人流、活動、真實入口）— 幾個月。

---

## 5. Open Issues 追蹤

### Thyra（P0 — minimum world 閉環）

| Issue | Title | Status |
|-------|-------|--------|
| #178 | WorldManager orchestrator | worktree 有代碼待救 |
| #180 | World API schemas | ✅ merged |
| #182 | Pack/apply endpoint | worktree 有代碼待救 |
| #183 | World API routes | blocked by #178, #180 |

### Thyra（P1 — bridge 整合）

| Issue | Title | Status |
|-------|-------|--------|
| #185 | Edda precedent recording | blocked by #178 |
| #186 | Karvi dispatch integration | blocked by #178 |
| #187 | Cycle↔world-state sync | blocked by #178 |
| #188 | Phase 2 rollback (DB restoration) | blocked by #178, #183 |

### Völva（P0-P1）

| Issue | Title | Status |
|-------|-------|--------|
| #33 | CardManager DB persistence | P0, open |
| #34 | CLI message persistence | P0, open |
| #37 | Settlement lifecycle | P1, open |
| #38 | GP-2 full E2E test | P1, open |
| #46 | ThyraClient alignment | P0, blocked by thyra#182 |
| #47 | Settlement confirmation flow | P1, open |
| #48 | Settlement integration tests | P1, open |
| #49 | Card version history | P1, open |
