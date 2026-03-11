# Thyra — Architecture Contract

> 所有 Task agent 開始前必須讀這份文件。

---

## 規則表

| Rule ID | 描述 | 影響 Tasks |
|---------|------|-----------|
| THY-01 | Constitution 不可修改，只能 revoke + supersede（新版取代舊版） | T2, T4 |
| THY-02 | Law 修改必須在 Constitution 約束內，違反 hard rule 直接拒絕 | T4, T5 |
| THY-03 | Risk 三級：Low 自動、Medium 人類確認、High 人類發起 | T5, T6 |
| THY-04 | 所有實體必須有 `id`, `created_at`, `version` | 全部 |
| THY-05 | Village 是隔離單位，跨 Village 走 Territory | 全部 |
| THY-06 | 與 Karvi/Edda 只走 HTTP REST | T9, T10 |
| THY-07 | 所有狀態變更寫 audit log（append-only） | 全部 |
| THY-08 | Loop 單次有時間上限（預設 5 分鐘） | T6 |
| THY-09 | Chief permissions ⊆ Constitution allowed_permissions | T3 |
| THY-10 | Dashboard 唯讀 + 審批，不直接改內部狀態 | T8 |
| THY-11 | API response 統一 `{ ok, data?, error? }` | 全部 |
| THY-12 | Safety Invariants 硬編碼不可覆寫 | 全部 |
| THY-13 | Skill 必須有 version，升級不影響舊 Chief 的 binding | T7, T3 |
| THY-14 | Chief 只能 bind 已驗證（status: verified）的 Skill | T7, T3 |

---

## Safety Invariants（不可覆寫）

| # | 不變量 | 執行點 |
|---|--------|--------|
| 1 | 人類隨時可以按停止鍵 | Loop Runner |
| 2 | 所有 AI 決策必須有可追溯的理由鏈 | Audit Log |
| 3 | 自動執行的動作必須可回滾 | Loop Runner + Law Engine |
| 4 | 單次自動花費不超過預設上限（$10） | Risk Assessor |
| 5 | 不得授予超出 Constitution 的權限 | Chief Engine |
| 6 | 不得自動刪除人類建立的 Constitution | Constitution Store |
| 7 | 跨 Village 操作需雙方 Constitution 允許 | Territory |

---

## 核心 Schema

### Village

```typescript
interface Village {
  id: string;              // "village-<ulid>"
  name: string;
  description: string;
  target_repo: string;     // git repo 路徑或 GitHub slug
  status: 'active' | 'paused' | 'archived';
  created_at: string;
  updated_at: string;
  version: number;
  metadata: Record<string, unknown>;
}
```

### Constitution

```typescript
interface Constitution {
  id: string;              // "const-<ulid>"
  village_id: string;
  version: number;
  status: 'active' | 'revoked' | 'superseded';
  created_at: string;
  created_by: string;      // 必須是人類
  rules: ConstitutionRule[];
  allowed_permissions: Permission[];
  budget_limits: BudgetLimits;
  superseded_by?: string;
}

interface ConstitutionRule {
  id: string;
  description: string;
  enforcement: 'hard' | 'soft';  // hard = 絕對不可違反
  scope: string[];               // chief id 或 '*'
}

interface BudgetLimits {
  max_cost_per_action: number;
  max_cost_per_day: number;
  max_cost_per_loop: number;
}
```

### Chief

```typescript
interface Chief {
  id: string;              // "chief-<ulid>"
  village_id: string;
  name: string;
  role: string;
  version: number;
  status: 'active' | 'inactive';
  skills: SkillBinding[];     // 綁定的 skills（含版本）
  permissions: Permission[];  // ⊆ constitution.allowed_permissions
  personality: ChiefPersonality;
  constraints: ChiefConstraint[];
  created_at: string;
  updated_at: string;
}

interface SkillBinding {
  skill_id: string;
  skill_version: number;      // 綁定特定版本
  config?: Record<string, unknown>;  // skill 的客製參數
}

interface ChiefPersonality {
  risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
  communication_style: 'concise' | 'detailed' | 'minimal';
  decision_speed: 'fast' | 'deliberate' | 'cautious';
}

interface ChiefConstraint {
  type: 'must' | 'must_not' | 'prefer' | 'avoid';
  description: string;
}
```

### Skill

```typescript
interface Skill {
  id: string;              // "skill-<ulid>"
  name: string;            // e.g. "code-review", "security-audit"
  version: number;
  status: 'draft' | 'verified' | 'deprecated';
  village_id: string | null;  // null = global（可跨 Village）
  definition: SkillDefinition;
  created_at: string;
  updated_at: string;
  verified_at?: string;
  verified_by?: string;
}

interface SkillDefinition {
  description: string;
  prompt_template: string;    // system prompt 片段
  tools_required: string[];   // 需要的工具（e.g. "gh", "git", "curl"）
  input_schema?: Record<string, unknown>;  // 預期輸入格式
  output_schema?: Record<string, unknown>; // 預期輸出格式
  constraints: string[];      // skill 層級的約束
  examples?: SkillExample[];  // few-shot examples
}

interface SkillExample {
  input: string;
  expected_output: string;
  explanation?: string;
}
```

### Law

```typescript
interface Law {
  id: string;
  village_id: string;
  proposed_by: string;     // chief id 或 human id
  approved_by: string;     // human id 或 'auto'
  version: number;
  status: 'proposed' | 'active' | 'revoked' | 'rolled_back' | 'rejected';
  category: string;
  content: {
    description: string;
    strategy: Record<string, unknown>;
  };
  risk_level: 'low' | 'medium' | 'high';
  evidence: {
    source: string;
    reasoning: string;
    edda_refs?: string[];
  };
  effectiveness?: {
    measured_at: string;
    metrics: Record<string, number>;
    verdict: 'effective' | 'neutral' | 'harmful';
  };
  created_at: string;
  updated_at: string;
}
```

### Loop Cycle

```typescript
interface LoopCycle {
  id: string;
  village_id: string;
  chief_id: string;
  trigger: 'scheduled' | 'event' | 'manual';
  status: 'running' | 'completed' | 'timeout' | 'aborted';
  started_at: string;
  ended_at?: string;
  actions: LoopAction[];
  laws_proposed: string[];
  laws_enacted: string[];
  cost_incurred: number;
  budget_remaining: number;
}

interface LoopAction {
  id: string;
  type: 'observe' | 'propose_law' | 'execute' | 'evaluate';
  description: string;
  risk_level: 'low' | 'medium' | 'high';
  outcome: 'success' | 'failure' | 'blocked' | 'pending_approval';
  karvi_task_id?: string;
  edda_query_id?: string;
}
```

---

## API 慣例

```
# Village
GET/POST            /api/villages
GET/PATCH/DELETE     /api/villages/:id

# Constitution（no PATCH — immutable）
GET/POST            /api/villages/:vid/constitutions
GET                 /api/villages/:vid/constitutions/active
POST                /api/constitutions/:id/revoke
POST                /api/constitutions/:id/supersede

# Chief
GET/POST            /api/villages/:vid/chiefs
GET/PATCH/DELETE     /api/chiefs/:id
GET                 /api/chiefs/:id/prompt    # 預覽生成的 prompt

# Skill
GET/POST            /api/skills
GET/PATCH            /api/skills/:id
POST                /api/skills/:id/verify
POST                /api/skills/:id/deprecate
GET                 /api/villages/:vid/skills  # 該 Village 可用的 skills

# Law
GET                 /api/villages/:vid/laws
POST                /api/villages/:vid/laws/propose
POST                /api/laws/:id/approve
POST                /api/laws/:id/reject
POST                /api/laws/:id/revoke
POST                /api/laws/:id/rollback
POST                /api/laws/:id/evaluate

# Loop
GET                 /api/villages/:vid/loops
POST                /api/villages/:vid/loops/start
GET                 /api/loops/:id
POST                /api/loops/:id/stop

# Bridge
GET                 /api/bridges/karvi/status
GET                 /api/bridges/edda/status
POST                /api/bridges/karvi/dispatch
POST                /api/bridges/edda/query
POST                /api/webhooks/karvi        # Karvi 回報

# Risk
POST                /api/assess
GET                 /api/villages/:vid/budget
```

**統一回應**：
```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "CONSTITUTION_VIOLATION", "message": "..." } }
```

---

## 與 Karvi 合約

```typescript
// Thyra → Karvi: 派任務
POST http://<karvi>/api/projects
{ "title": "...", "tasks": [{ "id": "THYRA-<village>-<seq>", ... }] }

// Karvi → Thyra: webhook (karvi.event.v1)
POST http://<thyra>/api/webhooks/karvi
{ "type": "karvi.event.v1", "event": "task.completed", "payload": { ... } }
```

## 與 Edda 合約

```typescript
// Thyra → Edda: 查判例
GET http://<edda>/api/decisions?domain=<village>&topic=<category>

// Thyra → Edda: 記錄決策
POST http://<edda>/api/decisions
{ "domain": "...", "aspect": "...", "value": "...", "reason": "...", "source": "thyra" }
```
