# Thyra — Track 拆解

## 層級定義

- **L0 基礎設施**：DB + Village + Audit（資料層 + 域隔離 + 審計追蹤）
- **L1 規則層**：Constitution + Skill Registry（不可變規則 + 能力定義）
- **L2 行為層**：Chief + Law Engine + Risk Assessor（行為人格 + 策略管理 + 風險門衛）
- **L3 自治層**：Loop Runner（有邊界的自治迴圈）
- **L4 整合層**：Dashboard + Karvi Bridge + Edda Bridge（UI + 外部橋接）
- **L5 擴展層**：Territory Coordinator（跨 Village 協調）

## DAG

```
L0 基礎設施
  [T1] Village Manager + DB + Audit
   │
   ▼
L1 規則層
  [T2] Constitution Store    [T7] Skill Registry
   │                          │
   ├──────────┬───────────────┤
   ▼          ▼               ▼
L2 行為層
  [T5] Risk   [T3] Chief Engine
  Assessor     │
   │           ▼
   │         [T4] Law Engine
   │           │
   ├───────────┤
   ▼           ▼
L3 自治層
  [T6] Loop Runner
   │
   ├──────────────┬────────────┐
   ▼              ▼            ▼
L4 整合層
  [T8] Dashboard  [T9] Karvi  [T10] Edda
                  Bridge      Bridge
                               │
                               ▼
L5 擴展層
  [T11] Territory Coordinator
```

**關鍵依賴說明**：
- T1 是所有 Track 的前提（DB + Village 必須先存在）
- T2 和 T7 同屬 L1，可並行
- T3 同時依賴 T2（權限驗證）和 T7（skill binding）
- T4 依賴 T2（合憲性檢查）和 T3（chief 提案）
- T5 只依賴 T2（constitution rules），可與 T3 並行
- T6 整合 T3+T4+T5，是 L3 唯一 Track
- T8/T9/T10 皆依賴 T6，三者可完全並行
- T11 依賴 T1+T6+T7，Phase 2 再做

## Track → Step 對照

每個 Track 拆成可獨立執行的 Step，放在子目錄內：

### T1: Village Manager（L0）
```
T1_VILLAGE_MANAGER/
  T1_01_PROJECT_INIT.md      ← 專案骨架 + tsconfig + deps
  T1_02_DB_LAYER.md          ← SQLite 連線 + schema + audit_log
  T1_03_VILLAGE_CORE.md      ← VillageManager class（CRUD + version）
  T1_04_ROUTES_AND_TESTS.md  ← API routes + 測試 + 驗收
```

### T2: Constitution Store（L1）
```
T2_CONSTITUTION_STORE/
  T2_01_SCHEMA_AND_DB.md     ← SQL table + Zod schema + Permission enum
  T2_02_STORE_CORE.md        ← ConstitutionStore class（create/revoke/supersede）
  T2_03_VALIDATORS.md        ← checkPermission + checkBudget + checkRules
  T2_04_ROUTES_AND_TESTS.md  ← API routes + 測試 + 驗收
```

### T3: Chief Engine（L2）
```
T3_CHIEF_ENGINE/
  T3_01_SCHEMA_AND_DB.md     ← SQL table + Zod（personality, constraints, skill binding）
  T3_02_ENGINE_CORE.md       ← ChiefEngine class（CRUD + 權限/skill 驗證）
  T3_03_PROMPT_BUILDER.md    ← buildChiefPrompt（人格+約束+skills→system prompt）
  T3_04_ROUTES_AND_TESTS.md  ← API routes + /prompt 預覽 + 測試
```

### T4: Law Engine（L2）
```
T4_LAW_ENGINE/
  T4_01_SCHEMA_AND_DB.md     ← SQL table + Zod（propose, evaluate）
  T4_02_COMPLIANCE.md        ← 合憲性檢查 + risk 分級邏輯
  T4_03_ENGINE_CORE.md       ← LawEngine class（propose/approve/reject/rollback/evaluate）
  T4_04_ROUTES_AND_TESTS.md  ← API routes + 測試（auto-approve, auto-rollback）
```

### T5: Risk Assessor（L2）
```
T5_RISK_ASSESSOR/
  T5_01_SAFETY_INVARIANTS.md ← 7 條硬編碼 SI + Action/AssessmentResult 型別
  T5_02_ASSESSOR_CORE.md     ← 三層檢查邏輯（SI → Constitution → Heuristic）
  T5_03_BUDGET_TRACKER.md    ← spend tracking + per_action/day/loop 聚合
  T5_04_ROUTES_AND_TESTS.md  ← API routes + 測試（SI 不可覆寫）
```

### T6: Loop Runner（L3）
```
T6_LOOP_RUNNER/
  T6_01_SCHEMA_AND_DB.md     ← loop_cycles table + LoopCycle/LoopAction 型別
  T6_02_OBSERVE_DECIDE.md    ← observe（audit log）+ decide（Phase 0 規則式）
  T6_03_ACT_EVALUATE.md      ← execute + risk gate + evaluate + cost tracking
  T6_04_LIFECYCLE.md         ← startCycle/abortCycle/timeout/budget exhaustion
  T6_05_ROUTES_AND_TESTS.md  ← API routes + 測試（完整迴圈、中斷、超時）
```

### T7: Skill Registry（L1）
```
T7_SKILL_REGISTRY/
  T7_01_SCHEMA_AND_DB.md     ← SQL table + Zod（SkillDefinition）
  T7_02_REGISTRY_CORE.md     ← SkillRegistry class（CRUD + verify/deprecate）
  T7_03_BINDING_AND_PROMPT.md ← validateSkillBindings + buildSkillPrompt
  T7_04_ROUTES_AND_TESTS.md  ← API routes + seed skills + 測試
```

### T8-T11（Phase 1/2，不拆子步驟）
```
T8_DASHBOARD.md              ← 單檔，Phase 1 再展開
T9_KARVI_BRIDGE.md           ← 單檔
T10_EDDA_BRIDGE.md           ← 單檔
T11_TERRITORY_COORDINATOR.md ← 單檔，Phase 2 再展開
```

## Module Import 路徑

```
src/
  db.ts                      ← createDb, initSchema（T1_02）
  schemas/
    village.ts               ← CreateVillageInput, UpdateVillageInput（T1_03）
    constitution.ts          ← PermissionEnum, CreateConstitutionInput（T2_01）
    chief.ts                 ← CreateChiefInput, SkillBindingInput（T3_01）
    law.ts                   ← ProposeLawInput, EvaluateLawInput（T4_01）
    skill.ts                 ← CreateSkillInput, SkillDefinitionInput（T7_01）
  village-manager.ts         ← VillageManager class（T1_03）
  constitution-store.ts      ← ConstitutionStore, checkPermission, checkBudget（T2_02, T2_03）
  chief-engine.ts            ← ChiefEngine, buildChiefPrompt（T3_02, T3_03）
  law-engine.ts              ← LawEngine（T4_03）
  risk-assessor.ts           ← RiskAssessor, SAFETY_INVARIANTS（T5_01, T5_02）
  loop-runner.ts             ← LoopRunner（T6_04）
  skill-registry.ts          ← SkillRegistry, buildSkillPrompt（T7_02, T7_03）
  karvi-bridge.ts            ← KarviBridge（T9）
  edda-bridge.ts             ← EddaBridge（T10）
  territory.ts               ← TerritoryCoordinator（T11）
  routes/
    villages.ts              ← villageRoutes（T1_04）
    constitutions.ts         ← constitutionRoutes（T2_04）
    chiefs.ts                ← chiefRoutes（T3_04）
    laws.ts                  ← lawRoutes（T4_04）
    skills.ts                ← skillRoutes（T7_04）
    loops.ts                 ← loopRoutes（T6_05）
    assess.ts                ← assessRoutes（T5_04）
    bridges.ts               ← bridgeRoutes（T9, T10）
  index.ts                   ← Hono app, mount all routes, start server
```

## 跨模組依賴圖（import 方向）

```
village-manager ← constitution-store ← chief-engine ← law-engine
                                     ← risk-assessor
                ← skill-registry ←── chief-engine

chief-engine + law-engine + risk-assessor + constitution-store → loop-runner

loop-runner → karvi-bridge
loop-runner → edda-bridge

village-manager + loop-runner + skill-registry → territory
```

**規則**：下層不得 import 上層。`db.ts` 和 `schemas/` 是共用基礎，所有模組可 import。
