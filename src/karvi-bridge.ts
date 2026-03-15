import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { KarviEventNormalized } from './schemas/karvi-event';
import { DispatchProjectInput } from './schemas/karvi-dispatch';
import type { DispatchProjectInputRaw, KarviProjectResponse, KarviSingleDispatchResponse, KarviBudgetExceededError, KarviBoard, KarviStatus, KarviTaskProgress, KarviCapabilities } from './schemas/karvi-dispatch';
import { KarviCapabilitiesSchema } from './schemas/karvi-dispatch';

export type { KarviEventNormalized } from './schemas/karvi-event';
export type { DispatchProjectInputRaw, KarviProjectResponse, KarviSingleDispatchResponse, KarviBoard, KarviStatus, KarviTaskProgress, KarviCapabilities, KarviRuntime, KarviRemoteSkill } from './schemas/karvi-dispatch';

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

  /**
   * 派發專案到 Karvi，對齊 POST /api/projects 格式
   * 回傳 Karvi 的 project response（含 project.id, taskIds 等）
   * Karvi 離線時回傳 null（graceful degradation）
   */
  async dispatchProject(rawInput: DispatchProjectInputRaw): Promise<KarviProjectResponse | null> {
    const input = DispatchProjectInput.parse(rawInput);
    try {
      const res = await fetch(`${this.karviUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        appendAudit(this.db, 'karvi', input.title, 'dispatch_failed', { status: res.status }, 'system');
        throw new Error(`Karvi dispatch failed: ${res.status}`);
      }

      const data = await res.json() as KarviProjectResponse;
      const projectId = data.project?.id ?? input.title;
      appendAudit(this.db, 'karvi', projectId, 'dispatch', {
        title: input.title,
        taskCount: data.taskCount,
        taskIds: data.project?.taskIds,
      }, 'system');
      return data;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Karvi dispatch failed')) throw e;
      // Karvi offline → graceful degradation
      appendAudit(this.db, 'karvi', input.title, 'dispatch_unreachable', { error: 'Karvi unreachable' }, 'system');
      return null;
    }
  }

  /**
   * 單任務派發：POST /api/tasks/:id/dispatch
   * 回傳 dispatch result 或 null（Karvi 離線）
   * 409 BUDGET_EXCEEDED 時 throw 含 remaining 資訊
   */
  async dispatchSingleTask(taskId: string, runtimeHint?: string): Promise<KarviSingleDispatchResponse | null> {
    try {
      const qs = runtimeHint ? `?runtime=${encodeURIComponent(runtimeHint)}` : '';
      const res = await fetch(`${this.karviUrl}/api/tasks/${encodeURIComponent(taskId)}/dispatch${qs}`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 409) {
        const body = await res.json() as KarviBudgetExceededError;
        appendAudit(this.db, 'karvi', taskId, 'budget_exceeded', { remaining: body.remaining }, 'system');
        throw new Error(`BUDGET_EXCEEDED: ${JSON.stringify(body.remaining)}`);
      }

      if (!res.ok) {
        throw new Error(`Karvi single dispatch failed: ${res.status}`);
      }

      const data = await res.json() as KarviSingleDispatchResponse;
      appendAudit(this.db, 'karvi', taskId, 'dispatch_single', { dispatched: data.dispatched, planId: data.planId }, 'system');
      return data;
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith('BUDGET_EXCEEDED') || e.message.startsWith('Karvi single dispatch'))) throw e;
      return null;
    }
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus | null> {
    try {
      const res = await fetch(`${this.karviUrl}/api/board`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const board = await res.json() as { taskPlan?: { tasks?: TaskStatus[] } };
      return board.taskPlan?.tasks?.find((t) => t.id === taskId) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 同步 Constitution budget_limits 到 Karvi controls
   * 映射：Thyra budget → Karvi usage_limits + step_timeout_sec
   * Karvi 離線時回傳 false（graceful degradation）
   */
  async syncBudgetControls(villageId: string, budgetLimits: {
    max_cost_per_action: number;
    max_cost_per_day: number;
    max_cost_per_loop: number;
  }): Promise<boolean> {
    try {
      const controls = {
        // max_cost_per_action → step default timeout (秒，以 cost × 60 為近似)
        step_timeout_sec: {
          default: Math.min(Math.max(budgetLimits.max_cost_per_action * 60, 30), 3600),
        },
        // max_cost_per_day → usage_limits (以 daily × 30 估算 monthly)
        usage_limits: {
          dispatches_per_month: budgetLimits.max_cost_per_day * 30,
          runtime_sec_per_month: budgetLimits.max_cost_per_loop * 60 * 30,
        },
        usage_alert_threshold: 0.8,
      };

      const res = await fetch(`${this.karviUrl}/api/controls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(controls),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        appendAudit(this.db, 'karvi', villageId, 'sync_budget', { budgetLimits, controls }, 'system');
        return true;
      }
      appendAudit(this.db, 'karvi', villageId, 'sync_budget_failed', { status: res.status }, 'system');
      return false;
    } catch {
      appendAudit(this.db, 'karvi', villageId, 'sync_budget_unreachable', { error: 'Karvi unreachable' }, 'system');
      return false;
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

  // Webhook event ingestion with idempotency via event_id
  ingestEvent(event: KarviEventNormalized): { ingested: boolean } {
    // Idempotency check
    const existing = this.db.prepare(
      'SELECT 1 FROM audit_log WHERE event_id = ?'
    ).get(event.event_id) as Record<string, unknown> | null;

    if (existing) {
      return { ingested: false };
    }

    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at, event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'karvi_event',
      event.task_id,
      event.event_type,
      JSON.stringify(event.raw),
      'karvi',
      event.occurred_at,
      event.event_id,
    );

    return { ingested: true };
  }

  getRecentEvents(limit = 20): KarviEventNormalized[] {
    const rows = this.db.prepare(`
      SELECT entity_id as task_id, action as event_type,
             payload as raw, created_at as occurred_at, event_id
      FROM audit_log WHERE entity_type = 'karvi_event'
      ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Record<string, unknown>[];

    return rows.map((r) => {
      const raw = JSON.parse((r.raw as string) || '{}') as Record<string, unknown>;
      return {
        event_id: (r.event_id as string) || '',
        event_type: r.event_type as string,
        task_id: r.task_id as string,
        step_id: (raw.stepId as string) || '',
        occurred_at: r.occurred_at as string,
        step_type: raw.stepType as string | undefined,
        state: raw.state as string | undefined,
        error: raw.error as string | undefined,
        raw,
      };
    });
  }

  // --- Bridge methods for #39, #40, #41 ---

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.karviUrl}/api/tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: 'POST', signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        appendAudit(this.db, 'karvi', taskId, 'cancel_task', {}, 'system');
        return true;
      }
      appendAudit(this.db, 'karvi', taskId, 'cancel_task_failed', { status: res.status }, 'system');
      return false;
    } catch {
      appendAudit(this.db, 'karvi', taskId, 'cancel_task_unreachable', {}, 'system');
      return false;
    }
  }

  async getBoard(): Promise<KarviBoard | null> {
    try {
      const res = await fetch(`${this.karviUrl}/api/board`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return (await res.json()) as KarviBoard;
    } catch {
      return null;
    }
  }

  async getStatus(fields?: string[]): Promise<KarviStatus | null> {
    try {
      let url = `${this.karviUrl}/api/status`;
      if (fields && fields.length > 0) {
        url += `?fields=${encodeURIComponent(fields.join(','))}`;
      }
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return (await res.json()) as KarviStatus;
    } catch {
      return null;
    }
  }

  async getTaskProgress(taskId: string): Promise<KarviTaskProgress | null> {
    try {
      const res = await fetch(
        `${this.karviUrl}/api/tasks/${encodeURIComponent(taskId)}/progress`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) return null;
      return (await res.json()) as KarviTaskProgress;
    } catch {
      return null;
    }
  }

  /**
   * 查詢 Karvi 可用的 runtimes + skills（discovery API）
   * GET /api/capabilities → 聚合回傳
   * Karvi 離線時回傳 null（graceful degradation — THY-06）
   */
  async getCapabilities(): Promise<KarviCapabilities | null> {
    try {
      const res = await fetch(`${this.karviUrl}/api/capabilities`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const raw: unknown = await res.json();
      const parsed = KarviCapabilitiesSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  startMonitor(intervalMs = 30_000): void {
    if (this.monitorInterval) return;
    this.monitorInterval = setInterval(() => {
      void this.getHealth();
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
