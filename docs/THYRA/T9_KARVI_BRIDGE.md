# T9: Karvi Bridge

> Phase 1（可與 T8, T10 並行）
> 新建：`src/karvi-bridge.ts`
> 依賴：T6
> 預估：4-5 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
bun test src/loop-runner.test.ts
# 確認 Karvi 在跑
curl http://localhost:3461/api/health/preflight
```

---

## 最終結果

- Thyra → Karvi：派任務（POST /api/projects）
- Karvi → Thyra：webhook 收事件（karvi.event.v1）
- 連線健康監控
- Webhook 未就緒時降級為 polling
- 測試通過（mock Karvi）

---

## 核心設計

### 單向控制、雙向通訊

```
Thyra ──POST /api/projects──→ Karvi    （派任務）
Thyra ──GET /api/board──────→ Karvi    （查狀態）
Thyra ←──webhook────────── Karvi       （收事件）
```

Thyra 是**委託人**，Karvi 是**執行者**。Thyra 決定做什麼，Karvi 負責怎麼做。

Task ID 格式：`THYRA-<village>-<timestamp>`

### 事件合約（karvi.event.v1）

```typescript
interface KarviEvent {
  type: 'karvi.event.v1';
  event: 'task.completed' | 'task.failed' | 'step.completed' | 'step.failed';
  task_id: string;
  step_id?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
```

### Event Queue

Webhook 收到的事件存入 SQLite queue，供 Loop Runner observe 階段消費。

### 降級策略

Karvi #333 webhook 完成前，用 polling 替代：
- 定期 GET /api/board
- 比對 task status 變化
- 產生等效事件

---

## 實作步驟

### Step 1: Outbound — Task Dispatch

```typescript
export class KarviBridge {
  constructor(private karviUrl: string) {}

  async dispatchTask(opts: {
    villageId: string;
    title: string;
    description: string;
    targetRepo: string;
    runtimeHint?: string;
    modelHint?: string;
  }): Promise<{ taskId: string }> {
    const taskId = `THYRA-${opts.villageId}-${Date.now()}`;
    const res = await fetch(`${this.karviUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${taskId}: ${opts.title}`,
        tasks: [{
          id: taskId,
          title: opts.title,
          assignee: 'engineer_lite',
          target_repo: opts.targetRepo,
          runtimeHint: opts.runtimeHint,
          modelHint: opts.modelHint,
          description: opts.description,
        }],
      }),
    });

    if (!res.ok) throw new Error(`Karvi dispatch failed: ${res.status}`);
    return { taskId };
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const res = await fetch(`${this.karviUrl}/api/board`);
    const board = await res.json();
    const task = board.taskPlan?.tasks?.find(t => t.id === taskId);
    return task ?? null;
  }

  async getHealth(): Promise<{ ok: boolean }> {
    try {
      const res = await fetch(`${this.karviUrl}/api/health/preflight`);
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }
}
```

### Step 2: Inbound — Webhook Receiver

```typescript
// POST /api/webhooks/karvi
app.post('/api/webhooks/karvi', async (c) => {
  const event: KarviEvent = await c.req.json();

  // 驗證事件格式
  // 寫入事件佇列
  // 通知 Loop Runner（如果有 event-triggered loop）

  return c.json({ ok: true });
});
```

### Step 3: Event Queue

```typescript
// 事件佇列 — 供 Loop Runner 的 observe 階段消費
export class EventQueue {
  private queue: KarviEvent[] = [];

  push(event: KarviEvent): void;
  drain(villageId: string): KarviEvent[];  // 取出並清空該村莊的事件
  peek(villageId: string): KarviEvent[];   // 只看不取
}
```

SQLite 持久化，防止重啟遺失。

### Step 4: Connection Monitor

```typescript
// 定期 ping Karvi health endpoint
export class ConnectionMonitor {
  private healthy = false;
  private interval: Timer;

  start(karviUrl: string, intervalMs = 30_000): void {
    this.interval = setInterval(async () => {
      const res = await bridge.getHealth();
      this.healthy = res.ok;
    }, intervalMs);
  }

  isHealthy(): boolean { return this.healthy; }
}
```

---

## API

```
GET  /api/bridges/karvi/status          # 連線狀態
POST /api/bridges/karvi/dispatch        # 手動派任務
GET  /api/bridges/karvi/events          # 最近收到的事件
POST /api/webhooks/karvi                # Karvi 回報事件
```

## Karvi 需要的配合（#333）

Thyra Bridge 依賴 Karvi #333 的 webhook 功能。在 #333 完成前：
- Outbound（dispatch）可以先用
- Inbound（webhook）先用 polling 替代：定期 GET /api/board 比對差異

---

## 驗收

```bash
bun test src/karvi-bridge.test.ts

# 整合測試（需要 Karvi 跑著）
KARVI_URL=http://localhost:3461 bun test src/karvi-bridge.integration.test.ts

# Karvi 離線 → dispatch 報錯，health false，loop 仍可跑
```
