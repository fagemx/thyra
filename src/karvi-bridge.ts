import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';

export interface KarviEvent {
  type: 'karvi.event.v1';
  event: 'task.completed' | 'task.failed' | 'step.completed' | 'step.failed';
  task_id: string;
  step_id?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface DispatchOpts {
  villageId: string;
  title: string;
  description: string;
  targetRepo: string;
  runtimeHint?: string;
  modelHint?: string;
}

export interface TaskStatus {
  id: string;
  title: string;
  status: string;
  [key: string]: unknown;
}

export class KarviBridge {
  private healthy = false;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private webhookUrl: string | null = null;

  constructor(
    private db: Database,
    private karviUrl: string,
  ) {}

  async dispatchTask(opts: DispatchOpts): Promise<{ taskId: string }> {
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

    appendAudit(this.db, 'karvi', taskId, 'dispatch', opts, 'system');
    return { taskId };
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus | null> {
    try {
      const res = await fetch(`${this.karviUrl}/api/board`);
      if (!res.ok) return null;
      const board = await res.json() as { taskPlan?: { tasks?: TaskStatus[] } };
      return board.taskPlan?.tasks?.find((t) => t.id === taskId) ?? null;
    } catch {
      return null;
    }
  }

  async getHealth(): Promise<{ ok: boolean; url: string }> {
    try {
      const res = await fetch(`${this.karviUrl}/api/health/preflight`, {
        signal: AbortSignal.timeout(5000),
      });
      this.healthy = res.ok;

      // Re-register webhook URL on successful health check
      if (res.ok && this.webhookUrl) {
        this.registerWebhookUrl(this.webhookUrl).catch(() => {});
      }

      return { ok: res.ok, url: this.karviUrl };
    } catch {
      this.healthy = false;
      return { ok: false, url: this.karviUrl };
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  // Webhook event ingestion
  ingestEvent(event: KarviEvent): void {
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('karvi_event', event.task_id, event.event, JSON.stringify(event.payload), 'karvi', event.timestamp);
  }

  getRecentEvents(limit = 20): KarviEvent[] {
    const rows = this.db.prepare(`
      SELECT entity_id as task_id, action as event, payload, created_at as timestamp
      FROM audit_log WHERE entity_type = 'karvi_event'
      ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      type: 'karvi.event.v1' as const,
      event: r.event as KarviEvent['event'],
      task_id: r.task_id as string,
      timestamp: r.timestamp as string,
      payload: JSON.parse((r.payload as string) || '{}'),
    }));
  }

  startMonitor(intervalMs = 30_000): void {
    if (this.monitorInterval) return;
    this.monitorInterval = setInterval(() => {
      this.getHealth();
    }, intervalMs);
  }

  stopMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /**
   * 向 Karvi 註冊 webhook URL，讓 step 事件自動 POST 回 Thyra。
   * POST /api/controls { event_webhook_url: url }
   * Karvi 離線時回傳 false（graceful degradation）。
   */
  async registerWebhookUrl(url: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.karviUrl}/api/controls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_webhook_url: url }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        this.webhookUrl = url;
        appendAudit(this.db, 'karvi', 'global', 'register_webhook', { url }, 'system');
        return true;
      }
      appendAudit(this.db, 'karvi', 'global', 'register_webhook_failed', { status: res.status }, 'system');
      return false;
    } catch {
      appendAudit(this.db, 'karvi', 'global', 'register_webhook_unreachable', { error: 'Karvi unreachable' }, 'system');
      return false;
    }
  }

  getRegisteredWebhookUrl(): string | null {
    return this.webhookUrl;
  }
}
