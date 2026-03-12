# DecisionEngine v0.2 — Phase 1.5 ~ Phase 4 演進路線

> 前置文件：`docs/DECISION_ENGINE_V01.md`（Phase 1 rule-based 設計）
> 核心原則：**LLM 逐步接管語義理解，但永遠不接管邊界、授權、執行。**

---

## 0. 總原則

### 永遠不給 LLM 的

- Constitution 最終邊界判定
- RiskAssessor 的 hard gate（7 SI）
- Karvi dispatch 的最終允許權
- Approval policy（low/medium/high 分級）
- Budget ceiling 判定
- Rollback 強制規則

### 可以逐步交給 LLM 的

- Law 語義理解（Phase 2）
- Edda precedent 綜合判讀（Phase 2）
- Candidate actions 排序（Phase 2）
- Chief personality 的細膩投射（Phase 2）
- Candidate actions 生成（Phase 2.5）
- Law proposal 草案撰寫（Phase 2.5）
- 短期計畫形成（Phase 3）
- 跨 Village 協調（Phase 4）

### 不可逆守則

任何 Phase 的 LLM 都必須：

1. 產出符合 typed schema 的結構化輸出
2. 失敗時 fallback 到上一個 Phase 的 rule-based 邏輯
3. 所有 LLM 輸出經過 deterministic filter 才能進入執行流
4. 系統失去 LLM 時仍能正常運作（graceful degradation）

---

## Phase 1.5：Rule-based 穩定化

> **目標**：讓 Phase 1 的 rule-based engine 穩定跑 Blog Village 3~10 輪。
> **不接 LLM。** 這階段是為 LLM 建立 baseline。

### 1.5.1 Blog Village 實際運行

Phase 1 設計了流水線規則（research → draft → review → publish），
但還沒有真正的 Village 定義來驅動它。

**需要做的**：

- 建立 Blog Village 的 Constitution（禁區、預算、權限）
- 建立 editor-chief 的 Chief（personality: conservative, constraints）
- 建立 4 個 verified Skills：`research_topic`, `draft_content`, `review_content`, `publish_content`
- 建立至少 3 條 active Laws（主題配比、發布節奏、草稿門檻）
- 跑完整 loop：手動 start → observe → decide → act → evaluate → complete

**驗收**：cycle 能穩定完成 research → draft → review → publish → complete，至少 3 輪。

### 1.5.2 Evaluation Harness

接 LLM 之前必須有 baseline，否則不知道 LLM 是變好還變壞。

#### Cycle KPI 記錄

在 `loop_cycles` 或 audit_log 中追蹤：

```typescript
interface CycleMetrics {
  cycle_id: string;
  // 效率
  actions_executed: number;
  actions_blocked: number;
  actions_pending: number;
  // 成本
  budget_used_ratio: number;      // cost_incurred / budget_total
  // 治理
  laws_proposed: number;
  laws_enacted: number;
  laws_rolled_back: number;
  // 判例
  edda_queries: number;
  edda_hits_used: number;         // precedent 真的影響了決策
  // 品質
  reasoning_completeness: number; // reasoning.factors.length + precedent_notes.length
}
```

Phase 1.5 先用 append-only audit_log 記錄（`entity_type='cycle_metrics'`），不加新 table。

#### Replay 能力

```typescript
interface DecideSnapshot {
  context: DecideContext;      // 當時的完整 input
  result: DecideResult;        // 當時的 output
  timestamp: string;
  engine_version: string;      // 'phase1' | 'phase2-advisor' | ...
}
```

每次 `decide()` 被呼叫時，把 snapshot 存入 audit_log（`action='decide_snapshot'`）。
後續可以用同一組 context 餵給不同版本的 engine 做 A/B 比較。

#### Golden Test Fixtures

從真實的 Blog Village 運行中提取 3~5 個代表性 `DecideContext`：

- 冷啟動（無 intent、無 history）
- 流水線中段（research 完成、等 draft）
- 預算即將用盡
- 有負面 Edda 判例
- 有 law rollback 歷史

凍結成 test fixtures，每個 Phase 升級時必須通過。

### 1.5.3 DoD（Phase 1.5 完成標準）

- [ ] Blog Village 穩定跑完 3 輪完整流水線
- [ ] CycleMetrics 每輪記錄到 audit_log
- [ ] DecideSnapshot 每次 decide 記錄
- [ ] 至少 1 次 law proposal 被觸發
- [ ] 至少 1 次 Edda precedent 影響了候選排序
- [ ] 3~5 個 golden fixtures 凍結
- [ ] Replay：同一 context 餵兩次，deterministic 產出相同結果

---

## Phase 2：LLM Advisor Mode

> **目標**：LLM 作為決策顧問，輔助排序和推理，但不做最終決定。
> Rule-based pipeline 仍是主流程，LLM 是可選增強。

### 2.1 架構：LLM 是 selectBest() 的插件

```
                                  ┌───────────────┐
candidates[] ──→ rule-based rank ──→ LLM re-rank? ──→ final selection
                                  └───────────────┘
                                    可選，可降級
```

DecisionEngine 的四層不變。只在 `selectBest()` 內部加一個可選步驟：

```typescript
class DecisionEngine {
  constructor(
    // ... 現有依賴
    private llmAdvisor?: LlmAdvisor,  // optional DI
  ) {}

  private async selectBest(candidates: ActionIntent[], ctx: DecideContext): Promise<ActionIntent | null> {
    // Step 1: rule-based 排序（Phase 1 邏輯，不變）
    const ranked = this.rankByRules(candidates, ctx);

    // Step 2: LLM 調整（可選）
    if (this.llmAdvisor && ranked.length > 1) {
      try {
        const advised = await this.llmAdvisor.rerank(ranked, ctx);
        return advised;
      } catch {
        // LLM 失敗 → fallback 到 rule-based 結果
      }
    }

    return ranked[0] ?? null;
  }
}
```

### 2.2 LlmAdvisor Interface

```typescript
interface LlmAdvisor {
  /**
   * 對候選 actions 重新排序 + 調整 confidence。
   * 回傳最佳候選。失敗時 throw（由上層 fallback）。
   */
  rerank(candidates: ActionIntent[], ctx: DecideContext): Promise<ActionIntent>;

  /**
   * 為已選定的 action 生成人類可讀的 reasoning。
   * 失敗時回傳 null（由上層用 rule-based reasoning）。
   */
  generateReasoning(action: ActionIntent, ctx: DecideContext): Promise<DecisionReasoning | null>;

  /**
   * 建議 law proposal。失敗時回傳 []。
   */
  suggestLawProposals(ctx: DecideContext): Promise<LawProposalDraft[]>;
}
```

### 2.3 LLM Prompt Contract

LLM 的 system prompt 基於現有的 `buildChiefPrompt()`（已存在於 `chief-engine.ts:204-261`），
擴充為 Decision Advisor prompt：

```markdown
## Role
You are the decision advisor for chief "{name}" in village "{village_id}".
Your role is to help rank candidate actions, not to make final decisions.

## Chief Personality
{buildChiefPrompt() output}

## Current Situation
- Cycle: {cycle_id}, iteration {iteration}/{max_iterations}
- Budget: {budget_remaining}/{budget_total} ({budget_ratio}%)
- Last action: {last_action.type} → {last_action.status}
- Intent: {intent.goal_kind} / stage: {intent.stage_hint}

## Active Laws
{laws formatted as list}

## Edda Precedents
{precedents formatted as list, with is_active flag}

## Candidate Actions
{candidates formatted as numbered list with confidence}

## Your Task
1. Rank the candidates from best to worst
2. Adjust confidence (0-1) for each
3. Explain your ranking in 2-3 sentences
4. If any law should be modified, suggest it

## Output Format (JSON)
{schema}
```

### 2.4 LLM Output Schema（Zod 驗證）

```typescript
const AdvisorOutputSchema = z.object({
  selected_index: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  reasoning: z.object({
    summary: z.string().min(1).max(500),
    factors: z.array(z.string()).min(1).max(10),
    precedent_notes: z.array(z.string()).max(5),
    law_considerations: z.array(z.string()).max(5),
    personality_effect: z.string().max(200),
  }),
  law_suggestions: z.array(z.object({
    category: z.string(),
    description: z.string(),
    trigger: z.string(),
  })).max(3),
});
```

LLM 回傳不符合 schema → safeParse 失敗 → fallback 到 rule-based。
不做 retry。一次機會。

### 2.5 LLM Client 最小實作

```typescript
interface LlmClient {
  complete(prompt: string, options?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    timeout_ms?: number;
  }): Promise<string>;
}
```

Phase 2 只需要一個 `complete()` 方法。不需要 streaming、tool use、function calling。

**Provider 優先序**：Anthropic Claude API → 可替換（DI）。
**預設配置**：`temperature: 0.3`, `max_tokens: 1000`, `timeout: 10s`。
**成本**：每次 decide 呼叫一次 LLM。在 CycleMetrics 裡記錄 LLM cost。

### 2.6 共存模式

Phase 2 不取代 Phase 1。兩者共存：

```typescript
// 啟動時
const llmClient = process.env.LLM_API_KEY
  ? new AnthropicClient(process.env.LLM_API_KEY)
  : null;
const advisor = llmClient ? new LlmAdvisorImpl(llmClient) : undefined;
const engine = new DecisionEngine(db, ..., advisor);
```

沒有 `LLM_API_KEY` → 純 rule-based，行為等同 Phase 1。
有 key 但 LLM 掛了 → 每次 fallback 到 rule-based，audit_log 記錄 `llm_fallback`。

### 2.7 評估指標

比較 rule-only vs rule+advisor：

| 指標 | 怎麼量 |
|------|--------|
| 排序一致率 | advisor 和 rule-based 選同一個候選的比例 |
| confidence 校準 | 高 confidence 的 action 是否更常 executed（而非 blocked） |
| reasoning 可讀性 | 人類主觀評分（Phase 2 先手動） |
| 成本增加 | LLM API 費用 vs budget 比例 |
| fallback 率 | LLM 失敗/parse 失敗次數 |
| cycle 完成率 | 有無 advisor 的 cycle 完成比例差異 |

### 2.8 DoD（Phase 2 完成標準）

- [ ] LlmAdvisor 可選 DI，沒有 key 時系統正常運作
- [ ] LLM output 經過 Zod safeParse 驗證
- [ ] LLM 失敗 → 自動 fallback，audit_log 記錄
- [ ] Golden fixtures：rule-only 和 rule+advisor 產出都通過
- [ ] 至少跑 5 輪 Blog Village with advisor，reasoning 品質人工確認
- [ ] CycleMetrics 增加 `llm_calls`, `llm_cost`, `llm_fallbacks`

---

## Phase 2.5：LLM Candidate Generator

> **目標**：LLM 不只排序，還能產生新候選。但所有候選經過 deterministic filter。

### 2.5.1 擴充 LlmAdvisor

```typescript
interface LlmAdvisor {
  // Phase 2（保留）
  rerank(...): Promise<ActionIntent>;
  generateReasoning(...): Promise<DecisionReasoning | null>;
  suggestLawProposals(...): Promise<LawProposalDraft[]>;

  // Phase 2.5（新增）
  generateCandidates(ctx: DecideContext): Promise<CandidateIntentDraft[]>;
}
```

### 2.5.2 CandidateIntentDraft

LLM 產出的是 draft，不是最終 ActionIntent：

```typescript
interface CandidateIntentDraft {
  task_key: string;                    // LLM 提議的 task
  payload?: Record<string, unknown>;
  estimated_cost: number;
  reason: string;
}
```

### 2.5.3 Deterministic Filter Pipeline

LLM 產出的每個 draft 必須通過：

```
1. task_key 存在於 SkillRegistry（verified skill）→ 否則丟棄
2. estimated_cost ≤ budget_remaining → 否則丟棄
3. Chief constraints must_not 檢查 → 違反則丟棄
4. Constitution rules pre-check → 違反則丟棄
5. 不重複已在 candidates[] 裡的 → 重複則丟棄
```

通過 filter 的 draft 轉成 ActionIntent，合併到 rule-based 候選裡一起進 selectBest()。

### 2.5.4 安全底線

- LLM 候選最多 3 個（hardcode 上限）
- 被 filter 丟棄的候選記錄到 audit_log（`action='llm_candidate_filtered'`）
- 如果 LLM 產出 0 個有效候選 → 回退到純 rule-based 候選

### 2.5.5 DoD

- [ ] LLM 能提出 rule-based 不會產出的候選
- [ ] 所有 LLM 候選經過 5 步 filter
- [ ] 被丟棄的候選有完整 audit trail
- [ ] 不劣化：cycle 完成率不低於 Phase 2

---

## Phase 3：LLM Planner Mode

> **目標**：decide 不只選下一步，還能形成 2~4 步短期計畫。
> 升級 CycleIntent → PlanState v1。

### 3.1 PlanState v1

Phase 1 的 `CycleIntent` 只有 4 個欄位。Phase 3 升級：

```typescript
interface PlanState {
  // 從 CycleIntent 繼承
  goal_kind: string;
  stage_hint: string;
  origin_reason: string;
  last_decision_summary: string;

  // Phase 3 新增
  objective: string;                    // 具體目標描述
  planned_steps: PlannedStep[];         // 接下來 2~4 步
  completed_steps: CompletedStep[];     // 已完成的步驟
  fallback: string;                     // 如果主計畫失敗的備案
  success_criteria: string;             // 怎樣算成功
  stop_condition: string;              // 什麼時候該停
}

interface PlannedStep {
  task_key: string;
  reason: string;
  depends_on?: string;                  // 前一步的 task_key
  estimated_cost: number;
}

interface CompletedStep {
  task_key: string;
  status: 'executed' | 'blocked' | 'skipped';
  actual_cost: number;
  outcome_summary: string;
}
```

### 3.2 Plan Repair

LLM 在每個 iteration 可以修改 plan：

- review 被擋 → 修稿而不是繼續 publish
- publish 後效果差 → 追加 evaluate 而不是開新主題
- 預算不夠 → 縮減後續步驟

Plan repair 仍然經過 deterministic filter（task_key 驗證、budget 檢查）。

### 3.3 Edda 深度整合

Phase 3 的 Edda 查詢不只是 `queryDecisions()`，還要：

- **Plan retrieval**：查過去成功的 plan 模式
- **Failed trajectory avoidance**：查過去同 stage 失敗的原因
- **Cross-cycle continuity**：上一個 cycle 的 plan 結果影響這一個 cycle

需要 Edda 新增查詢能力（或用現有 keyword search 模擬）。

### 3.4 DB 變更

`loop_cycles.intent` 欄位從存 `CycleIntent` JSON 升級為存 `PlanState` JSON。
向下相容：parse 時檢查有沒有 `planned_steps` 欄位，沒有就當 CycleIntent。

### 3.5 DoD

- [ ] PlanState 能跨 iteration 持續
- [ ] LLM plan repair 至少成功修正 1 次被擋的流水線
- [ ] Edda 的 plan/trajectory 查詢有實際效果
- [ ] 計畫品質可評估（用 golden fixtures 比較 plan 合理性）

---

## Phase 4：Multi-Village / Territory Brain

> **目標**：跨 Village 協調決策。
> **前提**：至少一個 Village（Blog Village）穩定跑了 2+ 週。

### 4.1 場景

- Blog Village 與 Newsletter Village 共享主題研究
- Research Village 給 Blog Village 提供素材
- Territory-level policy 影響所有 Village 的 budget 分配

### 4.2 架構

```
Territory DecisionEngine
  ├── Village A DecisionEngine
  ├── Village B DecisionEngine
  └── Shared Edda precedents
```

Territory 層級的 decide 不直接控制 Village 的 action，
而是影響 Village 的 context（budget allocation、shared laws、skill routing）。

### 4.3 LLM 角色

- 跨 Village 協調建議
- 資源分配推理
- Law conflict 解釋
- Territory planning

### 4.4 需要的基礎設施

- Territory-level CycleMetrics
- Cross-village audit query
- Shared precedent pool
- Territory-scoped laws（影響多個 village）
- 現有 `TerritoryCoordinator` + `skill_shares` 擴充

### 4.5 DoD

- [ ] 至少 2 個 Village 可以協作（一個提供素材，一個消費）
- [ ] Territory-level policy 影響 Village 行為
- [ ] Cross-village precedent 被引用
- [ ] 不做完整 Nation 層級（Phase 5+）

---

## 時間優先序

```
Phase 1    ← DECISION_ENGINE_V01.md（已設計）
  ↓
Phase 1.5  ← Blog Village 穩定 + Evaluation Harness + Replay
  ↓
Phase 2    ← LLM Advisor（排序 + reasoning）
  ↓
Phase 2.5  ← LLM Candidate Generator（生成 + deterministic filter）
  ↓
Phase 3    ← LLM Planner（PlanState + plan repair）
  ↓
Phase 4    ← Multi-Village Territory Brain
```

### 每個 Phase 的前提條件

| Phase | 前提 |
|-------|------|
| 1.5 | Phase 1 實作完成，Blog Village Skills/Laws 建立 |
| 2 | Phase 1.5 穩定跑 3+ 輪，golden fixtures 凍結，CycleMetrics 有 baseline |
| 2.5 | Phase 2 advisor 運行 5+ 輪，fallback 率 < 20%，reasoning 品質確認 |
| 3 | Phase 2.5 candidate generator 穩定，filter 擋下率可接受 |
| 4 | Phase 3 planner 在單 Village 穩定 2+ 週 |

**如果任何 Phase 的 DoD 沒完成，不進入下一個 Phase。**

---

## 不做清單（全文件範圍）

- 不做 LLM fine-tuning
- 不做 multi-turn conversation（每次 decide 是獨立 prompt）
- 不做 LLM tool use / function calling（Phase 2~2.5 只用 structured output）
- 不做完整 IDE / editor 整合
- 不做 Nation 層級治理
- 不做 LLM 自主修改 Constitution（永遠不做）
- 不讓 LLM 繞過 RiskAssessor（永遠不做）
