# Thyra — Agent Governance & Capability Layer

AI agent 團隊的治理層。定義 agent 應該怎麼做、可以自己改什麼、出事怎麼回滾。

## 技術棧

- **語言**: TypeScript 5.x
- **Runtime**: Bun（優先）/ Node 22+
- **Web Framework**: Hono（輕量、TS-first、跨 runtime）
- **資料**: SQLite (better-sqlite3) → Postgres
- **Schema**: Zod（runtime validation + TS type inference）
- **UI**: React + Vite（Dashboard，Phase 1）
- **測試**: Vitest

## 專案結構

```
src/
  db.ts                      ← createDb, initSchema
  schemas/
    village.ts               ← CreateVillageInput, UpdateVillageInput
    constitution.ts          ← PermissionEnum, CreateConstitutionInput
    chief.ts                 ← CreateChiefInput, SkillBindingInput
    law.ts                   ← ProposeLawInput, EvaluateLawInput
    skill.ts                 ← CreateSkillInput, SkillDefinitionInput
  village-manager.ts         ← VillageManager class
  constitution-store.ts      ← ConstitutionStore, checkPermission, checkBudget
  chief-engine.ts            ← ChiefEngine, buildChiefPrompt
  law-engine.ts              ← LawEngine
  risk-assessor.ts           ← RiskAssessor, SAFETY_INVARIANTS
  loop-runner.ts             ← LoopRunner
  skill-registry.ts          ← SkillRegistry, buildSkillPrompt
  routes/
    villages.ts              ← villageRoutes
    constitutions.ts         ← constitutionRoutes
    chiefs.ts                ← chiefRoutes
    laws.ts                  ← lawRoutes
    skills.ts                ← skillRoutes
    loops.ts                 ← loopRoutes
    assess.ts                ← assessRoutes
  index.ts                   ← Hono app, mount all routes, start server
docs/
  THYRA/                     ← 規劃文件（Track 分解、契約、驗收）
```

## 常用指令

```bash
bun run build                # TypeScript 編譯
bun test                     # Vitest 全跑
bun test src/village-manager.test.ts   # 單檔測試
bun run dev                  # 開發模式（hot reload）
```

## 開發原則

### 架構契約優先

**開工前必讀 `docs/THYRA/CONTRACT.md`。** 14 條規則 + 7 條 Safety Invariants 是硬約束。

重點規則：
- **THY-01**: Constitution 不可修改，只能 revoke + supersede
- **THY-02**: Law 必須在 Constitution 框架內
- **THY-03**: Risk 三級 — Low 自動、Medium 人類確認、High 人類發起
- **THY-09**: Chief permissions ⊆ Constitution allowed_permissions
- **THY-12**: Safety Invariants 硬編碼不可覆寫
- **THY-14**: Chief 只能 bind verified Skill

### 層級依賴規則

```
下層不得 import 上層。db.ts 和 schemas/ 是共用基礎，所有模組可 import。

village-manager ← constitution-store ← chief-engine ← law-engine
                                     ← risk-assessor
                ← skill-registry ←── chief-engine

chief-engine + law-engine + risk-assessor + constitution-store → loop-runner
```

違反層級依賴 = 任務不完成。

### TypeScript 嚴格模式

- `strict: true` — 不允許 `any`
- `noEmit: false` — 必須能編譯
- Zod 做 runtime validation，TypeScript 做 compile-time safety
- 不使用 `as any` 或 `@ts-ignore`

**`any` 的替代方案：**

```typescript
// ❌ Bad
const data: any = row;
(row as any).field;

// ✅ Good — Zod parse（Thyra 首選）
const data = VillageSchema.parse(row);

// ✅ Good — unknown + narrowing
const data: unknown = row;
if (typeof data === 'object' && data !== null && 'id' in data) { ... }

// ✅ Good — explicit interface cast
const data = row as Village;
```

### Promise 處理

非同步操作必須明確處理，不允許 floating promise。

```typescript
// ❌ Bad — floating promise，沒有 await 也沒有 catch
someAsyncFunction();

// ✅ Good — await
await someAsyncFunction();

// ✅ Good — fire-and-forget 明確標記（Bridge 常用模式）
void someAsyncFunction().catch(console.error);

// ❌ Bad — Promise 當 boolean（永遠是 truthy）
if (someAsyncFunction()) { ... }
```

### Defensive Programming 邊界

不是所有地方都需要 try/catch。只在特定邊界處理錯誤：

```typescript
// ❌ Bad — 不需要的 try/catch，吞掉錯誤
try {
  const village = villageManager.get(id);
} catch (e) {
  console.error(e);
  return null;
}

// ✅ Good — 讓 error 自然傳播，Hono onError 會接住

// ✅ OK — Bridge 呼叫可以 catch（graceful degradation — THY-06）
try {
  await eddaBridge.recordDecision(data);
} catch {
  // Edda 斷線不影響主流程
}

// ✅ OK — LLM 呼叫 catch（非確定性輸出，需要 fallback）
// ✅ OK — SQLite transaction rollback（確保 atomicity）
```

### 資料完整性

- SQLite 是 single source of truth
- 所有狀態變更寫 audit_log（append-only）— THY-07
- JSON 欄位用 `JSON.stringify` / `JSON.parse` 存取
- 所有實體必須有 `id`, `created_at`, `version` — THY-04

### API 規範

- 統一回應格式：`{ ok: true, data }` 或 `{ ok: false, error: { code, message } }` — THY-11
- RESTful routes，命名一致
- Zod `.safeParse()` 做輸入驗證

## 測試

### 測試策略

**單元測試 + 整合測試並重。** Vitest 原生 TypeScript 支援。

```bash
bun test                                    # 全部
bun test src/constitution-store.test.ts     # 單檔
bun test --reporter=verbose                 # 詳細輸出
```

### 測試原則

- 每個 Track 的最後一個 Step 是 Routes + Tests
- 測試覆蓋：正常路徑 + 權限錯誤 + 違規拒絕 + 邊界條件
- 不 mock 內部模組 — 用真正的 SQLite（`:memory:`）
- Safety Invariant 測試：無論 constitution 怎麼設，SI 都不可覆寫

## Pre-Commit 檢查

```bash
bun run build                # TypeScript 編譯通過
bun test                     # 所有測試通過
```

## Commit 規範

### 格式
```
<type>[optional scope]: <description>
```

### 規則
- type 小寫：`feat:` 不是 `Feat:`
- description 小寫開頭，不加句號
- 100 字元以內
- 祈使語氣：`add` 不是 `added`

### Types
feat, fix, docs, style, refactor, test, chore, ci, perf, build, revert

### Scope 建議
village, constitution, chief, law, risk, loop, skill, dashboard, bridge, territory

### 範例
- ✅ `feat(constitution): add supersede with transaction`
- ✅ `fix(risk): SI-4 check per-action budget limit`
- ❌ `Fix: Added budget checking.`

## 品質閘門 (Hard Gates)

### Gate 1 — Read-before-Write
修改任何檔案前，必須先讀 CONTRACT.md 和相關 Track 文件。

### Gate 2 — Baseline / Regression
第一次 Edit 之前，先跑 `bun run build && bun test` 記錄基線。改完再跑一次。

### Gate 3 — Major Change
以下任一條成立，必須先說明計畫：
- 變更 DB schema（加欄位、改 table）
- 變更 API contract（route、response 格式）
- 影響 3+ 個檔案且跨不同層
- 修改 Safety Invariant 相關邏輯

### Gate 4 — Evidence Ledger
每個關鍵結論必須有證據：檔案路徑 + 行號。

## 語言規範

- **程式碼**: 英文（變數名、函數名、型別名）
- **文件和註釋**: 中文優先
- **Commit messages**: 英文
- **與用戶溝通**: 用戶的語言

## 三 Repo 關係

```
Thyra（治理 / 立法）
  ↓ 下發 constitution + law + chief config
Karvi（執行 / 執法）
  ↑ 回報 events + signals + metrics
Edda（記憶 / 判例）
  ↑↓ 歷史決策查詢 + 策略推薦
```

- 與 Karvi/Edda 只走 HTTP REST — THY-06
- Thyra 不依賴 Karvi 或 Edda 的 npm 套件
- Bridge 模組做 graceful degradation（連不上就降級，不 crash）

## 必讀文件

1. **`docs/THYRA/CONTRACT.md`** — 架構契約（14 條規則 + 7 條 SI）
2. **`docs/THYRA/TRACKS.md`** — 層級定義 + DAG + 模組路徑
3. **`docs/THYRA/00_OVERVIEW.md`** — 全景概覽
4. **各 Track 主文件** — `T1_VILLAGE_MANAGER.md` ~ `T11_TERRITORY_COORDINATOR.md`
5. **各 Track 子步驟** — `T1_VILLAGE_MANAGER/T1_01_PROJECT_INIT.md` 等

<!-- edda:decision-tracking -->
## Decision Tracking (edda)

This project uses **edda** for decision tracking across sessions.

When you make an architectural decision (choosing a library, defining a pattern,
changing infrastructure), record it:

```bash
edda decide "domain.aspect=value" --reason "why"
```

**What to record:** schema changes, validation rules, API design choices, module boundaries.

**What NOT to record:** formatting, typo fixes, minor refactors.

Before ending a session, summarize what you did:

```bash
edda note "completed X; decided Y; next: Z" --tag session
```

<!-- edda:coordination -->
## Multi-Agent Coordination (edda)

When edda detects multiple agents, it injects peer information into your context.

**You MUST follow these rules:**
- **Check Off-limits** before editing any file
- **Claim your scope** at session start: `edda claim "label" --paths "src/scope/*"`
- **Request before crossing boundaries**: `edda request "peer-label" "your message"`
- **Respect binding decisions** — they apply to all sessions
