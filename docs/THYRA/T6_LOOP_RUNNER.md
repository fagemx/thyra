# T6: Loop Runner（自治迴圈引擎）

> Batch 4（整合所有引擎）
> 新建檔案：`src/loop-runner.ts`
> 依賴：T3 (Chief Engine), T4 (Law Engine), T5 (Risk Assessor), T7 (Skill Registry)
> 預估：6-8 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
bun test src/chief-engine.test.ts
bun test src/law-engine.test.ts
bun test src/risk-assessor.test.ts
```

---

## 最終結果

- 自治迴圈完整可跑：observe → decide → act → evaluate
- Timeout 保護（THY-08）：單次迴圈不超過預設上限
- 人類隨時可中斷（Safety Invariant #1）
- 預算追蹤：每次動作計費，超預算停止
- Cycle 記錄完整（可追溯）
- Phase 0 用規則式決策（不需 LLM）
- 測試通過

---

## 核心設計

### 自治迴圈 = Karpathy Autoresearch 模式

```
Constitution = program.md（人類定的，不可改）
Law = train.py（AI 可改的策略）
Chief = agent 人格（用哪些 skills、什麼風險偏好）
Loop = 在有限預算和時間內跑一輪自治
```

### 迴圈四步驟

```
┌─────────────────────────────────────────┐
│ Loop Cycle (bounded by time + budget)   │
│                                         │
│  1. OBSERVE  ← 收集 signals             │
│       ↓                                 │
│  2. DECIDE   ← Chief 基於 laws + 判例  │
│       ↓                                 │
│  3. ACT      ← 執行（需過 Risk）       │
│       ↓                                 │
│  4. EVALUATE ← 評估效果，更新 law       │
│       ↓                                 │
│  回到 1（或結束）                       │
└─────────────────────────────────────────┘
```

### 三種觸發

| 觸發 | 說明 | 用例 |
|------|------|------|
| `scheduled` | 定時觸發（cron-like） | 每小時跑一次品質審查 |
| `event` | Karvi 事件觸發 | task.failed → 自動分析 |
| `manual` | 人類手動啟動 | 按按鈕跑一輪 |

---

## 實作步驟

### Step 1: Database Schema

```sql
CREATE TABLE IF NOT EXISTS loop_cycles (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL REFERENCES villages(id),
  chief_id TEXT NOT NULL REFERENCES chiefs(id),
  trigger TEXT NOT NULL CHECK(trigger IN ('scheduled','event','manual')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','completed','timeout','aborted')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  laws_proposed TEXT NOT NULL DEFAULT '[]',
  laws_enacted TEXT NOT NULL DEFAULT '[]',
  cost_incurred REAL NOT NULL DEFAULT 0,
  budget_remaining REAL NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cycle_village ON loop_cycles(village_id, status);
```

### Step 2: Loop Runner 核心

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { ChiefEngine, Chief } from './chief-engine';
import type { LawEngine, Law } from './law-engine';
import type { RiskAssessor, Action, AssessmentResult } from './risk-assessor';
import type { ConstitutionStore, Constitution } from './constitution-store';
import { buildChiefPrompt } from './chief-engine';

export interface LoopCycle {
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

export interface LoopAction {
  id: string;
  type: 'observe' | 'propose_law' | 'execute' | 'evaluate';
  description: string;
  risk_level: 'low' | 'medium' | 'high';
  outcome: 'success' | 'failure' | 'blocked' | 'pending_approval';
  karvi_task_id?: string;
  edda_query_id?: string;
}

export interface StartCycleOpts {
  villageId: string;
  chiefId: string;
  trigger: 'scheduled' | 'event' | 'manual';
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class LoopRunner {
  constructor(
    private db: Database.Database,
    private chiefEngine: ChiefEngine,
    private lawEngine: LawEngine,
    private riskAssessor: RiskAssessor,
    private constitutionStore: ConstitutionStore,
  ) {}

  async startCycle(opts: StartCycleOpts): Promise<LoopCycle> {
    const { villageId, chiefId, trigger, timeoutMs, signal } = opts;

    const chief = this.chiefEngine.get(chiefId);
    if (!chief) throw new Error('Chief not found');
    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) throw new Error('No active constitution');

    const budget = constitution.budget_limits.max_cost_per_loop;
    const cycle = this.createCycleRecord(villageId, chiefId, trigger, budget);

    // Timeout 保護（THY-08）
    const defaultTimeout = 5 * 60 * 1000;
    const timeout = setTimeout(() => {
      this.endCycle(cycle.id, 'timeout');
    }, timeoutMs ?? defaultTimeout);

    // 人類中斷（Safety Invariant #1）
    const abortHandler = () => this.endCycle(cycle.id, 'aborted');
    signal?.addEventListener('abort', abortHandler, { once: true });

    try {
      await this.runLoop(cycle, chief, constitution);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
    }

    return this.getCycle(cycle.id)!;
  }

  private async runLoop(cycle: LoopCycle, chief: Chief, constitution: Constitution): Promise<void> {
    const laws = this.lawEngine.getActiveLaws(cycle.village_id);
    let iterationCount = 0;
    const MAX_ITERATIONS = 10; // 防止無限迴圈

    while (this.getCycle(cycle.id)?.status === 'running' && iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      // 預算檢查
      const currentCycle = this.getCycle(cycle.id)!;
      if (currentCycle.cost_incurred >= currentCycle.budget_remaining) {
        this.endCycle(cycle.id, 'completed');
        break;
      }

      // 1. OBSERVE
      const observations = this.observe(cycle.village_id);
      if (observations.length === 0) {
        this.endCycle(cycle.id, 'completed');
        break;
      }

      // 2. DECIDE（Phase 0: 規則式）
      const decision = this.decide(chief, laws, observations);
      if (!decision) {
        this.endCycle(cycle.id, 'completed');
        break;
      }

      // 3. ACT
      const assessment = this.riskAssessor.assess(decision.action, {
        constitution,
        recent_rollbacks: this.getRecentRollbacks(cycle.village_id),
        chief_personality: chief.personality,
        loop_id: cycle.id,
      });

      if (assessment.blocked) {
        this.addAction(cycle.id, {
          type: 'execute',
          description: decision.action.description,
          risk_level: assessment.level,
          outcome: 'blocked',
        });
        continue;
      }

      if (assessment.level !== 'low') {
        this.addAction(cycle.id, {
          type: 'execute',
          description: decision.action.description,
          risk_level: assessment.level,
          outcome: 'pending_approval',
        });
        continue;
      }

      // Low risk → 執行
      const result = await this.execute(decision, cycle);
      this.addAction(cycle.id, {
        type: decision.action.type as any,
        description: decision.action.description,
        risk_level: 'low',
        outcome: result.success ? 'success' : 'failure',
      });

      // 記錄花費
      if (decision.action.estimated_cost > 0) {
        this.riskAssessor.recordSpend(cycle.village_id, cycle.id, decision.action.estimated_cost);
        this.updateCycleCost(cycle.id, decision.action.estimated_cost);
      }

      // 4. EVALUATE
      // Phase 0: 簡單記錄，Phase 1 加 effectiveness 評估
    }

    // 如果迴圈自然結束（非 timeout/abort）
    const finalCycle = this.getCycle(cycle.id)!;
    if (finalCycle.status === 'running') {
      this.endCycle(cycle.id, 'completed');
    }
  }

  // ---- Observe ----

  private observe(villageId: string): Observation[] {
    // Phase 0: 從 audit_log 收集最近變更
    const rows = this.db.prepare(`
      SELECT * FROM audit_log
      WHERE entity_id = ? OR json_extract(payload, '$.village_id') = ?
      ORDER BY created_at DESC LIMIT 20
    `).all(villageId, villageId) as any[];

    return rows.map(r => ({
      type: r.action,
      entity: r.entity_type,
      payload: JSON.parse(r.payload || '{}'),
      timestamp: r.created_at,
    }));
  }

  // ---- Decide（Phase 0: 規則式）----

  private decide(chief: Chief, laws: Law[], observations: Observation[]): Decision | null {
    // Phase 0: 根據 observation type + chief personality 對應固定策略
    // Phase 1: 用 LLM + Chief prompt

    for (const obs of observations) {
      if (obs.type === 'evaluated' && obs.payload?.verdict === 'harmful') {
        // 有害 law → 提議 rollback
        return {
          action: {
            type: 'propose_law',
            description: `Rollback harmful law based on evaluation`,
            initiated_by: chief.id,
            village_id: chief.village_id,
            estimated_cost: 0,
            reason: `Observation: ${obs.type} with harmful verdict`,
            rollback_plan: 'Revert to previous law state',
          },
          reasoning: 'Rule-based: harmful evaluation triggers rollback proposal',
        };
      }
    }

    // 沒有需要處理的 observation
    return null;
  }

  // ---- Execute ----

  private async execute(decision: Decision, cycle: LoopCycle): Promise<ExecuteResult> {
    switch (decision.action.type) {
      case 'propose_law':
        // 透過 Law Engine propose
        return { success: true };
      case 'dispatch_task':
        // Phase 1: 透過 Karvi Bridge
        return { success: false, reason: 'karvi_bridge_not_ready' };
      default:
        return { success: false, reason: 'unknown_action_type' };
    }
  }

  // ---- Abort（Safety Invariant #1）----

  abortCycle(cycleId: string, reason: string): void {
    this.endCycle(cycleId, 'aborted');
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('loop', cycleId, 'aborted', JSON.stringify({ reason }), 'human', new Date().toISOString());
  }

  // ---- Helpers ----

  getCycle(id: string): LoopCycle | null {
    const row = this.db.prepare('SELECT * FROM loop_cycles WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      ...row,
      actions: JSON.parse(row.actions || '[]'),
      laws_proposed: JSON.parse(row.laws_proposed || '[]'),
      laws_enacted: JSON.parse(row.laws_enacted || '[]'),
    };
  }

  listCycles(villageId: string): LoopCycle[] {
    return this.db.prepare('SELECT * FROM loop_cycles WHERE village_id = ? ORDER BY started_at DESC')
      .all(villageId).map((r: any) => ({
        ...r,
        actions: JSON.parse(r.actions || '[]'),
        laws_proposed: JSON.parse(r.laws_proposed || '[]'),
        laws_enacted: JSON.parse(r.laws_enacted || '[]'),
      }));
  }

  private createCycleRecord(villageId: string, chiefId: string, trigger: string, budget: number): LoopCycle {
    const now = new Date().toISOString();
    const cycle: LoopCycle = {
      id: `cycle-${randomUUID()}`,
      village_id: villageId,
      chief_id: chiefId,
      trigger: trigger as any,
      status: 'running',
      started_at: now,
      actions: [],
      laws_proposed: [],
      laws_enacted: [],
      cost_incurred: 0,
      budget_remaining: budget,
    };
    this.db.prepare(`
      INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, started_at, actions, laws_proposed, laws_enacted, cost_incurred, budget_remaining)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cycle.id, villageId, chiefId, trigger, 'running', now, '[]', '[]', '[]', 0, budget);
    return cycle;
  }

  private endCycle(cycleId: string, status: string): void {
    this.db.prepare('UPDATE loop_cycles SET status = ?, ended_at = ? WHERE id = ? AND status = ?')
      .run(status, new Date().toISOString(), cycleId, 'running');
  }

  private addAction(cycleId: string, action: Omit<LoopAction, 'id'>): void {
    const cycle = this.getCycle(cycleId);
    if (!cycle) return;
    const newAction = { id: `action-${randomUUID()}`, ...action };
    const actions = [...cycle.actions, newAction];
    this.db.prepare('UPDATE loop_cycles SET actions = ? WHERE id = ?')
      .run(JSON.stringify(actions), cycleId);
  }

  private updateCycleCost(cycleId: string, additionalCost: number): void {
    this.db.prepare('UPDATE loop_cycles SET cost_incurred = cost_incurred + ? WHERE id = ?')
      .run(additionalCost, cycleId);
  }

  private getRecentRollbacks(villageId: string) {
    const rows = this.db.prepare(`
      SELECT category, updated_at as rolled_back_at FROM laws
      WHERE village_id = ? AND status = 'rolled_back'
      ORDER BY updated_at DESC LIMIT 10
    `).all(villageId) as any[];
    return rows;
  }
}

// Supporting types
interface Observation {
  type: string;
  entity: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface Decision {
  action: Action;
  reasoning: string;
}

interface ExecuteResult {
  success: boolean;
  reason?: string;
}
```

### Step 3: API Routes

```typescript
// POST   /api/villages/:vid/loops/start
app.post('/api/villages/:vid/loops/start', async (c) => {
  const body = await c.req.json();
  const controller = new AbortController();
  // Store controller for later abort
  const cycle = await runner.startCycle({
    villageId: c.req.param('vid'),
    chiefId: body.chief_id,
    trigger: body.trigger ?? 'manual',
    signal: controller.signal,
  });
  return c.json({ ok: true, data: cycle }, 201);
});

// GET    /api/villages/:vid/loops
app.get('/api/villages/:vid/loops', (c) => {
  return c.json({ ok: true, data: runner.listCycles(c.req.param('vid')) });
});

// GET    /api/loops/:id
app.get('/api/loops/:id', (c) => {
  const cycle = runner.getCycle(c.req.param('id'));
  if (!cycle) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
  return c.json({ ok: true, data: cycle });
});

// POST   /api/loops/:id/stop（Safety Invariant #1）
app.post('/api/loops/:id/stop', (c) => {
  runner.abortCycle(c.req.param('id'), 'human_stop');
  return c.json({ ok: true, data: runner.getCycle(c.req.param('id')) });
});

// GET    /api/loops/:id/actions
app.get('/api/loops/:id/actions', (c) => {
  const cycle = runner.getCycle(c.req.param('id'));
  if (!cycle) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
  return c.json({ ok: true, data: cycle.actions });
});
```

### Step 4: 測試

```typescript
describe('LoopRunner', () => {
  it('start cycle → status running → complete', async () => {
    const cycle = await runner.startCycle({ villageId, chiefId, trigger: 'manual' });
    expect(cycle.status).toBe('completed');
  });

  it('timeout → status timeout', async () => {
    const cycle = await runner.startCycle({ villageId, chiefId, trigger: 'manual', timeoutMs: 1 });
    expect(cycle.status).toBe('timeout');
  });

  it('abort → status aborted', async () => {
    const controller = new AbortController();
    const promise = runner.startCycle({ villageId, chiefId, trigger: 'manual', signal: controller.signal });
    controller.abort();
    const cycle = await promise;
    expect(cycle.status).toBe('aborted');
  });

  it('budget exhausted → auto stop', async () => {
    // set budget to 0
    // run cycle → should stop immediately
  });

  it('low risk action → executed', async () => {
    // observe something → decide → act → success
  });

  it('medium risk action → pending_approval', async () => {
    // action involving deploy → pending
  });

  it('blocked action → recorded as blocked', async () => {
    // safety invariant violation → blocked
  });

  it('cycle records all actions', async () => {
    const cycle = await runner.startCycle({ villageId, chiefId, trigger: 'manual' });
    expect(Array.isArray(cycle.actions)).toBe(true);
  });

  it('listCycles returns history', () => {
    const cycles = runner.listCycles(villageId);
    expect(Array.isArray(cycles)).toBe(true);
  });
});
```

---

## Phase 0 vs Phase 1 差異

| 功能 | Phase 0 | Phase 1 |
|------|---------|---------|
| Observe | 本地 audit log | + Karvi events (T9) |
| Decide | 規則式（keyword match） | LLM（用 Chief prompt + Skill） |
| Execute | propose/revoke law | + dispatch task via Karvi |
| Evaluate | 比較前後 metrics | + Edda 判例對照 (T10) |

---

## 驗收條件

```bash
bun test src/loop-runner.test.ts

# 人類中斷測試
# 1. start loop
# 2. POST /api/loops/:id/stop
# 3. 確認 status = aborted
```
