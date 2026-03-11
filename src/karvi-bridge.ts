import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { KarviEventNormalized } from './schemas/karvi-event';

export type { KarviEventNormalized } from './schemas/karvi-event';

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
}
