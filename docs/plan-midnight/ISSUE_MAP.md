# Midnight Market — 全局 Issue Map

> 2026-03-16 snapshot
> 4 repos, 67 open issues

---

## 數量統計

| Repo | Total Open | 今天新開 | Midnight Market 相關 |
|------|-----------|---------|---------------------|
| **Thyra** | 37 | 22 | 37 |
| **Karvi** | 18 | 8 | 11 |
| **Völva** | 10 | 8 | 10 |
| **Edda** | 19 | 0 | **0** ← 問題 |

**Edda 完全沒有 Midnight Market 相關 issue。**

---

## 按功能域分類

### 🔵 World API（基礎，Batch 1）

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #178 | Thyra | WorldManager orchestrator | 🔴 worktree 代碼待救 |
| #180 | Thyra | World API schemas | ✅ merged |
| #182 | Thyra | Pack/apply endpoint | 🔴 worktree 代碼待救 |
| #183 | Thyra | World API routes | 🔴 blocked by #178 |

### 🟤 Market Domain（基礎，Batch 1）

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #206 | Thyra | Market domain model (zones/stalls/slots) | 🔴 |
| #207 | Thyra | Market state API routes | 🔴 |

### 🟡 Night Template（Batch 2）

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #196 | Thyra | Market template YAML | 🔴 |
| #197 | Thyra | Template seeding test | 🔴 |

### 🟣 Chief Autonomy — 決策 + 排程（Batch 3 核心）

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #198 | Thyra | Chief decision protocol（6 responsibilities） | 🔴 |
| #199 | Thyra | Governance scheduler | 🔴 |
| #200 | Thyra | Inter-chief coordination | 🔴 |

### 🟣 Chief Autonomy — 架構升級

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #211 | Thyra | Chief pipelines field | 🔴 P0 |
| #212 | Thyra | Scheduler → Karvi dispatch | 🔴 被 #228 包含 |
| #213 | Thyra | Department hierarchy | 🔴 P1 |
| #214 | Thyra | Worker role | 🔴 P1 |
| #225 | Thyra | Goal hierarchy（知道為什麼做） | 🔴 P1 |
| #226 | Thyra | Monthly budget auto-pause | 🔴 P1 |
| #227 | Thyra | Chief config versioning | 🔴 P2 |
| #228 | Thyra | Heartbeat protocol | 🔴 P1 |
| #229 | Thyra | Execution adapter registry | 🔴 P1 |
| #231 | Thyra | Stale detection + auto-cleanup | 🔴 P1 |
| #232 | Thyra | Per-operation telemetry | 🔴 P1 |

### 🔴 Evaluator + Reward

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #215 | Thyra | Evaluator layer in judge | 🔴 P1 |
| #216 | Thyra | Reputation + reward system | 🔴 P2 |

### 🟢 Edda Integration（Thyra 側）

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #185 | Thyra | Edda precedent recording in WorldManager | 🔴 P1 |
| #222 | Thyra | Chief queries Edda before decisions | 🔴 P1 |
| #223 | Thyra | Pipeline results → Edda | 🔴 P1 |
| #224 | Thyra | Summary queries Edda for insights | 🔴 P1 |

### 🔷 Skill Infrastructure

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #219 | Thyra | Skills table extension | 🔴 P1 |
| #220 | Thyra | Skill content API | 🔴 P1 |
| #221 | Thyra | Skill upload endpoint | 🔴 P1 |
| #218 | Thyra | MiroFish simulate skill | 🔴 P2 |
| #513 | Karvi | Read skills from Thyra API | 🔴 |

### 🔶 LLM Configuration

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #217 | Thyra | Village LLM config (3 presets) | 🔴 P1 |
| #510 | Karvi | Per-step model selection | 🔴 |
| #68 | Völva | LLM preset selection in conversation | 🔴 P1 |

### 🟠 Karvi Pipeline Engine

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #505 | Karvi | Pipeline CRUD API | 🔴 P0 |
| #506 | Karvi | Step-type dynamic registration | 🔴 P2 |
| #507 | Karvi | Conditional branching | 🔴 P0 |
| #508 | Karvi | Gate step type | 🔴 P0 |
| #511 | Karvi | Async external service calls | 🔴 P1 |
| #512 | Karvi | Simulate-before-apply template | 🔴 P2 |
| #514 | Karvi | Task priority queue | 🔴 |
| #515 | Karvi | Dynamic worker pool | 🔴 |
| #516 | Karvi | Batch dispatch + completion callback | 🔴 |

### 🟩 Platform Adapters + Owned Surface

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #209 | Thyra | Platform adapter interface | 🔴 P0 |
| #210 | Thyra | X + Discord adapters | 🔴 P1 |
| #201 | Thyra | World health metrics | 🔴 P0 |
| #202 | Thyra | SSE pulse endpoint | 🔴 P0 |
| #208 | Thyra | Night summary generator | 🔴 P1 |
| #203 | Thyra | Tonight page scaffold | 🔴 P0 |
| #204 | Thyra | Morning summary page | 🔴 P1 |
| #205 | Thyra | Checkout / commerce | 🔴 P1 |

### 🟦 Völva Cards（用戶組建介面）

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| #61 | Völva | PipelineCard | 🔴 P0 |
| #62 | Völva | OrgCard | 🔴 P1 |
| #63 | Völva | Read skills from Thyra | 🔴 P0 |
| #64 | Völva | Register pipelines on settlement | 🔴 P0 |
| #65 | Völva | EvaluatorCard | 🔴 P1 |
| #66 | Völva | AdapterCard | 🔴 P1 |
| #67 | Völva | CommerceCard | 🔴 P1 |
| #68 | Völva | LLM preset selection | 🔴 P1 |
| #46 | Völva | ThyraClient pack/apply alignment | 🔴 P0 |
| #49 | Völva | Card version history | 🔴 P1 |

### ❌ Edda（0 個 Midnight Market issue）

Edda 現有 19 個 open issues 全是 chronicle/narrative 相關（舊產品方向），沒有任何 Midnight Market 治理記憶相關。

---

## ⚠️ 問題：Edda 掉隊了

Thyra 有 4 個 Edda integration issues（#185, #222, #223, #224），但都是 **Thyra 側呼叫 Edda API**。

**Edda 自己呢？** 它需要：

1. **Decision query 優化** — chiefs 每 15 分鐘查先例，要快
2. **Precedent 分析能力** — 不只是存，要能「找出類似的」「發現重複模式」
3. **世界級 precedent** — 目前 Edda 存的是 per-decision。Midnight Market 需要 per-village 的歷史視角
4. **Telemetry 接收** — 接收 governance cycle 的 telemetry 數據做趨勢分析
5. **Summary 數據供應** — Morning summary 需要查 Edda 拿歷史對比

---

## 建議：Edda 需要開的 issues

| Issue | 內容 | 為什麼 |
|-------|------|--------|
| Precedent similarity search | 查先例不只是 keyword match，要語義相似 | Chiefs 查「上次類似的降價」需要 |
| Village-scoped decision history | Per-village 的決策歷史視角 | 目前 Edda 是 flat 的 |
| Telemetry ingestion endpoint | 接收 governance cycle telemetry | Thyra #232 的數據要存到 Edda |
| Recurring pattern detection | 自動發現重複出現的問題 | Summary #224 需要 |
| Edda API performance for hot path | Decision query 要 < 100ms | Chiefs 每 15 min 查，不能慢 |

---

## 執行優先級建議

### Phase 1: 世界能跑起來（2-3 週）

```
Thyra:  #178 + #182 + #183 (World API)
        #206 + #207 (Market domain)
        #196 + #197 (Template + seeding)
        #198 + #199 (Chief decision + scheduler)
        #201 + #202 (Health + SSE)
        #203 (Tonight page scaffold)
Karvi:  #505 (Pipeline CRUD)
        #507 + #508 (Branching + Gate)
Völva:  #46 (ThyraClient alignment)
```

### Phase 2: 世界更聰明（+2-3 週）

```
Thyra:  #211 + #228 + #229 (Pipeline + Heartbeat + Adapters)
        #215 (Evaluator)
        #219 + #220 (Skill infrastructure)
        #225 (Goal hierarchy)
        #185 + #222 + #223 (Edda integration)
Karvi:  #510 (Per-step model)
        #513 (Read skills from Thyra)
        #514 + #515 (Priority + Pool)
Völva:  #61 + #63 + #64 (Pipeline + Skills + Settlement)
Edda:   需要開 issues
```

### Phase 3: 世界完整（+4-6 週）

```
Thyra:  #200 + #208 + #210 (Coordination + Summary + Adapters)
        #226 + #231 + #232 (Budget + Stale + Telemetry)
        #213 + #214 (Hierarchy + Worker)
        #224 (Summary + Edda insights)
Karvi:  #511 + #516 (Async service + Batch)
Völva:  #62 + #65 + #66 + #67 + #68 (Org/Eval/Adapter/Commerce/LLM cards)
        #204 + #205 (Summary page + Checkout)
Edda:   Precedent search + Village history + Pattern detection
```

### Phase 4: 延伸（之後）

```
Thyra:  #216 (Reward) + #217 (P2 multi-provider) + #218 (MiroFish) + #227 (Config versioning)
Karvi:  #506 (Dynamic step types) + #512 (Simulate template)
```
