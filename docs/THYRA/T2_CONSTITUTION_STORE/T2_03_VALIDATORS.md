# T2_03: Validators

> **Layer**: L1
> **Dependencies**: T2_02
> **Blocks**: T2_04, T3（Chief 用 checkPermission）, T4（Law 用 checkRules）, T5（Risk 用 checkBudget）
> **Output**: `checkPermission`, `checkBudget`, `checkRules` 函數 export

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T2_CONSTITUTION_STORE.md  # Step 4 驗證工具定義
cat src/constitution-store.ts            # 確認 T2_02 完成
```

---

## 實作

在 `src/constitution-store.ts` 底部加 export：

```typescript
export function checkPermission(constitution: Constitution, permission: Permission): boolean {
  return constitution.allowed_permissions.includes(permission);
}

export function checkBudget(constitution: Constitution, amount: number, type: 'per_action'|'per_day'|'per_loop'): boolean {
  const key = { per_action: 'max_cost_per_action', per_day: 'max_cost_per_day', per_loop: 'max_cost_per_loop' }[type];
  return amount <= constitution.budget_limits[key as keyof BudgetLimits];
}

export function checkRules(constitution: Constitution, chiefId: string): { allowed: boolean; violated: ConstitutionRule[] } {
  // framework: 遍歷 rules，具體 match 在 T4 Law Engine 定義
  const violated: ConstitutionRule[] = [];
  for (const rule of constitution.rules) {
    const inScope = rule.scope.includes('*') || rule.scope.includes(chiefId);
    if (!inScope) continue;
    // match 邏輯 placeholder
  }
  return { allowed: violated.length === 0, violated };
}
```

---

## 驗收

```bash
bun run build
# checkPermission('dispatch_task') on constitution with ['dispatch_task'] → true
# checkPermission('deploy') on same → false
# checkBudget(3, 'per_action') with limit 10 → true
# checkBudget(15, 'per_action') with limit 10 → false
```
