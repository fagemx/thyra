# T5_01: Safety Invariants + Types

> **Layer**: L2
> **Dependencies**: T1_02（DB Layer）, T2_01（Constitution 型別）
> **Blocks**: T5_02
> **Output**: `SAFETY_INVARIANTS` 常數 + `Action` / `AssessmentResult` 型別

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-12（Safety Invariants 7 條）
cat docs/THYRA/T5_RISK_ASSESSOR.md     # Step 1 型別, Step 2 SI
cat src/schemas/constitution.ts        # Constitution, BudgetLimits, Permission
bun run build
```

---

## 實作

### Action 型別

```typescript
export interface Action {
  type: string;
  description: string;
  initiated_by: string;            // chief id 或 human id
  village_id: string;
  estimated_cost: number;
  reason: string;
  rollback_plan?: string;
  grants_permission?: Permission[];
  cross_village?: boolean;
  metadata?: Record<string, unknown>;
}
```

### AssessmentResult 型別

```typescript
export interface AssessmentResult {
  level: 'low' | 'medium' | 'high';
  blocked: boolean;                // SI 違反 → true
  reasons: AssessmentReason[];
  budget_check: { per_action, per_day, per_loop };
}

export interface AssessmentReason {
  source: 'safety_invariant' | 'constitution' | 'heuristic';
  id: string;
  message: string;
  severity: 'block' | 'high' | 'medium' | 'low';
}
```

### 7 條 Safety Invariants（硬編碼）

| ID | 檢查 | 訊息 |
|----|------|------|
| SI-1 | `type !== 'disable_human_override'` | 人類隨時可以按停止鍵 |
| SI-2 | `!!action.reason` | 所有 AI 決策必須有理由鏈 |
| SI-3 | `rollback_plan !== undefined` | 自動執行必須可回滾 |
| SI-4 | `estimated_cost <= max_cost_per_action` | 單次花費不得超過上限 |
| SI-5 | `grants_permission ⊆ allowed_permissions` | 不得授予超出 Constitution 的權限 |
| SI-6 | `type !== 'delete_constitution'` | 不得自動刪除人類 Constitution |
| SI-7 | `!cross_village \|\| both_constitutions_allow` | 跨村莊需雙方同意 |

完整程式碼見 `T5_RISK_ASSESSOR.md` Step 2。

---

## 驗收

```bash
bun run build
# SAFETY_INVARIANTS 陣列 length = 7
# 任何 API 都不能修改 SI 內容
```
