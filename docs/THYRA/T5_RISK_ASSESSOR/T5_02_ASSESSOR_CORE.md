# T5_02: Risk Assessor Core

> **Layer**: L2
> **Dependencies**: T5_01, T2_02（ConstitutionStore）
> **Blocks**: T5_03, T5_04, T6
> **Output**: `src/risk-assessor.ts` — RiskAssessor class（三層檢查）

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T5_RISK_ASSESSOR.md     # Step 3 完整 class
cat src/constitution-store.ts          # Constitution, ConstitutionRule
bun run build
```

---

## 關鍵行為

`assess(action, ctx) → AssessmentResult`

### 三層檢查順序

1. **Layer 1 — Safety Invariants**
   - 遍歷 7 條 SI，任何失敗 → `severity: 'block'`
   - 有 block → 直接返回 `{ blocked: true, level: 'high' }`

2. **Layer 2 — Constitution Rules**
   - 遍歷 constitution.rules
   - 根據 rule.scope 判斷是否適用
   - hard rule 違反 → `severity: 'high'`
   - soft rule 違反 → `severity: 'medium'`

3. **Layer 3 — Heuristic Scoring**
   - H-1: deploy/merge_pr → medium
   - H-2: cross_village → high
   - H-3: 24h 內同 category 被 rollback → high
   - H-4: aggressive chief → medium（額外審查）
   - H-5: 花費超過 action limit 50% → medium

### 最終 level = max(所有 reasons 的 severity)

- 有 block/high → `high`
- 有 medium → `medium`
- 其他 → `low`

### AssessmentContext

```typescript
export interface AssessmentContext {
  constitution: Constitution | null;
  both_constitutions_allow?: boolean;
  recent_rollbacks: { category: string; rolled_back_at: string }[];
  chief_personality?: ChiefPersonality;
  loop_id?: string;
}
```

完整程式碼見 `T5_RISK_ASSESSOR.md` Step 3。

---

## 驗收

```bash
bun run build
# SI violation → blocked: true
# deploy → medium+
# cross_village → high
# 無 violations → low
```
