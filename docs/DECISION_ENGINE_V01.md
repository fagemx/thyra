# DecisionEngine v0.1 — Phase 1 輕量版設計

> 三 repo 交會點：把 `LoopRunner.decide()` 從 Phase 0 stub 升格為獨立決策模組。
> Phase 1 = rule-based，不需要 LLM。Phase 2 才接 LLM。

---

## 0. 現狀與問題

### 現在的 `decide()` 做了什麼

```typescript
// loop-runner.ts:224-258
async decide(chief, activeLaws, observations, villageId): Promise<Decision | null> {
  // 查 Edda precedent → 丟掉結果
  // 檢查有沒有 proposed law → 回 null
  // 有 edda_refs → 回 null
  // 預設 → 回 null
}
```

Phase 0 永遠回 `null`，loop 啟動後立刻結束。

### 為什麼這是核心問題

`decide()` 是三個 repo 的唯一交會點：

- 讀 **Constitution**（邊界）+ **Law**（策略）← Thyra 內部
- 讀 **Edda precedent**（判例）← Edda Bridge
- 產出 **Action**（意圖）→ Karvi dispatch
- 投射 **Chief personality**（風格）← Chief Engine

如果 decide 不活，整個系統只是一組 CRUD API。decide 活了，才真的是「AI 治理 AI」。

### 為什麼要拆出獨立模組

現有的責任分配：

| 模組 | 角色 |
|------|------|
| LoopRunner | 循環調度器（when/how to iterate） |
| RiskAssessor | 憲法邊界檢察官（can/cannot） |
| LawEngine | 立法程序器（propose/approve/rollback） |
| ConstitutionStore | 不可變治理框架 |
| ChiefEngine | 人格與權限管理 |
| **DecisionEngine** | **策略大腦（what/why/how confident）** ← 新增 |

`decide()` 的邏輯已經超出 LoopRunner 的職責。如果全塞在 LoopRunner 裡，
它會變成 God class，違反現有的模組拆分風格。

---

## 1. 依賴圖位置

```
constitution-store ← chief-engine
                   ← law-engine
                   ← risk-assessor
                   ← skill-registry

所有以上 + edda-bridge → decision-engine → loop-runner
```

`DecisionEngine` 是依賴最重的模組。它讀取所有治理元件的狀態，但**不直接修改任何狀態**。
所有副作用（dispatch、propose law、record audit）由 `LoopRunner` 根據 `DecideResult` 執行。

**大腦可以思考，但不能自我授權。**

### 檔案路徑

```
src/decision-engine.ts       ← DecisionEngine class + 內部型別
src/decision-engine.test.ts  ← 測試
```

不在 `src/schemas/` 建立對外 schema。Phase 1 的型別邊界在模組內部。

---

## 2. 型別定義

### 2.1 DecideContext — 結構化情勢（內部型別）

取代現在 `observe()` 回傳的 `Record<string, unknown>[]`。

```typescript
interface DecideContext {
  // 從 LoopCycle 提取
  cycle_id: string;
  village_id: string;
  iteration: number;
  budget_total: number;
  budget_remaining: number;
  budget_ratio: number;              // remaining / total, 0-1

  // 從 actions[] 推導
  last_action: LoopAction | null;
  completed_action_types: string[];  // 已完成的 action 類型列表
  pending_approvals: number;         // status=pending_approval 的數量
  blocked_count: number;             // status=blocked 的數量

  // 從 audit_log 查詢
  recent_rollbacks: number;          // 最近 24h 內 law rollback 數量
  recent_loop_outcomes: LoopOutcome[]; // 最近 3 輪 loop 結果

  // 從 Edda 查詢（graceful degradation）
  edda_precedents: EddaDecisionHit[];
  edda_available: boolean;

  // 直接傳入
  chief: Chief;
  constitution: Constitution;
  active_laws: Law[];

  // 意圖狀態（從 loop_cycles.intent 讀取）
  intent: CycleIntent | null;
}

interface LoopOutcome {
  cycle_id: string;
  status: 'completed' | 'timeout' | 'aborted';
  actions_executed: number;
  cost_incurred: number;
}

interface CycleIntent {
  goal_kind: string;        // e.g. 'content_pipeline', 'strategy_review', 'maintenance'
  stage_hint: string;       // e.g. 'research', 'draft', 'review', 'publish', 'evaluate'
  origin_reason: string;    // 為什麼開始這個 cycle
  last_decision_summary: string;
}
```

### 2.2 ActionIntent — 結構化意圖（取代 free-string Decision）

```typescript
interface ActionIntent {
  kind: 'dispatch_task' | 'propose_law' | 'request_approval' | 'wait' | 'complete_cycle';
  task_key?: string;                    // 對應 SkillRegistry 的 skill name
  payload?: Record<string, unknown>;    // task-specific 參數
  estimated_cost: number;
  rollback_plan: string;
  reason: string;
  evidence_refs: string[];              // edda event_id 列表
  confidence: number;                   // 0-1，人格 + 判例影響
}
```

`task_key` 不是 free string。它必須對應 SkillRegistry 中一個 verified skill。
Phase 1 用 SkillRegistry 做解析；如果找不到對應 skill，DecisionEngine 不產出該 intent。

### 2.3 LawProposalDraft — 法律提案草案

```typescript
interface LawProposalDraft {
  category: string;
  content: {
    description: string;
    strategy: Record<string, unknown>;
  };
  evidence: {
    source: string;           // 'decision_engine'
    reasoning: string;        // 為什麼要改
    edda_refs: string[];      // 參考了哪些判例
  };
  trigger: string;            // 什麼觸發了這個提案（e.g. '3 consecutive low performers'）
}
```

DecisionEngine 只產出 draft。LoopRunner 負責呼叫 `LawEngine.propose()` 執行。

### 2.4 DecisionReasoning — 結構化推理（SI-2 要求）

```typescript
interface DecisionReasoning {
  summary: string;               // 一句話結論
  factors: string[];             // 考慮了哪些因素
  precedent_notes: string[];     // 判例如何影響決策
  law_considerations: string[];  // 哪些 law 影響了選擇
  personality_effect: string;    // chief 人格如何影響
}
```

### 2.5 DecideResult — 最終輸出

```typescript
interface DecideResult {
  action: ActionIntent | null;          // 這輪要做什麼（null = 結束 cycle）
  law_proposals: LawProposalDraft[];    // 順便提案改什麼策略
  reasoning: DecisionReasoning;         // 完整推理鏈
  updated_intent: CycleIntent | null;   // 更新後的意圖狀態
}
```

---

## 3. DecisionEngine Class

```typescript
export class DecisionEngine {
  constructor(
    private db: Database,
    private constitutionStore: ConstitutionStore,
    private chiefEngine: ChiefEngine,
    private lawEngine: LawEngine,
    private skillRegistry: SkillRegistry,
    private eddaBridge?: EddaBridge,
  ) {}

  /**
   * 主入口。LoopRunner 每個 iteration 呼叫一次。
   */
  async decide(cycle: LoopCycle, chief: Chief, constitution: Constitution): Promise<DecideResult>;

  // --- 內部四層 ---

  /** 第 1 層：把 raw state 轉成 DecideContext */
  private buildContext(cycle: LoopCycle, chief: Chief, constitution: Constitution): Promise<DecideContext>;

  /** 第 2 層：根據 context 產生候選 actions */
  private generateCandidates(ctx: DecideContext): ActionIntent[];

  /** 第 3 層：排序、篩選、套用人格偏好 */
  private selectBest(candidates: ActionIntent[], ctx: DecideContext): ActionIntent | null;

  /** 第 4 層：檢查是否需要提案 law 修改 */
  private checkLawProposals(ctx: DecideContext): LawProposalDraft[];
}
```

### 不做的事

- 不呼叫 `RiskAssessor.assess()` — 那是 LoopRunner 的責任
- 不呼叫 `LawEngine.propose()` — 只回傳 draft，由 LoopRunner 執行
- 不呼叫 `KarviBridge.dispatch()` — 只產出 intent，由 LoopRunner dispatch
- 不直接寫 audit_log — 由 LoopRunner 記錄
- 不修改 DB 任何 table — 純查詢 + 計算

---

## 4. 四層決策邏輯（Phase 1 Rule-based）

### 第 1 層：buildContext()

```
輸入：LoopCycle + Chief + Constitution
查詢：
  - cycle.actions[] → last_action, completed_action_types, pending/blocked counts
  - audit_log → recent_rollbacks（24h 內 law rollback）
  - loop_cycles → recent_loop_outcomes（最近 3 輪）
  - cycle.intent → CycleIntent
  - eddaBridge.queryDecisions() → edda_precedents（domain=villageId）
  - lawEngine.getActiveLaws() → active_laws
輸出：DecideContext
```

Edda 查詢 graceful degradation：offline 時 `edda_precedents = []`, `edda_available = false`。

### 第 2 層：generateCandidates()

Phase 1 用 **流水線規則** 產生候選。

```
規則 1：如果沒有 intent 且沒有 active laws → complete_cycle（沒有策略可執行）

規則 2：如果有 intent，根據 stage_hint 產生下一步
  research 完成 → draft_content
  draft 完成 → review_content
  review 完成且通過 → publish_content
  publish 完成 → complete_cycle

規則 3：如果沒有 intent 但有 active laws → 開始新流水線
  找到第一個可執行的 law → 設 intent + 產生 research 候選

規則 4：如果有 pending_approval → wait（不產生新 action，等人審）

規則 5：如果 budget_ratio < 0.1 → complete_cycle（預算不足）

規則 6：如果 blocked_count >= 3 → complete_cycle（連續被擋）
```

每個候選的 `task_key` 必須在 SkillRegistry 中有對應的 verified skill。
找不到 → 跳過該候選。

### 第 3 層：selectBest()

Phase 1 的「排序」主要靠 Chief personality：

```
conservative chief:
  - 有負面 edda precedent → 降低 confidence
  - budget_ratio < 0.3 → 傾向 complete_cycle
  - 候選 estimated_cost > budget_remaining * 0.5 → 跳過

moderate chief:
  - 預設行為，不額外調整

aggressive chief:
  - 有正面 edda precedent → 提高 confidence
  - 允許較高 cost 比例
  - 傾向繼續而不是提前結束
```

Constraints（must/must_not/prefer/avoid）也在這層套用：
- `must_not` match → 移除候選
- `prefer` match → 提高排序
- `avoid` match → 降低排序

### 第 4 層：checkLawProposals()

Phase 1 只做一個簡單觸發：

```
規則：如果最近 3 輪 loop 的同 category action 都失敗或被 rollback
  → 產出 LawProposalDraft，建議調整該 category 的策略

規則：如果某 law 的 effectiveness.verdict === 'harmful' 且還是 active
  → 產出 LawProposalDraft，建議 revoke 或修改
```

Phase 2 會用 LLM 做更精細的策略推理。

---

## 5. runLoop() 新控制流

### 現在的流程

```
for each iteration:
  observe → decide → risk assess → record action
```

### Phase 1 流程

```
for each iteration:
  1. COMPREHEND
     ctx = decisionEngine.buildContext(cycle, chief, constitution)

  2. DECIDE
     result = decisionEngine.decide(cycle, chief, constitution)

  3. PROPOSE LAWS (if any)
     for draft in result.law_proposals:
       lawEngine.propose(villageId, chiefId, draft)
       record in cycle.laws_proposed

  4. ACT (if action exists)
     if result.action is null → finishCycle('completed')
     if result.action.kind === 'wait' → skip to next iteration
     if result.action.kind === 'complete_cycle' → finishCycle('completed')
     if result.action.kind === 'propose_law' → already handled in step 3
     if result.action.kind === 'dispatch_task':
       a. resolve skill via SkillRegistry
       b. build Action for RiskAssessor
       c. riskAssessor.assess(action, context)
       d. if blocked → record blocked action
       e. if medium/high → record pending_approval
       f. if low → execute (dispatch to Karvi if available)
       g. record action + cost

  5. UPDATE INTENT
     persist result.updated_intent to cycle.intent

  6. RECORD
     appendAudit with result.reasoning
     if eddaBridge available: fire-and-forget record decision to Edda

  7. yield (allow abort signal processing)
```

### 關鍵設計決策

**Law proposal 在 action 之前。** 因為 Blog Village 的 loop 設計是：
`觀察 → 分析 → 提案(law) → 風險評估 → 執行 → 評估 → 記錄`

Law 提案是 loop 的正規步驟，不是 side effect。

**Karvi dispatch 是可選的。** 如果 KarviBridge offline，action 仍然可以被記錄為 executed
（表示 Thyra 本地執行），或降級為 pending。這保持了現有的 graceful degradation 模式。

---

## 6. DB Schema 變更

### loop_cycles 加 intent 欄位

```sql
ALTER TABLE loop_cycles ADD COLUMN intent TEXT DEFAULT NULL;
```

存 JSON：`CycleIntent | null`。

讀寫方式與現有的 `actions`（JSON array）一致：

```typescript
// 寫
db.prepare('UPDATE loop_cycles SET intent = ? WHERE id = ?')
  .run(JSON.stringify(intent), cycleId);

// 讀（在 deserialize 裡）
intent: row.intent ? JSON.parse(row.intent as string) : null,
```

不需要新 table。不需要 migration script（SQLite `ALTER TABLE ADD COLUMN` 是即時的）。

---

## 7. SkillRegistry 擴充

### 新增 resolveForIntent() 方法

```typescript
class SkillRegistry {
  // 已有
  get(id: string): Skill | null;
  getByNameVersion(name: string, version: number, villageId?: string): Skill | null;
  list(filters?): Skill[];

  // 新增
  resolveForIntent(taskKey: string, villageId: string): Skill | null {
    // 找 name === taskKey 且 status === 'verified' 且 (village_id === villageId || village_id IS NULL)
    // 回傳最新版本
  }
}
```

這讓 DecisionEngine 在 generateCandidates() 時可以驗證 task_key 是否可執行。
不可執行（skill 不存在或未 verified）的候選會被過濾掉。

---

## 8. Edda 查詢策略

### Phase 1 查詢

```typescript
// 在 buildContext() 中
const precedents = await eddaBridge.queryDecisions({
  domain: villageId,          // village-scoped
  keyword: lastAction?.type,  // 查同類 action 的歷史
  limit: 10,
});
```

比現在的 `{ domain: 'law', keyword: villageId }` 更精準。

### 查詢結果如何影響 decide

1. **正面判例**（value 含 'effective'/'success'）→ 提高候選 confidence
2. **負面判例**（value 含 'harmful'/'rollback'/'failed'）→ 降低 confidence 或移除候選
3. **覆蓋判斷**（is_active=false 的舊決策被新的 supersede）→ 以最新為準

Phase 2 會用 LLM 做更深的語義理解。Phase 1 用 keyword matching 就夠。

---

## 9. 與現有測試的關係

### 不破壞現有測試

`LoopRunner.decide()` 的 signature 會改變（呼叫 DecisionEngine），
但現有測試的預期行為（Phase 0 回 null → loop 立刻結束）必須保持相容。

策略：如果沒有 active laws 且沒有 intent → DecisionEngine 回 `action: null`，
效果等同現在的 `return null`。

### 新增測試覆蓋

| 測試 | 預期 |
|------|------|
| 無 active law、無 intent → action: null | cycle completed |
| 有 active law、無 intent → 開始新流水線 | action: dispatch_task(research) |
| intent stage=research + last_action=executed → 進 draft | action: dispatch_task(draft) |
| pending_approval 存在 → wait | action: wait |
| budget_ratio < 0.1 → 結束 | action: complete_cycle |
| conservative chief + 負面判例 → 降低 confidence | confidence < 0.5 |
| aggressive chief + 正面判例 → 提高 confidence | confidence > 0.8 |
| 連續 3 輪失敗 → law proposal | law_proposals.length > 0 |
| task_key 無對應 verified skill → 過濾掉 | 不產出該候選 |
| Edda offline → 正常運作 | edda_available=false, precedents=[] |
| 全 blocked → complete_cycle | action: complete_cycle |
| reasoning 完整 → SI-2 滿足 | reasoning.summary 非空 |

---

## 10. Phase 邊界

| | Phase 1（本文件） | Phase 2（未來） |
|---|---|---|
| 候選產生 | 流水線規則 + Law 匹配 | LLM 理解 Law 語義 |
| 判例理解 | keyword matching | LLM 綜合推理 |
| 人格投射 | confidence 權重調整 | LLM prompt 內嵌人格 |
| Law 提案 | 效果指標觸發 | LLM 推理策略調整 |
| reasoning | 結構化欄位拼裝 | LLM 生成自然語言 |
| SituationSnapshot | 內部 DecideContext | 可能外化為 versioned schema |
| PlanState | CycleIntent（4 欄位） | 完整 PlanState 狀態機 |

**Phase 2 的前提**：Phase 1 跑穩、Blog Village 至少完成 3 輪自治循環。

**Phase 2 不改的**：RiskAssessor 和 Karvi gate 仍然是 deterministic。
不能把界線放給 LLM 自己判。

---

## 11. 實作順序

### Step 1：骨架 + 型別

- 建立 `src/decision-engine.ts`
- 定義所有內部型別（DecideContext, ActionIntent, DecideResult 等）
- 實作 `buildContext()`：從 DB + Edda 組裝 context
- `decide()` 暫時回 `action: null`（與 Phase 0 等效）
- 測試：現有 loop 測試不壞

### Step 2：SkillRegistry.resolveForIntent() + intent 欄位

- 加 `resolveForIntent()` 到 SkillRegistry
- `loop_cycles` 加 `intent` 欄位
- LoopRunner.deserialize() 支援 intent
- 測試：resolveForIntent 查 verified skill

### Step 3：流水線規則引擎

- 實作 `generateCandidates()` 的 6 條規則
- 實作 `selectBest()` 的人格權重
- 實作 `checkLawProposals()` 的觸發規則
- 測試：上面第 9 節列的全部

### Step 4：runLoop() 改造

- LoopRunner.decide() 改為呼叫 DecisionEngine
- runLoop 控制流改為第 5 節的新流程
- 測試：完整 loop 跑通（有 law → research → draft → complete）

### Step 5：Edda 影響決策

- buildContext() 的 Edda 查詢精準化
- selectBest() 的判例影響 confidence
- 測試：正面/負面判例影響

---

## 12. 不做清單

- 不做 LLM 接入（Phase 2）
- 不做跨 Village 決策（Territory 層級）
- 不做完整 PlanState 狀態機（CycleIntent 4 欄位夠用）
- 不做 versioned 對外 schema（先內部型別）
- 不加新 DB table（只加一個 column）
- 不改 API routes（DecisionEngine 是內部模組）
- 不動 RiskAssessor（它的角色不變）
