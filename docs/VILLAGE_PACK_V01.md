# Village Pack v0.1 — Compiler Spec

> 單一人類設定入口 → domain-aware compiler → 現有模組 API
> 人類編輯一個 `village.yaml`，底層自動呼叫 create/supersede/propose/bind。

---

## 0. 設計原則

1. **Village Pack 是 desired-state declaration，不是 ORM 表單。**
   人類宣告「我要這樣」，compiler 負責算出「跟現在差了什麼」再執行正確的 lifecycle operation。

2. **所有 immutability 規則照舊。**
   Constitution 只能 supersede，不能 update（THY-01）。
   Law 走 propose → approve/reject → revoke/rollback（THY-02）。
   Skill 版本遞增（update 建新 row）。

3. **Compiler 是 Thyra 內部模組，不是新 service。**
   `src/village-pack.ts` — 讀 YAML → diff → 呼叫現有 store/engine API。

4. **Phase 1 只支援 Blog Village。** 不做通用 DSL。

5. **每 category 最多一條 active law。**
   Phase 1 限制：同一 village 同一 `category` 只允許一條 active law。
   這讓 diff 語義穩定、export idempotent。
   之後升級多 law per category 時，此為明確破版點。

6. **Partial apply + idempotent convergence，不做全域 transaction。**
   Compiler 逐步執行（village → constitution → skills → chief → laws），
   允許 partial apply。每步寫 operation journal，CompileResult 清楚列出成功到哪。
   Rerun 同一份 YAML 應能收斂到最終 desired state（idempotent + resumable）。
   不幻想全回滾 — Constitution supersede + Karvi sync 等 side effect 無法逆轉。

---

## 1. village.yaml 結構

```yaml
# village.yaml — Blog Village
pack_version: "0.1"

village:
  name: blog-village
  description: "每週穩定產出 2 篇高品質文章"
  target_repo: fagemx/blog-content

constitution:
  rules:
    - id: R-NO-FABRICATE
      description: "must not fabricate sources"
      enforcement: hard
      scope: ["*"]
    - id: R-SENSITIVE-REVIEW
      description: "sensitive topics require human review"
      enforcement: hard
      scope: ["*"]
    - id: R-QUALITY-GATE
      description: "must pass quality review before publish"
      enforcement: soft
      scope: ["*"]
  allowed_permissions:
    - dispatch_task
    - propose_law
    - enact_law_low
    - query_edda
    - spend_budget
  budget:
    max_cost_per_action: 5
    max_cost_per_day: 50
    max_cost_per_loop: 25

chief:
  name: editor-chief
  role: "Blog content editor — manages research, drafting, review, publishing pipeline"
  personality:
    risk_tolerance: conservative
    communication_style: concise
    decision_speed: deliberate
  constraints:
    - type: must
      description: "prioritize brand consistency and factual accuracy"
    - type: must_not
      description: "publish content without review pass"
    - type: prefer
      description: "evergreen topics over trending topics"
    - type: avoid
      description: "unsupported claims and hot takes"
  permissions:
    - dispatch_task
    - propose_law
    - enact_law_low
    - query_edda
    - spend_budget

laws:
  - category: topic_mix
    content:
      description: "Topic allocation: 50% evergreen, 30% trend, 20% FAQ"
      strategy:
        evergreen: 0.5
        trend: 0.3
        faq: 0.2
    evidence:
      source: human
      reasoning: "Balanced content strategy for sustainable growth"

  - category: publish_schedule
    content:
      description: "Publish on Tuesday and Thursday"
      strategy:
        days: [tue, thu]
        min_per_week: 2
    evidence:
      source: human
      reasoning: "Consistent schedule builds reader expectations"

  - category: quality_threshold
    content:
      description: "Draft must score 7+ on review before publish"
      strategy:
        min_review_score: 7
        max_revision_rounds: 3
    evidence:
      source: human
      reasoning: "Quality gate prevents low-quality content reaching production"

skills:
  - research_topic
  - draft_content
  - review_content
  - publish_content
```

---

## 2. Compiler 分區 — 哪些欄位改動觸發什麼操作

### 核心規則表

| YAML 區塊 | 欄位 | 改動類型 | 底層操作 | 原因 |
|-----------|------|---------|---------|------|
| `village` | name, description, target_repo | patch | `VillageManager.update()` | Village 可 update（version++） |
| `constitution.rules` | 任何變更 | supersede | `ConstitutionStore.supersede()` | THY-01：Constitution immutable |
| `constitution.allowed_permissions` | 增刪權限 | supersede | `ConstitutionStore.supersede()` | THY-01 |
| `constitution.budget` | 任何金額改變 | supersede | `ConstitutionStore.supersede()` | THY-01，且 supersede 會觸發 Karvi syncBudgetControls |
| `chief.personality` | risk/style/speed | patch | `ChiefEngine.update()` | Chief 可 update（version++） |
| `chief.constraints` | 增刪約束 | patch | `ChiefEngine.update()` | Chief 可 update |
| `chief.permissions` | 增刪權限 | patch + validate | `ChiefEngine.update()` | THY-09：必須 ⊆ constitution.allowed_permissions |
| `chief.name`, `chief.role` | 文字修改 | patch | `ChiefEngine.update()` | Chief 可 update |
| `laws[]` | 新增一條 | propose | `LawEngine.propose()` | Law 走立法流程 |
| `laws[]` | 移除一條 | revoke | `LawEngine.revoke()` | 人類主動撤法 |
| `laws[]` | 修改 content/strategy | revoke old + propose new | `LawEngine.revoke()` → `LawEngine.propose()` | Law 不可 update，只能替換 |
| `skills[]` | 新增 skill name | bind | `ChiefEngine.update({ skills })` | 綁定已存在的 verified skill |
| `skills[]` | 移除 skill name | unbind | `ChiefEngine.update({ skills })` | 解除綁定 |

### 關鍵語義

#### Constitution 任何區塊改動 = 整體 supersede

Constitution 沒有 partial update。即使只改一條 rule 的 description，也必須：

```
1. 讀取當前 active constitution
2. 用 YAML 的完整 constitution 區塊建新的 CreateConstitutionInput
3. ConstitutionStore.supersede(old.id, newInput, actor)
4. supersede 內部會：
   a. 設 old.status = 'superseded'
   b. 建 new constitution, version = old.version + 1
   c. syncToKarvi(villageId, newBudgetLimits)
```

#### Chief 權限改動有前置條件

如果 chief permissions 改了，compiler 必須**先確認 constitution** 已包含該權限：

```
if chief.permissions ⊄ constitution.allowed_permissions:
  → 如果 constitution 也在同一次 YAML 改動中更新了 → 先 supersede constitution，再 update chief
  → 如果 constitution 沒改 → 報錯，拒絕 compile
```

#### Law 改動 = revoke + re-propose，不是 update

Law 沒有 `update()` 方法。如果人類改了某條 law 的 strategy：

```
1. 找到 active law (category match)
2. LawEngine.revoke(oldLaw.id, actor)
3. LawEngine.propose(villageId, chiefId, newInput)
4. 如果 chief 有 enact_law_low + risk=low → 自動 enact
5. 否則 → status='proposed'，等人類 approve
```

#### Skill 只綁定，不建立

Village Pack 的 `skills[]` 只列 skill name。Compiler 會：

```
1. 對每個 name: SkillRegistry.resolveForIntent(name, villageId)
2. 找不到 verified skill → 報錯（不自動建立）
3. 找到 → 取 { skill_id, skill_version } 作為 SkillBinding
4. ChiefEngine.update(chiefId, { skills: allBindings }, actor)
```

Skill 的建立和 verify 是獨立流程（THY-14），不在 Village Pack scope 內。

---

## 3. Compiler 執行順序

**順序很重要。** 因為 THY-09（chief permissions ⊆ constitution）和 THY-14（只能 bind verified skill）要求先有 constitution 和 skill 才能設 chief。

```
Phase 1: Village
  → create 或 update village

Phase 2: Constitution
  → 比對 active constitution vs YAML
  → 相同 → skip
  → 不同 → supersede（或 create if 無 active）

Phase 3: Skills resolution
  → 對每個 skill name 做 resolveForIntent
  → 收集 SkillBinding[]
  → 任何一個找不到 → 報錯，中止

Phase 4: Chief
  → 比對 active chief vs YAML
  → validate permissions ⊆ new/existing constitution.allowed_permissions
  → create 或 update chief（含 skill bindings）

Phase 5: Laws
  → 比對 active laws vs YAML laws（by category match）
  → 新增 → propose
  → 移除 → revoke
  → 修改 → revoke old + propose new
  → 未變 → skip
```

### 錯誤處理

| 情況 | 處理 |
|------|------|
| Village 不存在 | Phase 1 create |
| Village 已存在 | Phase 1 update（如有差異）|
| Constitution 不存在 | Phase 2 create |
| Constitution 無差異 | Phase 2 skip |
| Skill name 找不到 verified skill | **中止整個 compile，報錯** |
| Chief permissions ⊄ constitution | **中止，報錯**（不自動修改 constitution）|
| Law category 衝突（同 category 已有 active） | revoke old → propose new |
| Law propose 被 constitution hard rule 擋 | **報錯，標記該 law 為 rejected** |

---

## 4. Diff 演算法

Compiler 需要計算「YAML desired state vs 現在 DB state」的差異。

### 4.1 Constitution diff — Canonical Fingerprint

為避免人類改空白、排序、描述字詞微調就觸發 supersede（導致版本暴長），
Constitution diff 使用 **canonical fingerprint** 而非原始 deepEqual：

```typescript
/** 正規化 constitution 為可比較的 canonical form */
function canonicalizeConstitution(c: {
  rules: Array<{ description: string; enforcement: string; scope: string[] }>;
  allowed_permissions: string[];
  budget: { max_cost_per_action: number; max_cost_per_day: number; max_cost_per_loop: number };
}): string {
  const canonical = {
    // rules: 忽略 id（自動生成），只比較語義欄位，按 description 排序
    rules: c.rules
      .map((r) => ({
        description: r.description.trim().toLowerCase(),
        enforcement: r.enforcement,
        scope: [...r.scope].sort(),
      }))
      .sort((a, b) => a.description.localeCompare(b.description)),
    // permissions: 排序後比較
    allowed_permissions: [...c.allowed_permissions].sort(),
    // budget: 數值直接比
    budget: c.budget,
  };
  return JSON.stringify(canonical);
}

function constitutionFingerprint(c: Parameters<typeof canonicalizeConstitution>[0]): string {
  // SHA-256 of canonical JSON — stable across formatting/ordering changes
  return createHash('sha256').update(canonicalizeConstitution(c)).digest('hex').slice(0, 16);
}

function diffConstitution(
  yaml: YamlConstitution,
  current: Constitution | null,
): 'create' | 'supersede' | 'skip' {
  if (!current) return 'create';

  const yamlFp = constitutionFingerprint({
    rules: yaml.rules,
    allowed_permissions: yaml.allowed_permissions,
    budget: yaml.budget,
  });
  const currentFp = constitutionFingerprint({
    rules: current.rules,
    allowed_permissions: current.allowed_permissions,
    budget: current.budget_limits,
  });

  return yamlFp !== currentFp ? 'supersede' : 'skip';
}
```

**Fingerprint 忽略的**：rule id（自動生成）、description 大小寫/空白差異、陣列順序。
**Fingerprint 敏感的**：rule enforcement 等級、scope 成員、permissions 集合、budget 數值。

這讓人類調整 rule 描述的措辭不會觸發 supersede，但改 hard→soft 或增刪權限會。

### 4.2 Chief diff

```typescript
function diffChief(
  yaml: YamlChief,
  current: Chief | null,
): 'create' | 'update' | 'skip' {
  if (!current) return 'create';

  const changed =
    yaml.name !== current.name ||
    yaml.role !== current.role ||
    !deepEqual(yaml.personality, current.personality) ||
    !deepEqual(yaml.constraints, current.constraints) ||
    !sameSet(yaml.permissions, current.permissions) ||
    !sameBindings(resolvedSkills, current.skills);

  return changed ? 'update' : 'skip';
}
```

### 4.3 Laws diff

**Phase 1 限制：每 category 最多一條 active law（見 §0 原則 5）。**
這讓 diff 可以用 `category` 作為穩定 key，不需要處理同 category 多條 law 的合併邏輯。

```typescript
function diffLaws(
  yamlLaws: YamlLaw[],
  activeLaws: Law[],
): { toPropose: YamlLaw[]; toRevoke: Law[]; toReplace: Array<{ old: Law; new: YamlLaw }> } {
  // Phase 1: category 是 unique key
  const yamlByCategory = new Map(yamlLaws.map((l) => [l.category, l]));
  const activeByCategory = new Map(activeLaws.map((l) => [l.category, l]));

  const toPropose: YamlLaw[] = [];
  const toRevoke: Law[] = [];
  const toReplace: Array<{ old: Law; new: YamlLaw }> = [];

  // YAML 有、DB 沒有 → propose
  for (const [cat, law] of yamlByCategory) {
    if (!activeByCategory.has(cat)) {
      toPropose.push(law);
    }
  }

  // DB 有、YAML 沒有 → revoke
  for (const [cat, law] of activeByCategory) {
    if (!yamlByCategory.has(cat)) {
      toRevoke.push(law);
    }
  }

  // 兩邊都有 → 比較 content，不同則 replace
  for (const [cat, yamlLaw] of yamlByCategory) {
    const activeLaw = activeByCategory.get(cat);
    if (!activeLaw) continue;
    if (!deepEqual(yamlLaw.content, activeLaw.content)) {
      toReplace.push({ old: activeLaw, new: yamlLaw });
    }
  }

  return { toPropose, toRevoke, toReplace };
}
```

---

## 5. CompileResult + Session Metadata

Compiler 回傳完整的執行報告，不靜默執行。

### 5.1 Compile Session

每次 compile 產生一個 session，用於 audit 追蹤和 idempotence 判斷：

```typescript
interface CompileSession {
  session_id: string;              // `pack-{uuid}` — 唯一識別這次 compile
  pack_fingerprint: string;        // SHA-256(YAML content).slice(0, 16)
  pack_version: string;            // '0.1'
  source_path: string;             // YAML 檔案路徑
  compiled_at: string;             // ISO 8601
  compiled_by: string;             // 'village-pack:human' | 'village-pack:ci'
  dry_run: boolean;                // diff mode = true, apply mode = false
}
```

`pack_fingerprint` 讓 audit 能回答「這次 compile 對應哪一份 YAML」，
也能偵測重複 apply（同一份 YAML apply 兩次 → 第二次全 skip）。

Actor 格式擴充為 `village-pack:human:{session_id}`，
讓 audit_log 的同一波操作可以被 session_id 關聯。

### 5.2 CompileResult

```typescript
interface CompileResult {
  session: CompileSession;
  village: { action: 'created' | 'updated' | 'skipped'; id: string };
  constitution: { action: 'created' | 'superseded' | 'skipped'; id: string; version: number };
  chief: { action: 'created' | 'updated' | 'skipped'; id: string; version: number };
  laws: {
    proposed: Array<{ category: string; id: string; status: string }>;
    revoked: Array<{ category: string; id: string }>;
    replaced: Array<{ category: string; old_id: string; new_id: string; new_status: string }>;
    skipped: string[];  // unchanged categories
  };
  skills: {
    bound: Array<{ name: string; skill_id: string; version: number }>;
    errors: string[];   // empty if all resolved
  };
  errors: string[];     // fatal errors that stopped compile
  warnings: string[];   // non-fatal issues
  completed_phases: number;  // 1-5, how far the compile got before stopping
}
```

### 5.3 Partial Failure 策略

**不做全域 transaction。** 原因：Constitution supersede 會觸發 Karvi syncBudgetControls
等 side effect，無法回滾。

策略：**idempotent + resumable convergence。**

```
情境：Village update ✓ → Constitution supersede ✓ → Chief update ✓ → Law #2 propose 被 hard rule 擋

結果：
  completed_phases: 5 (laws phase 執行完畢，只是部分 law 失敗)
  laws.proposed: [{ category: 'topic_mix', id: 'law-xxx', status: 'active' }]  ← 成功的
  errors: ['Law category "quality_threshold" rejected by constitution rule R-NO-FABRICATE']  ← 失敗的

修正後 rerun：
  Village → skip (no diff)
  Constitution → skip (no diff)
  Skills → skip (no diff)
  Chief → skip (no diff)
  Laws → topic_mix skip (already active), quality_threshold → propose (if YAML updated)
```

**致命 vs 非致命錯誤**：

| 錯誤類型 | 行為 |
|---------|------|
| Static validation 失敗 | **中止，不執行任何 DB 操作** |
| Skill resolve 失敗 | **Phase 3 中止，Phase 4/5 不執行** |
| Chief permission ⊄ constitution | **Phase 4 中止，Phase 5 不執行** |
| 單條 Law propose 被擋 | **非致命：記錄 error，繼續下一條 law** |
| Law revoke 失敗（已非 active） | **非致命：記錄 warning，繼續** |

---

## 6. Actor 語義

所有底層操作都需要 `actor` 參數。Village Pack compile 時：

- `actor = 'village-pack:human'`（人類透過 YAML 編輯觸發）
- 未來可擴充：`actor = 'village-pack:ci'`（CI pipeline 觸發）

這讓 audit_log 能區分「人類直接 API 操作」vs「Village Pack compile 觸發」。

---

## 7. API 入口

### CLI（Phase 1）

```bash
bun run src/village-pack.ts apply village.yaml
bun run src/village-pack.ts diff village.yaml     # dry-run，只顯示 diff
bun run src/village-pack.ts export village-id      # 從 DB 匯出成 YAML
```

### HTTP（Phase 2，dashboard 用）

```
POST /api/village-pack/apply   { yaml: string }  → CompileResult
POST /api/village-pack/diff    { yaml: string }  → CompileResult (dry_run=true)
GET  /api/village-pack/export/:villageId          → YAML string
```

---

## 8. Validation 規則（compile 前靜態檢查）

在呼叫任何 store/engine API 之前，compiler 先做靜態檢查：

```
1. pack_version === '0.1'
2. village.name 非空，≤ 100 chars
3. village.target_repo 非空
4. constitution.rules 至少 1 條
5. constitution.allowed_permissions 至少 1 個
6. constitution.budget 的三個值都 ≥ 0
7. chief.permissions 每個都在 constitution.allowed_permissions 內
8. chief.personality 的三個 enum 值合法
9. chief.constraints 的 type 都在 [must, must_not, prefer, avoid]
10. laws[].category 非空
11. laws[].content.description 非空
12. laws[].evidence.source 非空
13. laws[].evidence.reasoning 非空
14. skills[] 每個 name 符合 /^[a-z0-9-]+$/
15. 同 category 不重複（YAML 內）
```

靜態檢查失敗 → 不執行任何 DB 操作，回傳 errors。

---

## 9. 不做清單

- 不做 YAML 範本產生器（Phase 2）
- 不做多 chief 支援（Phase 1 只有一個 chief per village）
- 不做 skill definition 建立（只做 binding，skill 建立是獨立流程）
- 不做 law approve/reject 自動化（propose 後是否自動 enact 由既有 risk 邏輯決定）
- 不做 constitution 歷史比較 UI
- 不做跨 village pack merge
- 不做 `village.yaml` watch mode（Phase 1 是手動 apply）
- 不做 lock file（Phase 1 不需要 concurrent compile 保護）

---

## 10. 實作順序

### Step 1: YAML Parser + Static Validation

- 定義 `VillagePackSchema`（Zod for YAML parsed object）
- 靜態檢查 15 條規則
- 測試：valid YAML → pass, invalid → errors

### Step 2: Diff Engine

- `diffConstitution()`, `diffChief()`, `diffLaws()`
- 測試：各種 diff 場景（skip, create, supersede, replace）

### Step 3: Compiler Core

- 執行順序：village → constitution → skills → chief → laws
- 呼叫真正的 store/engine API
- 回傳 CompileResult
- 測試：full compile from scratch, incremental update, error cases

### Step 4: CLI Entry Point

- `apply`, `diff`, `export` 三個指令
- 測試：end-to-end with in-memory DB

### Step 5: Export（反向）

- 從 DB 讀 village + active constitution + active chief + active laws + bound skills
- 產出等效 YAML
- 測試：apply → export → apply = idempotent
