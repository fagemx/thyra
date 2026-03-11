import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';

export interface EddaDecision {
  domain: string;
  aspect: string;
  value: string;
  reason: string;
  refs?: string[];
  timestamp?: string;
}

export interface EddaPrecedent {
  domain: string;
  aspect: string;
  value: string;
  reason: string;
  created_at: string;
  [key: string]: unknown;
}

export interface QueryOpts {
  domain: string;
  topic?: string;
  limit?: number;
}

export class EddaBridge {
  private healthy = false;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database,
    private eddaUrl: string,
  ) {}

  async queryDecisions(opts: QueryOpts): Promise<EddaPrecedent[]> {
    try {
      const params = new URLSearchParams({ domain: opts.domain });
      if (opts.topic) params.set('topic', opts.topic);
      if (opts.limit) params.set('limit', String(opts.limit));

      const res = await fetch(`${this.eddaUrl}/api/decisions?${params}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];
      const data = await res.json() as { decisions?: EddaPrecedent[] };
      return data.decisions ?? [];
    } catch {
      // Graceful degradation: Edda offline → empty results
      return [];
    }
  }

  async recordDecision(decision: EddaDecision): Promise<{ ok: boolean; eventId?: string }> {
    const key = `${decision.domain}.${decision.aspect}`;
    try {
      const body = {
        decision: `${key}=${decision.value}`,
        reason: decision.reason || undefined,
      };
      const res = await fetch(`${this.eddaUrl}/api/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json() as { event_id?: string };
        appendAudit(this.db, 'edda', key, 'record', decision, 'system');
        return { ok: true, eventId: data.event_id };
      }
      return { ok: false };
    } catch {
      // Graceful degradation: log warning, don't crash
      appendAudit(this.db, 'edda', key, 'record_failed', { ...decision, error: 'Edda unreachable' }, 'system');
      return { ok: false };
    }
  }

  async getHealth(): Promise<{ ok: boolean; url: string }> {
    try {
      const res = await fetch(`${this.eddaUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      this.healthy = res.ok;
      return { ok: res.ok, url: this.eddaUrl };
    } catch {
      this.healthy = false;
      return { ok: false, url: this.eddaUrl };
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  getRecentRecorded(limit = 20): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT entity_id, action, payload, created_at
      FROM audit_log WHERE entity_type = 'edda'
      ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.entity_id,
      action: r.action,
      payload: JSON.parse((r.payload as string) || '{}'),
      created_at: r.created_at,
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
}
