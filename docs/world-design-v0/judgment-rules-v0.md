# judgment-rules-v0.md

> 狀態：`working draft`
>
> 型別定義見 `./shared-types.md`。本文件中的型別為簡化參考，以 shared-types.md 為準。
>
> 目的：定義 Thyra 如何對 `change proposal` 做出**可重複、可審計、可回滾**的判斷。
>
> 這份文件不是在講「AI 怎麼想」。
> 它在講：
>
> **世界如何決定某個 change 能不能進來。**

---

## 1. 為什麼這份比 prompt 更重要

如果 `change-proposal-schema-v0.md` 定義的是 Thyra 的句法，
那 `judgment-rules-v0.md` 定義的就是 Thyra 的法庭。

沒有 judge，系統就會退化成：

- chiefs 提一堆建議
- agent 互相辯論
- admin panel 手動按 approve
- outcome 靠事後感覺判斷

這些都不是治理。

Thyra 的核心不是「有很多 agent 在想」，
而是：

> **任何會改變世界的事，都必須先經過 judgment。**

---

## 2. 一句話定義

> **Judgment = 把一個 change proposal 從「想做」變成「可不可以做、怎麼做、現在能不能做」。**

它至少要回答五個問題：

1. 這個 change **定義得夠不夠清楚**？
2. 它會不會**直接把世界弄壞**？
3. 它有沒有**違反硬規則 / 憲法 / 權限邊界**？
4. 它在當下情境下是應該 **approve / reject / simulate / escalate**？
5. 如果做了，之後要怎麼 **觀察後果與回滾**？

---

## 3. Judgment 不是什麼

### 3.1 不是 generic validation
不是只檢查 JSON schema 合不合法。

### 3.2 不是純 LLM 裁判
不能把「最後要不要過」全部交給模型感覺。

### 3.3 不是單一 yes/no gate
真正的輸出不只有 approve / reject，
還包含：

- simulation_required
- escalated
- approved_with_constraints
- approved_until_window_end

### 3.4 不是只看 proposal 本身
judgment 一定要看 proposal + world + time window + precedent + actor authority。

---

## 4. v0 設計原則

### 原則 1：Judge 要無聊
越靠核心的 judgment，越不該有太多「靈感」。

Judge 應該是：
- 穩定
- 可預測
- 可重放
- 可審核

不是：
- 聰明
- 文采好
- 主觀有趣

### 原則 2：Deterministic first
v0 的 final verdict 必須以 deterministic rules 為主。
LLM 可以協助：

- 補 rationale
- 摘要 precedent
- 解釋 conflict

但不應直接取代核心 verdict。

### 原則 3：先判能不能改，再判值不值得改
judgment 分兩層：

1. **legality**：能不能做
2. **advisability**：值不值得做

這兩個不能混。

### 原則 4：judge 的對象是 change，不是人
Chief 不是被判決的主體。
被判的是 proposal。

Chief 只影響：
- 有沒有提案資格
- 權限到哪
- 某類 change 是否要 upgrade risk

### 原則 5：rollback 要預先存在於 judgment 中
不是出了事才想怎麼退。
每個被過的 change，都必須先有 rollback path。

---

## 5. Canonical Verdicts

v0 只保留六種 verdict：

```ts
type Verdict =
| "approved"
| "approved_with_constraints"
| "rejected"
| "simulation_required"
| "escalated"
| "deferred";
```

### approved
可直接套用。

### approved_with_constraints
可以做，但要加限制，例如：
- 只生效 60 分鐘
- 只限單一 zone
- 需附 outcome window
- 自動 rollback

### rejected
不能做，而且不是「晚點再做」，而是這個 proposal 本身有根本問題。

### simulation_required
不能直接上，先做 shadow / dry run / counterfactual。

### escalated
需要更高權限：
- human
- constitution owner
- night lead
- cross-chief approval

### deferred
不是不行，而是**現在不適合做**。
例如：
- 正在活動高峰
- 另一個互斥 change window 尚未結束
- 需要等 outcome window 收斂

---

## 6. Four-Layer Judge Stack

Thyra 的 judge 不應該是一個大黑盒。
v0 應固定成四層。

---

### Layer 0 — Structural Validity
先判 proposal 本身是不是可執行物件。

檢查：
- schema 完整
- target 存在
- diff path 合法
- before/after 可對上目前 snapshot
- rollback plan 存在
- proposal scope 不為空
- change kind 與 target scope 相符

如果這層過不了，直接 `rejected`。

#### 例
- proposal 要改 `zones.zone_x`，但 `zone_x` 不存在
- `before` 值跟目前 snapshot 對不上
- `kind=throttle_entry` 卻 target 到 `stall`

這些都不是高風險，而是結構錯誤。

---

### Layer 1 — Invariants
判 proposal 是否碰到不可違反的硬底線。

這層是 Thyra 最硬的一層。
沒有 negotiate 空間。

可能包含：
- 安全底線
- 預算上限
- 不可逆資產刪除
- 世界核心一致性
- 必須保留 rollback 能力
- 不可使世界進入無法驗證狀態

如果違反 invariants，直接 `rejected` 或 `escalated`。

#### 例
- 將 north_gate 限流設成 0，導致主要入口完全關閉且無替代路徑
- 把 safety threshold 降到低於 constitution floor
- 清空 booking 狀態而沒有 restore snapshot 方案

---

### Layer 2 — Constitution & Authority
這層判的是：**你有沒有資格這樣改**。

檢查：
- proposal 是否違反 constitution
- chief 是否有權提這種 kind
- 是否超出 blast radius 授權
- 是否跨越人類保留權
- 是否需要 human approval
- 是否只能在特定時段做

這層過不了，通常是 `escalated` 或 `rejected`。

#### 例
- Safety Chief 想修改 pricing rule，可能超權
- Event Chief 想直接停整個 market，超過 regional 權限
- 某 law 明定「production-facing pricing changes 需人審」

---

### Layer 3 — Contextual Judgment
這層才判：
> 在當前情境下，做這件事值不值得、該不該直接做、要不要先 simulate。

檢查：
- 是否符合 active laws
- 是否有類似 precedent
- 現在是不是高峰期
- 是否有互斥 proposal 已在 outcome window
- 預期收益與風險是否平衡
- 後果能否在可觀察窗口內看清
- 是否需要先 shadow run

這層的輸出通常是：
- approved
- approved_with_constraints
- simulation_required
- deferred

---

## 7. Why Four Layers

這四層不能混成一層分數，因為它們的性質不同：

| Layer | 問題 | 性質 |
|---|---|---|
| 0 | 這東西是不是合法 proposal 物件？ | 結構 |
| 1 | 會不會直接破壞世界底線？ | 生存 |
| 2 | 有沒有權限這樣改？ | 制度 |
| 3 | 在現在這個情境下應不應該做？ | 治理 |

如果把它們壓成單一「risk score」，
系統會變得很滑，也很難審計。

---

## 8. Judgment Output Schema

> ⚠️ 以下為 judgment-rules 專用的擴展版本。基礎定義見 `./shared-types.md` §6.6。
> 本版本擴展了 `reasons: string[]`、`Constraint[]` typed objects、`RollbackRequirement[]` typed objects。
> 如有衝突，shared-types.md 為 canonical baseline。

```ts
type JudgmentReport = {
id: string;
proposalId: string;
worldId: string;
cycleId: string;

layerResults: {
structural: LayerResult;
invariants: LayerResult;
constitution: LayerResult;
contextual: LayerResult;
};

finalVerdict: Verdict;
finalRiskClass: "low" | "medium" | "high" | "critical";

constraints?: Constraint[];
failedChecks?: string[];
reasons: string[];

simulationPlan?: SimulationPlan;
escalationTarget?: EscalationTarget;
rollbackRequirements?: RollbackRequirement[];

precedentRefs?: string[];
generatedAt: string;
};

type LayerResult = {
verdict: "pass" | "fail" | "warn" | "needs_escalation";
reasons: string[];
};

type Constraint = {
kind:
| "time_limited"
| "scope_limited"
| "metric_guard"
| "auto_rollback"
| "human_confirm_after_apply";
payload: Record<string, unknown>;
};
```

> ⚠️ 本文件的 LayerResult 使用 4 值 layer-level verdict (`pass|fail|warn|needs_escalation`)，
> 與 shared-types.md §6.6 的 `verdict: Verdict`（6 值 proposal-level verdict）不同。
> 這是設計差異：layer verdict 判的是「這層通不通過」，proposal Verdict 判的是「整個 proposal 的最終結果」。

---

## 9. Risk Class v0

風險不是看 proposal 語氣，而是看三件事：

1. **blast radius**
2. **reversibility**
3. **latency of harm**

### Low
- local
- 可快速 inverse patch
- 後果 15–60 分鐘內可觀察

### Medium
- regional
- 可 rollback 但有營運副作用
- 後果 1–6 小時觀察

### High
- global 或多區聯動
- rollback 成本高
- 可能有秩序 / 商業 / 公平副作用

### Critical
- 觸及 invariants / constitution core / irreversible state

---

## 10. Decision Table v0

下面是 v0 最重要的一張表。

| 條件 | Verdict |
|---|---|
| schema / target / diff 不成立 | rejected |
| 違反 invariant | rejected |
| 觸碰 constitution hard gate | escalated |
| 超出 chief authority | escalated |
| high risk 且無 precedent | simulation_required |
| medium risk 且有良好 precedent | approved_with_constraints |
| low risk 且 local / reversible / metrics clear | approved |
| 與開啟中的 outcome window 衝突 | deferred |
| 無法定義 clear outcome window | simulation_required 或 rejected |

---

## 11. Constraint Rules v0

`approved_with_constraints` 不是模糊 approve，
而是加上硬限制。

### 時間限制
例如：
- 只生效 60 分鐘
- 23:00 自動回復 baseline

### 範圍限制
例如：
- 僅 zone_a 生效
- 不得跨 gate 擴散

### 指標護欄
例如：
- complaint_rate 上升超過 15% 即自動 rollback
- conversion 掉超過 10% 即重新 judge

### 人工確認後續
例如：
- 先 apply，但 30 分鐘後若未被 human confirm，自動退回

---

## 12. Simulation Rules v0

不是所有 change 都值得直接 simulate。
simulation 本身也有成本。

### 必須 simulate 的情況
- high risk
- precedent 稀薄
- global blast radius
- 多 proposal bundle 互相牽動
- metric side effects 不易預測
- rollback 代價高

### 可跳過 simulate 的情況
- low risk
- local scope
- reversibility 高
- 前例清晰
- outcome window 可快速判斷

### Simulation Modes
```ts
type SimulationMode =
| "dry_run" // 只跑 legality + estimated outcome
| "shadow" // 在鏡像 state 模擬
| "counterfactual"; // 用基線比較預估影響
```

---

## 13. Authority Matrix v0

judgment 必須看 chief 權限。
v0 先用簡單矩陣。

| Change Kind | Economy Chief | Safety Chief | Event Chief | Human |
|---|---:|---:|---:|---:|
| adjust_stall_capacity | ✅ | ⚠️ | ⚠️ | ✅ |
| adjust_spotlight_weight | ⚠️ | ❌ | ✅ | ✅ |
| throttle_entry | ❌ | ✅ | ⚠️ | ✅ |
| pause_event | ❌ | ✅(緊急) | ✅(局部) | ✅ |
| modify_pricing_rule | ✅ | ❌ | ❌ | ✅ |
| law_patch | ❌ | ❌ | ❌ | ✅ / escalated |
| chief_permission_patch | ❌ | ❌ | ❌ | ✅ only |

說明：
- ✅ 可直接提案
- ⚠️ 可提案但通常要 escalated / cross-chief review
- ❌ 無權提案

---

## 14. Precedent Use Rules v0

precedent 不是用來自動替代 judgment，
而是縮小不確定性。

### 可用 precedent 的條件
- world type 相同
- change kind 相同
- context tag 足夠接近
- metric regime 類似

### precedent 的作用
- 降低 simulation requirement
- 強化 approve 信心
- 附理由鏈
- 提供 side-effect 警告

### precedent 不能做的事
- 不能 override invariant
- 不能 override constitution
- 不能讓無權限 chief 突然有權
- 不能直接當 final verdict

---

## 15. Conflict Rules v0

如果多個 chiefs 在同一 cycle 提出衝突 proposal，
judgment 不能逐條獨立過。

要先做 `bundle conflict resolution`。

### 常見衝突型
1. **Growth vs Safety**
2. **Economy vs Fairness**
3. **Event vs Stability**
4. **Local optimization vs global consistency**

### v0 簡單規則
- Safety > Event > Economy in emergency windows
- Constitution > all chiefs
- active outcome window 未結束時，禁止逆向 proposal 直接覆蓋
- 同 path proposal 不可同時 approved

---

## 16. Deferred Rules v0

`deferred` 很重要，因為不是每個 proposal 都該立刻過。

適用情況：
- 正處於高峰交易窗口
- 重大活動尚未結束
- 另一個同類 change 的 outcome window 還開著
- metrics 噪音太大，現在判不清
- cycle budget 不夠

這一步避免 Thyra 變成「看到什麼都立刻改」。

---

## 17. Canonical Judge Function

v0 核心函式形狀應固定。

```ts
function judgeProposal(
proposal: ChangeProposal,
world: WorldState,
context: JudgmentContext
): JudgmentReport
```

```ts
type JudgmentContext = {
snapshotId: string;
activeLaws: Law[];
constitution: Constitution;
invariants: Invariant[];
chiefAuthority: ChiefAuthorityMap;
openOutcomeWindows: OutcomeWindow[];
precedents: PrecedentRecord[];
cycleMode: "normal" | "peak" | "incident" | "shutdown";
};
```

> WorldMode 與 CycleMode 的映射規則見 `./shared-types.md` §6.2。

內部順序應固定：

```text
validate structure
→ check invariants
→ check authority / constitution
→ evaluate contextual rules
→ compute verdict
→ attach constraints / simulation / escalation
→ emit judgment report
```

---

## 18. Example Judgment — North Gate Throttle

### Proposal
Safety Chief 提出：
- north gate 限流 60 分鐘
- maxPerMinute 120 → 80

### Judge 結果
- Layer 0: pass
- Layer 1: pass
- Layer 2: pass
- Layer 3: warn

原因：
- medium risk
- precedent 存在但不是完全同情境
- 正處尖峰時段
- total_entry_volume 可能受影響

### Final Verdict
`approved_with_constraints`

### Constraints
- 生效 60 分鐘
- total_entry_volume 跌超過 10% 自動 rollback
- complaint_rate 未下降則 30 分鐘後重新 judge

這種 judgment 才叫治理，不是單純過或不過。

---

## 19. What v0 Deliberately Does Not Do

v0 不做以下複雜化設計：

- multi-world federated judgment
- legal negotiation between chiefs
- learned risk scorer replacing rules
- constitutional amendment workflow
- market/game/port 共通高抽象 meta-rules
- chain settlement aware judgment

這些都留到 v1+。

v0 的目標是：

> **先把一個 world 的 change judgment 做得硬、穩、可審計。**

---

## 20. 工程落點

如果這份要變成代碼，最小需要這幾個模組：

```text
src/judge/
validate-proposal.ts
check-invariants.ts
check-authority.ts
check-contextual-rules.ts
build-judgment-report.ts
risk-classifier.ts
simulation-policy.ts
conflict-resolver.ts
```

建議不要把這些揉進 generic engine。
judge 應該有自己的明確邊界。

---

## 21. 最後一句

> **Thyra 不是因為有很多 chiefs 才像治理系統。**
>
> **Thyra 是因為每個 world change 都必須先經過一套穩定、可審計、可回滾的 judgment rules，才開始像治理系統。**

---

相關文件：
- `canonical-cycle.md` — 世界循環定義
- `change-proposal-schema-v0.md` — 變更提案 schema
- `world-cycle-api.md` — API 映射
- `pulse-and-outcome-metrics-v0.md` — 脈搏與後果
- `midnight-market-canonical-slice.md` — 最小實例
- `shared-types.md` — 跨文件型別