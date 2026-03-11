# T4: Law Engine

> Batch 3（依賴 T2 + T3）
> 新建檔案：`src/law-engine.ts`, `src/schemas/law.ts`
> 依賴：T2 (Constitution Store), T3 (Chief Engine)
> 預估：5-6 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
bun test src/constitution-store.test.ts
bun test src/chief-engine.test.ts
```

---

## 最終結果

- Law 完整生命週期：propose → approve/reject → active → revoke/rollback
- Constitution 約束檢查：每次 propose 都驗證不違憲（THY-02）
- Risk-based 審批：low 自動、medium/high 需人類確認（THY-03）
- Law 效果評估框架
- 測試通過

---

## 核心設計

### 法律 = AI 可調整的策略

跟 Constitution（人類設定、不可改）不同，Law 是 AI（Chief）在 Constitution 框架內自主制定的策略。

**例子**：
- Constitution 說「PR 必須有 review」（不可改）
- Law 說「PR review 要求至少 2 個 approvals」（AI 可根據品質數據調整為 1 或 3）

### Law 生命週期

```
propose → [auto-approve if low risk] → active → [evaluate effectiveness] → revoke/rollback
                ↓                                        ↑
    [queue for human if medium/high]           [AI discovers it's harmful]
```

### Constitution 合規檢查

每次 propose 時，跑 Constitution 的 rules 驗證：

```typescript
function checkConstitutionCompliance(
  constitution: Constitution,
  lawContent: LawContent,
  chiefId: string
): { compliant: boolean; violations: ConstitutionRule[] }
```

如果違反任何 `enforcement: 'hard'` 的 rule → 直接拒絕。
如果只違反 `enforcement: 'soft'` 的 rule → 標記 warning，仍可 propose 但 risk 自動升級到 medium+。

---

## 實作步驟

### Step 1: Database Schema

```sql
CREATE TABLE IF NOT EXISTS laws (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL REFERENCES villages(id),
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK(status IN ('proposed','active','revoked','rolled_back','rejected')),
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low','medium','high')),
  evidence TEXT NOT NULL DEFAULT '{}',
  effectiveness TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_law_village ON laws(village_id, status);
CREATE INDEX IF NOT EXISTS idx_law_category ON laws(village_id, category);
```

### Step 2: Zod Schema

新建 `src/schemas/law.ts`：

```typescript
import { z } from 'zod';

export const ProposeLawInput = z.object({
  category: z.string().min(1),
  content: z.object({
    description: z.string().min(1),
    strategy: z.record(z.unknown()),
  }),
  evidence: z.object({
    source: z.string().min(1),
    reasoning: z.string().min(1),
    edda_refs: z.array(z.string()).optional(),
  }),
});

export const EvaluateLawInput = z.object({
  metrics: z.record(z.number()),
  verdict: z.enum(['effective', 'neutral', 'harmful']),
});

export type ProposeLawInput = z.infer<typeof ProposeLawInput>;
export type EvaluateLawInput = z.infer<typeof EvaluateLawInput>;
```

### Step 3: Law Engine 核心邏輯

新建 `src/law-engine.ts`：

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { ConstitutionStore, Constitution, ConstitutionRule } from './constitution-store';
import type { ChiefEngine } from './chief-engine';
import { checkPermission } from './constitution-store';
import type { ProposeLawInput, EvaluateLawInput } from './schemas/law';

export interface Law {
  id: string;
  village_id: string;
  proposed_by: string;
  approved_by: string | null;
  version: number;
  status: 'proposed' | 'active' | 'revoked' | 'rolled_back' | 'rejected';
  category: string;
  content: { description: string; strategy: Record<string, unknown> };
  risk_level: 'low' | 'medium' | 'high';
  evidence: { source: string; reasoning: string; edda_refs?: string[] };
  effectiveness: { measured_at: string; metrics: Record<string, number>; verdict: string } | null;
  created_at: string;
  updated_at: string;
}

export class LawEngine {
  constructor(
    private db: Database.Database,
    private constitutionStore: ConstitutionStore,
    private chiefEngine: ChiefEngine,
  ) {}

  propose(villageId: string, chiefId: string, input: ProposeLawInput): Law {
    // 1. 取 active constitution
    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) throw new Error('No active constitution');

    // 2. 驗證 chief 有 propose_law 權限
    const chief = this.chiefEngine.get(chiefId);
    if (!chief) throw new Error('Chief not found');
    if (!chief.permissions.includes('propose_law')) {
      throw new Error('Chief lacks propose_law permission');
    }

    // 3. 合憲性檢查
    const compliance = this.checkCompliance(constitution, input);
    if (compliance.hardViolations.length > 0) {
      // hard rule 違反 → 直接拒絕
      const law = this.insertLaw(villageId, chiefId, input, 'rejected', 'high');
      this.audit(law.id, 'rejected', { violations: compliance.hardViolations }, chiefId);
      return law;
    }

    // 4. 計算 risk level
    let risk = this.assessRisk(input, constitution);
    if (compliance.softViolations.length > 0 && risk === 'low') {
      risk = 'medium'; // soft rule 違反 → 升級到 medium
    }

    // 5. Low risk + chief 有 enact_law_low → auto-approve
    if (risk === 'low' && chief.permissions.includes('enact_law_low')) {
      const law = this.insertLaw(villageId, chiefId, input, 'active', 'low');
      law.approved_by = 'auto';
      this.db.prepare('UPDATE laws SET approved_by = ?, status = ? WHERE id = ?')
        .run('auto', 'active', law.id);
      this.audit(law.id, 'auto_approved', { risk }, chiefId);
      return { ...law, status: 'active', approved_by: 'auto' };
    }

    // 6. Otherwise → proposed, 等人類
    const law = this.insertLaw(villageId, chiefId, input, 'proposed', risk);
    this.audit(law.id, 'proposed', { risk, soft_violations: compliance.softViolations }, chiefId);
    return law;
  }

  approve(id: string, actor: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'proposed') throw new Error('Law not found or not proposed');
    this.db.prepare('UPDATE laws SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?')
      .run('active', actor, new Date().toISOString(), id);
    this.audit(id, 'approved', {}, actor);
    return { ...law, status: 'active', approved_by: actor };
  }

  reject(id: string, actor: string, reason?: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'proposed') throw new Error('Law not found or not proposed');
    this.db.prepare('UPDATE laws SET status = ?, updated_at = ? WHERE id = ?')
      .run('rejected', new Date().toISOString(), id);
    this.audit(id, 'rejected', { reason }, actor);
    return { ...law, status: 'rejected' };
  }

  revoke(id: string, actor: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'active') throw new Error('Law not found or not active');
    this.db.prepare('UPDATE laws SET status = ?, updated_at = ? WHERE id = ?')
      .run('revoked', new Date().toISOString(), id);
    this.audit(id, 'revoked', {}, actor);
    return { ...law, status: 'revoked' };
  }

  rollback(id: string, actor: string, reason: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'active') throw new Error('Law not found or not active');
    this.db.prepare('UPDATE laws SET status = ?, updated_at = ? WHERE id = ?')
      .run('rolled_back', new Date().toISOString(), id);
    this.audit(id, 'rolled_back', { reason }, actor);
    return { ...law, status: 'rolled_back' };
  }

  evaluate(id: string, input: EvaluateLawInput): Law {
    const law = this.get(id);
    if (!law || law.status !== 'active') throw new Error('Law not found or not active');

    const effectiveness = {
      measured_at: new Date().toISOString(),
      metrics: input.metrics,
      verdict: input.verdict,
    };

    this.db.prepare('UPDATE laws SET effectiveness = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(effectiveness), new Date().toISOString(), id);

    // Harmful + auto-approved → 自動回滾
    if (input.verdict === 'harmful' && law.approved_by === 'auto') {
      this.rollback(id, 'system', 'Auto-rollback: harmful verdict on auto-approved law');
    }

    this.audit(id, 'evaluated', effectiveness, 'system');
    return { ...law, effectiveness };
  }

  get(id: string): Law | null {
    const row = this.db.prepare('SELECT * FROM laws WHERE id = ?').get(id) as any;
    return row ? this.deserialize(row) : null;
  }

  getActiveLaws(villageId: string, category?: string): Law[] {
    let sql = 'SELECT * FROM laws WHERE village_id = ? AND status = ?';
    const params: unknown[] = [villageId, 'active'];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    return this.db.prepare(sql).all(...params).map((r: any) => this.deserialize(r));
  }

  list(villageId: string): Law[] {
    return this.db.prepare('SELECT * FROM laws WHERE village_id = ? ORDER BY created_at DESC')
      .all(villageId).map((r: any) => this.deserialize(r));
  }

  private checkCompliance(constitution: Constitution, input: ProposeLawInput) {
    const hardViolations: ConstitutionRule[] = [];
    const softViolations: ConstitutionRule[] = [];
    // 遍歷 constitution rules 判斷 law content 是否違反
    // 具體匹配邏輯：keyword matching + category scope
    for (const rule of constitution.rules) {
      // placeholder — 實際實作根據 rule.description 和 law.content 做語義匹配
      // Phase 0 用簡單 keyword matching，Phase 1 可加 LLM 判斷
    }
    return { hardViolations, softViolations };
  }

  private assessRisk(input: ProposeLawInput, constitution: Constitution): 'low' | 'medium' | 'high' {
    const desc = input.content.description.toLowerCase();
    // 涉及 deploy / merge_pr → high
    if (desc.includes('deploy') || desc.includes('merge') || desc.includes('production')) return 'high';
    // 涉及 branch / staging → medium
    if (desc.includes('branch') || desc.includes('staging')) return 'medium';
    // 修改已有 active law 的同 category → medium
    const existing = this.getActiveLaws(constitution.village_id, input.category);
    if (existing.length > 0) return 'medium';
    // 其他 → low
    return 'low';
  }

  private insertLaw(villageId: string, chiefId: string, input: ProposeLawInput, status: string, risk: string): Law {
    const now = new Date().toISOString();
    const law: Law = {
      id: `law-${randomUUID()}`,
      village_id: villageId,
      proposed_by: chiefId,
      approved_by: null,
      version: 1,
      status: status as any,
      category: input.category,
      content: input.content,
      risk_level: risk as any,
      evidence: input.evidence,
      effectiveness: null,
      created_at: now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO laws (id, village_id, proposed_by, version, status, category, content, risk_level, evidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(law.id, villageId, chiefId, 1, status, input.category,
      JSON.stringify(input.content), risk, JSON.stringify(input.evidence), now, now);
    return law;
  }

  private deserialize(row: any): Law {
    return {
      ...row,
      content: JSON.parse(row.content || '{}'),
      evidence: JSON.parse(row.evidence || '{}'),
      effectiveness: row.effectiveness ? JSON.parse(row.effectiveness) : null,
    };
  }

  private audit(entityId: string, action: string, payload: unknown, actor: string) {
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('law', entityId, action, JSON.stringify(payload), actor, new Date().toISOString());
  }
}
```

### Step 4: API Routes

```typescript
// POST   /api/villages/:vid/laws/propose     # Chief 提案
// GET    /api/villages/:vid/laws              # 列表
// GET    /api/villages/:vid/laws/active       # 只看 active
// GET    /api/laws/:id
// POST   /api/laws/:id/approve               # 人類審批
// POST   /api/laws/:id/reject
// POST   /api/laws/:id/revoke
// POST   /api/laws/:id/rollback
// POST   /api/laws/:id/evaluate              # 寫入效果評估

app.post('/api/villages/:vid/laws/propose', async (c) => {
  const body = await c.req.json();
  const { chief_id, ...rest } = body;
  const parsed = ProposeLawInput.safeParse(rest);
  if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
  const law = engine.propose(c.req.param('vid'), chief_id, parsed.data);
  return c.json({ ok: true, data: law }, 201);
});

app.post('/api/laws/:id/approve', (c) => {
  const law = engine.approve(c.req.param('id'), 'human');
  return c.json({ ok: true, data: law });
});

app.post('/api/laws/:id/evaluate', async (c) => {
  const body = await c.req.json();
  const parsed = EvaluateLawInput.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
  const law = engine.evaluate(c.req.param('id'), parsed.data);
  return c.json({ ok: true, data: law });
});
```

### Step 5: 測試

```typescript
describe('LawEngine', () => {
  it('propose: constitution compliant + low risk + enact_law_low → auto-approved', () => { ... });
  it('propose: constitution compliant + medium risk → status proposed', () => { ... });
  it('propose: violates hard rule → status rejected', () => { ... });
  it('propose: violates soft rule → risk upgraded to medium', () => { ... });
  it('propose: chief lacks propose_law → error', () => { ... });
  it('approve: status → active', () => { ... });
  it('reject: status → rejected', () => { ... });
  it('evaluate: harmful + auto-approved → auto-rollback', () => { ... });
  it('evaluate: harmful + human-approved → stays active (notify only)', () => { ... });
  it('getActiveLaws: only returns active laws', () => { ... });
  it('getActiveLaws: filters by category', () => { ... });
  it('rollback: status → rolled_back', () => { ... });
});
```

---

## 驗收條件

```bash
bun test src/law-engine.test.ts

# 合規驗證
# 1. 建 constitution 禁止 deploy
# 2. Chief propose 涉及 deploy 的 law
# 3. 預期：rejected with CONSTITUTION_VIOLATION
```
