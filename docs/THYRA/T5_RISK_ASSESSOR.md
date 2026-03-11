# T5: Risk Assessor

> Batch 2（可與 T3 並行）
> 新建檔案：`src/risk-assessor.ts`
> 依賴：T2 (Constitution Store)
> 預估：3-4 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
bun test src/constitution-store.test.ts
```

---

## 最終結果

- 統一的 risk 評估介面：任何動作都能評級 low / medium / high
- Budget 檢查：單次 / 每日 / 每迴圈花費上限
- Constitution rule 違反檢查
- Safety Invariant 檢查（硬編碼，不可覆寫）
- 測試通過

---

## 核心設計

### Risk Assessor 是 Thyra 的門衛

所有要執行的動作（dispatch task、enact law、start loop）都先過 Risk Assessor。它不做決策，只做分級。

```
動作請求 → Risk Assessor → { level, reasons, blocked_by }
                              ↓
              Low: 自動執行
              Medium: 排隊等人類確認
              High: 只有人類能發起
```

### 三層檢查

```
Layer 1: Safety Invariants（硬編碼，不可覆寫）
  ↓ pass
Layer 2: Constitution Rules（人類設定）
  ↓ pass
Layer 3: Heuristic Scoring（啟發式評分）
  → 輸出最終 risk level
```

---

## 實作步驟

### Step 1: Action 與 Result 型別

```typescript
export interface Action {
  type: string;                    // 動作類型
  description: string;
  initiated_by: string;            // chief id 或 human id
  village_id: string;
  estimated_cost: number;
  reason: string;
  rollback_plan?: string;
  grants_permission?: Permission[];
  cross_village?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AssessmentResult {
  level: 'low' | 'medium' | 'high';
  blocked: boolean;                // Safety Invariant 違反 → blocked
  reasons: AssessmentReason[];
  budget_check: {
    per_action: { limit: number; current: number; ok: boolean };
    per_day: { limit: number; spent: number; ok: boolean };
    per_loop: { limit: number; spent: number; ok: boolean };
  };
}

export interface AssessmentReason {
  source: 'safety_invariant' | 'constitution' | 'heuristic';
  id: string;
  message: string;
  severity: 'block' | 'high' | 'medium' | 'low';
}
```

### Step 2: Safety Invariants（CONTRACT THY-12）

```typescript
interface SafetyInvariant {
  id: string;
  check: (action: Action, ctx: AssessmentContext) => boolean;
  message: string;
}

// 硬編碼，任何 API 都不能修改這些
const SAFETY_INVARIANTS: SafetyInvariant[] = [
  {
    id: 'SI-1',
    check: (action) => action.type !== 'disable_human_override',
    message: '人類隨時可以按停止鍵',
  },
  {
    id: 'SI-2',
    check: (action) => !!action.reason,
    message: '所有 AI 決策必須有理由鏈',
  },
  {
    id: 'SI-3',
    check: (action) => action.rollback_plan !== undefined,
    message: '自動執行必須可回滾',
  },
  {
    id: 'SI-4',
    check: (action, ctx) =>
      action.estimated_cost <= (ctx.constitution?.budget_limits.max_cost_per_action ?? 10),
    message: '單次花費不得超過上限',
  },
  {
    id: 'SI-5',
    check: (action, ctx) => {
      if (!action.grants_permission) return true;
      const allowed = ctx.constitution?.allowed_permissions ?? [];
      return action.grants_permission.every(p => allowed.includes(p));
    },
    message: '不得授予超出 Constitution 的權限',
  },
  {
    id: 'SI-6',
    check: (action) => action.type !== 'delete_constitution',
    message: '不得自動刪除人類建立的 Constitution',
  },
  {
    id: 'SI-7',
    check: (action, ctx) =>
      !action.cross_village || ctx.both_constitutions_allow === true,
    message: '跨村莊操作需雙方 Constitution 允許',
  },
];
```

### Step 3: Risk Assessor 核心

```typescript
export interface AssessmentContext {
  constitution: Constitution | null;
  both_constitutions_allow?: boolean;
  recent_rollbacks: { category: string; rolled_back_at: string }[];
  chief_personality?: ChiefPersonality;
  loop_id?: string;
}

export class RiskAssessor {
  constructor(private db: Database.Database) {}

  assess(action: Action, ctx: AssessmentContext): AssessmentResult {
    const reasons: AssessmentReason[] = [];

    // Layer 1: Safety Invariants
    for (const si of SAFETY_INVARIANTS) {
      if (!si.check(action, ctx)) {
        reasons.push({
          source: 'safety_invariant',
          id: si.id,
          message: si.message,
          severity: 'block',
        });
      }
    }

    if (reasons.some(r => r.severity === 'block')) {
      return {
        level: 'high',
        blocked: true,
        reasons,
        budget_check: this.checkBudgets(action, ctx),
      };
    }

    // Layer 2: Constitution Rules
    if (ctx.constitution) {
      for (const rule of ctx.constitution.rules) {
        const inScope = rule.scope.includes('*') || rule.scope.includes(action.initiated_by);
        if (!inScope) continue;
        // Constitution rule compliance — keyword + category matching
        // Hard rule violation → severity 'high'
        // Soft rule violation → severity 'medium'
      }
    }

    // Layer 3: Heuristic Scoring
    const heuristics = this.computeHeuristics(action, ctx);
    reasons.push(...heuristics);

    // 最終 level = max severity
    const level = this.deriveLevel(reasons);

    return {
      level,
      blocked: false,
      reasons,
      budget_check: this.checkBudgets(action, ctx),
    };
  }

  private computeHeuristics(action: Action, ctx: AssessmentContext): AssessmentReason[] {
    const reasons: AssessmentReason[] = [];
    const desc = action.type.toLowerCase();

    // deploy / merge_pr → medium+
    if (desc.includes('deploy') || desc.includes('merge_pr')) {
      reasons.push({ source: 'heuristic', id: 'H-1', message: 'Action involves deploy/merge', severity: 'medium' });
    }

    // 跨 village → high
    if (action.cross_village) {
      reasons.push({ source: 'heuristic', id: 'H-2', message: 'Cross-village action', severity: 'high' });
    }

    // 24h 內同 category 被 rollback → high
    const recentRb = ctx.recent_rollbacks.filter(r => {
      const age = Date.now() - new Date(r.rolled_back_at).getTime();
      return age < 24 * 60 * 60 * 1000;
    });
    if (recentRb.length > 0) {
      reasons.push({ source: 'heuristic', id: 'H-3', message: 'Recent rollback in same category', severity: 'high' });
    }

    // aggressive chief → 額外審查
    if (ctx.chief_personality?.risk_tolerance === 'aggressive') {
      reasons.push({ source: 'heuristic', id: 'H-4', message: 'Aggressive chief requires extra scrutiny', severity: 'medium' });
    }

    // 花費超過 action 上限 50% → medium
    if (ctx.constitution) {
      const limit = ctx.constitution.budget_limits.max_cost_per_action;
      if (action.estimated_cost > limit * 0.5) {
        reasons.push({ source: 'heuristic', id: 'H-5', message: 'Cost exceeds 50% of action limit', severity: 'medium' });
      }
    }

    return reasons;
  }

  private deriveLevel(reasons: AssessmentReason[]): 'low' | 'medium' | 'high' {
    if (reasons.some(r => r.severity === 'high' || r.severity === 'block')) return 'high';
    if (reasons.some(r => r.severity === 'medium')) return 'medium';
    return 'low';
  }

  private checkBudgets(action: Action, ctx: AssessmentContext) {
    const limits = ctx.constitution?.budget_limits ?? {
      max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50,
    };
    const spentToday = this.getSpentToday(action.village_id);
    const spentLoop = ctx.loop_id ? this.getSpentInLoop(action.village_id, ctx.loop_id) : 0;

    return {
      per_action: { limit: limits.max_cost_per_action, current: action.estimated_cost, ok: action.estimated_cost <= limits.max_cost_per_action },
      per_day: { limit: limits.max_cost_per_day, spent: spentToday, ok: spentToday + action.estimated_cost <= limits.max_cost_per_day },
      per_loop: { limit: limits.max_cost_per_loop, spent: spentLoop, ok: spentLoop + action.estimated_cost <= limits.max_cost_per_loop },
    };
  }

  getSpentToday(villageId: string): number {
    const today = new Date().toISOString().split('T')[0];
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(json_extract(payload, '$.cost')), 0) as total
      FROM audit_log WHERE entity_type = 'budget' AND entity_id = ? AND created_at >= ?
    `).get(villageId, today + 'T00:00:00.000Z') as any;
    return row?.total ?? 0;
  }

  getSpentInLoop(villageId: string, loopId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(json_extract(payload, '$.cost')), 0) as total
      FROM audit_log WHERE entity_type = 'budget' AND entity_id = ?
        AND json_extract(payload, '$.loop_id') = ?
    `).get(villageId, loopId) as any;
    return row?.total ?? 0;
  }

  recordSpend(villageId: string, loopId: string | null, amount: number): void {
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('budget', villageId, 'spend', JSON.stringify({ cost: amount, loop_id: loopId }), 'system', new Date().toISOString());
  }
}
```

### Step 4: API

```typescript
// POST /api/assess — 評估任意動作的風險
app.post('/api/assess', async (c) => {
  const action = await c.req.json();
  const constitution = constitutionStore.getActive(action.village_id);
  const result = assessor.assess(action, {
    constitution,
    recent_rollbacks: [], // TODO: query from DB
  });
  return c.json({ ok: true, data: result });
});

// GET /api/villages/:vid/budget — 查看預算使用
app.get('/api/villages/:vid/budget', (c) => {
  const vid = c.req.param('vid');
  const constitution = constitutionStore.getActive(vid);
  const spentToday = assessor.getSpentToday(vid);
  return c.json({
    ok: true,
    data: {
      limits: constitution?.budget_limits ?? null,
      spent_today: spentToday,
      remaining_today: constitution ? constitution.budget_limits.max_cost_per_day - spentToday : null,
    },
  });
});
```

### Step 5: 測試

```typescript
describe('RiskAssessor', () => {
  it('SI violation → blocked: true', () => {
    const result = assessor.assess({ type: 'delete_constitution', ... }, ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some(r => r.id === 'SI-6')).toBe(true);
  });

  it('budget over per_action limit → blocked', () => {
    const result = assessor.assess({ estimated_cost: 20, ... }, { constitution: { budget_limits: { max_cost_per_action: 10 } } });
    expect(result.budget_check.per_action.ok).toBe(false);
  });

  it('low risk action → level low', () => {
    const result = assessor.assess({ type: 'propose_law', estimated_cost: 1, ... }, ctx);
    expect(result.level).toBe('low');
  });

  it('deploy action → level medium+', () => {
    const result = assessor.assess({ type: 'deploy', ... }, ctx);
    expect(result.level).not.toBe('low');
  });

  it('cross village → level high', () => {
    const result = assessor.assess({ cross_village: true, ... }, ctx);
    expect(result.level).toBe('high');
  });

  it('recent rollback in category → level high', () => {
    const result = assessor.assess(action, {
      ...ctx,
      recent_rollbacks: [{ category: 'review', rolled_back_at: new Date().toISOString() }],
    });
    expect(result.level).toBe('high');
  });

  it('no reason provided → SI-2 blocks', () => {
    const result = assessor.assess({ reason: '', ... }, ctx);
    expect(result.blocked).toBe(true);
  });

  it('budget tracking: recordSpend → getSpentToday reflects', () => {
    assessor.recordSpend(villageId, null, 5);
    expect(assessor.getSpentToday(villageId)).toBe(5);
  });
});
```

---

## 驗收條件

```bash
bun test src/risk-assessor.test.ts

# Safety Invariant 不可覆寫驗證
# 無論 constitution 怎麼設，delete_constitution 永遠 blocked
```
