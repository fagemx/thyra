# T7_04: Routes + Tests

> **Layer**: L1
> **Dependencies**: T7_02, T7_03
> **Blocks**: 無（T7 完成）
> **Output**: `src/routes/skills.ts`, `src/skill-registry.test.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T7_SKILL_REGISTRY.md    # Step 6 routes, Step 7 seed, Step 8 tests
cat src/skill-registry.ts              # 確認 core 完成
```

---

## Routes

```
GET    /api/skills                        # 全域列表
POST   /api/skills                        # 建立
GET    /api/skills/:id
PATCH  /api/skills/:id                    # 更新（version +1）
POST   /api/skills/:id/verify             # 驗證
POST   /api/skills/:id/deprecate          # 棄用
GET    /api/villages/:vid/skills           # 該 Village 可用的 skills
```

## 預設 Skills（種子資料）

Phase 0 內建，status = verified：

| Skill | 說明 |
|-------|------|
| `code-review` | PR 品質審查 |
| `security-audit` | 安全漏洞檢查 |
| `test-writer` | 自動寫測試 |
| `refactoring` | 程式碼重構 |
| `system-design` | 架構設計 |
| `incident-response` | 事故回應 |

## Tests

覆蓋：
- 建立 skill → draft
- verify → verified
- Chief bind verified skill → 成功
- Chief bind draft skill → 報錯（THY-14）
- 更新 skill → version+1，舊版保留
- deprecate → 新 Chief 不能 bind，已 bind 的不受影響
- getAvailable → 只回 verified + (global | same village)
- name format validation（regex `^[a-z0-9-]+$`）
- UNIQUE(name, version, village_id) 約束

完整測試見 `T7_SKILL_REGISTRY.md` Step 8。

---

## T7 完成檢查

```
[x] T7_01: Schema + DB（skills table + Zod）
[x] T7_02: Registry Core（CRUD + verify/deprecate + version）
[x] T7_03: Binding + Prompt（validateSkillBindings + buildSkillPrompt）
[x] T7_04: Routes + Tests + Seed Skills
→ T7 完成，T3 可使用 skill binding 功能
```
