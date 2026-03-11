# T4_02: Constitution Compliance Check

> **Layer**: L2
> **Dependencies**: T4_01, T2_02（ConstitutionStore）
> **Blocks**: T4_03
> **Output**: `checkConstitutionCompliance` + `assessRisk` in law-engine.ts

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-02（law 不得違憲）, THY-03（risk 分級）
cat docs/THYRA/T4_LAW_ENGINE.md        # Step 3 checkCompliance + assessRisk
cat src/constitution-store.ts          # Constitution 型別 + rules 結構
bun run build
```

---

## 實作

### checkConstitutionCompliance

```typescript
function checkCompliance(constitution: Constitution, input: ProposeLawInput) {
  const hardViolations: ConstitutionRule[] = [];
  const softViolations: ConstitutionRule[] = [];
  for (const rule of constitution.rules) {
    // keyword + category scope 匹配
    // enforcement: 'hard' → hardViolations
    // enforcement: 'soft' → softViolations
  }
  return { hardViolations, softViolations };
}
```

**行為**：
- Hard rule 違反 → propose 直接 rejected
- Soft rule 違反 → risk 升級到 medium+，仍可 propose

### assessRisk

```typescript
function assessRisk(input: ProposeLawInput, constitution: Constitution): 'low' | 'medium' | 'high' {
  // deploy / merge / production → high
  // branch / staging → medium
  // 同 category 已有 active law → medium
  // 其他 → low
}
```

完整程式碼見 `T4_LAW_ENGINE.md` Step 3（private methods）。

---

## 驗收

```bash
bun run build
# hard rule violation → rejected
# soft rule violation → risk 升級
# deploy keyword → high risk
```
