# T7_03: Binding Validation + Prompt Builder

> **Layer**: L1
> **Dependencies**: T7_02
> **Blocks**: T3_02（ChiefEngine 呼叫 validateSkillBindings）, T3_03（buildChiefPrompt 呼叫 buildSkillPrompt）
> **Output**: `validateSkillBindings` + `buildSkillPrompt` functions

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-14（Chief 只能 bind verified skill）
cat docs/THYRA/T7_SKILL_REGISTRY.md    # Step 4 + Step 5
cat src/schemas/chief.ts               # SkillBindingInput
bun run build
```

---

## 實作

### validateSkillBindings（供 ChiefEngine 呼叫）

```typescript
export function validateSkillBindings(
  bindings: SkillBinding[],
  villageId: string,
  registry: SkillRegistry
): { valid: boolean; errors: string[] }
```

檢查：
1. Skill 存在 → 不存在報錯
2. Skill status === 'verified' → 非 verified 報錯（THY-14）
3. Skill 屬於同 village 或 global → 跨 village 報錯
4. Version mismatch → 允許綁定舊版（by design），不報錯

### buildSkillPrompt（供 buildChiefPrompt 呼叫）

```typescript
export function buildSkillPrompt(
  bindings: SkillBinding[],
  registry: SkillRegistry
): string
```

組合所有綁定 skill 的 prompt：

```
## Skill: code-review (v2)
[prompt_template content]

Constraints:
- Must cite specific file:line for each finding
- Must not comment on formatting

## Skill: test-writer (v1)
[prompt_template content]
...
```

完整程式碼見 `T7_SKILL_REGISTRY.md` Step 4, Step 5。

---

## 驗收

```bash
bun run build
# bind verified skill → valid: true
# bind draft skill → valid: false, error includes THY-14
# bind cross-village skill → valid: false
# buildSkillPrompt → 包含所有 bound skills 的 prompt_template + constraints
```
