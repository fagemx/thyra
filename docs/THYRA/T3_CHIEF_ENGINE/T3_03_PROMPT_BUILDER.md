# T3_03: Prompt Builder

> **Layer**: L2
> **Dependencies**: T3_02, T7_03（buildSkillPrompt）
> **Blocks**: T3_04, T6（Loop Runner 用 prompt）
> **Output**: `buildChiefPrompt` function in chief-engine.ts

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T3_CHIEF_ENGINE.md      # Step 4 prompt builder
cat src/skill-registry.ts             # buildSkillPrompt
```

---

## 實作

`buildChiefPrompt(chief, skillRegistry)` → string

組合：
1. 角色描述（name + role）
2. Personality directives（risk_tolerance → 對應文字）
3. Constraints（must/must_not/prefer/avoid → 對應 prefix）
4. Skills（呼叫 buildSkillPrompt）

完整程式碼見 `T3_CHIEF_ENGINE.md` Step 4。

---

## 驗收

```bash
bun run build
# buildChiefPrompt 輸出包含 name, role, personality, constraints, skills 各 section
```
