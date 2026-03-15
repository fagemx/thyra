import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import { EddaLogResponseSchema } from './schemas/edda-bridge';

// --- Edda-aligned types (matches edda-ask AskResult / DecisionHit) ---

/** 匹配 Edda 的 DecisionHit 結構 */
export interface EddaDecisionHit {
  event_id: string;
  key: string;        // "domain.aspect" 格式，例如 "db.engine"
  value: string;
  reason: string;
  domain: string;     // 從 key 前綴自動提取
  branch: string;
  ts: string;
  is_active: boolean;
}

/** 匹配 Edda 的 CommitHit */
export interface EddaCommitHit {
  event_id: string;
  title: string;
  purpose: string;
  ts: string;
  branch: string;
  match_type: string;
}

/** 匹配 Edda 的 NoteHit */
export interface EddaNoteHit {
  event_id: string;
  text: string;
  ts: string;
  branch: string;
}

/** 匹配 Edda 的 AskResult（選擇性欄位） */
export interface EddaQueryResult {
  query: string;
  input_type: string;  // "exact_key" | "domain" | "keyword" | "overview"
  decisions: EddaDecisionHit[];
  timeline: EddaDecisionHit[];
  related_commits: EddaCommitHit[];
  related_notes: EddaNoteHit[];
}

/** POST /api/decide 的回應 */
export interface EddaDecideResult {
  event_id: string;
  superseded?: string;
}

/** 查詢選項，對應 Edda 的 DecisionsQuery */
export interface QueryOpts {
  q?: string;                  // 自由查詢（key、domain 或 keyword）
  domain?: string;             // 便利欄位：設定 q=domain
  keyword?: string;            // 便利欄位：設定 q=keyword
  limit?: number;              // 預設 20
  includeSuperseded?: boolean; // 對應 ?all=true
  branch?: string;             // 篩選 branch
}

/** recordDecision 的輸入 */
export interface RecordDecisionInput {
  domain: string;
  aspect: string;
  value: string;
  reason?: string;
}

/** POST /api/note 的回應 */
export interface EddaNoteResult {
  event_id: string;
}

/** recordNote 的輸入 */
export interface RecordNoteInput {
  text: string;
  role?: string;
  tags?: string[];
}

/** GET /api/log 的單一項目 */
export interface EddaLogEntry {
  event_id: string;
  type: string;
  summary: string;
  ts: string;
  branch?: string;
  tags?: string[];
}

/** queryEventLog 的選項 */
export interface EventLogOpts {
  type?: string;
  keyword?: string;
  after?: string;
  before?: string;
  limit?: number;
}

// --- Helper ---

function emptyResult(query: string): EddaQueryResult {
  return {
    query,
    input_type: 'overview',
    decisions: [],
    timeline: [],
    related_commits: [],
    related_notes: [],
  };
}

// --- Bridge class ---

export class EddaBridge {
  private healthy = false;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database,
    private eddaUrl: string,
  ) {}

  /**
   * 查詢 Edda 決策。使用 GET /api/decisions?q=...&limit=...&all=...&branch=...
   * q 參數支援 exact key（含 .）、domain、keyword、空（overview）
   */
  async queryDecisions(opts: QueryOpts): Promise<EddaQueryResult> {
    const q = opts.q ?? opts.domain ?? opts.keyword ?? '';
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.includeSuperseded) params.set('all', 'true');
      if (opts.branch) params.set('branch', opts.branch);

      const qs = params.toString();
      const url = `${this.eddaUrl}/api/decisions${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return emptyResult(q);
      const data = await res.json() as EddaQueryResult;
      return {
        query: data.query,
        input_type: data.input_type,
        decisions: data.decisions,
        timeline: data.timeline,
        related_commits: data.related_commits,
        related_notes: data.related_notes,
      };
    } catch {
      // Graceful degradation: Edda offline → empty results
      return emptyResult(q);
    }
  }

  /**
   * 記錄決策到 Edda。使用 POST /api/decide，body 為 { decision: "key=value", reason }
   */
  async recordDecision(decision: RecordDecisionInput): Promise<EddaDecideResult | null> {
    const key = `${decision.domain}.${decision.aspect}`;
    try {
      const res = await fetch(`${this.eddaUrl}/api/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: `${key}=${decision.value}`,
          reason: decision.reason,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const result = await res.json() as EddaDecideResult;
        appendAudit(this.db, 'edda', key, 'record', { ...decision, event_id: result.event_id }, 'system');
        return result;
      }
      return null;
    } catch {
      // Graceful degradation: log warning, don't crash
      appendAudit(this.db, 'edda', key, 'record_failed', { ...decision, error: 'Edda unreachable' }, 'system');
      return null;
    }
  }

  /**
   * 記錄筆記到 Edda。使用 POST /api/note
   */
  async recordNote(input: RecordNoteInput): Promise<EddaNoteResult | null> {
    try {
      const res = await fetch(`${this.eddaUrl}/api/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: input.text,
          role: input.role,
          tags: input.tags,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const result = await res.json() as EddaNoteResult;
        appendAudit(this.db, 'edda', 'note', 'record_note', {
          text: input.text.slice(0, 100),
          role: input.role,
          tags: input.tags,
          event_id: result.event_id,
        }, 'system');
        return result;
      }
      return null;
    } catch {
      appendAudit(this.db, 'edda', 'note', 'record_note_failed', {
        text: input.text.slice(0, 100),
        error: 'Edda unreachable',
      }, 'system');
      return null;
    }
  }

  /**
   * 查詢 Edda 事件日誌。使用 GET /api/log
   */
  async queryEventLog(opts?: EventLogOpts): Promise<EddaLogEntry[]> {
    try {
      const params = new URLSearchParams();
      if (opts?.type) params.set('type', opts.type);
      if (opts?.keyword) params.set('keyword', opts.keyword);
      if (opts?.after) params.set('after', opts.after);
      if (opts?.before) params.set('before', opts.before);
      if (opts?.limit) params.set('limit', String(opts.limit));

      const qs = params.toString();
      const url = `${this.eddaUrl}/api/log${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];
      const data: unknown = await res.json();
      const parsed = EddaLogResponseSchema.safeParse(data);
      if (!parsed.success) return [];

      const entries: EddaLogEntry[] = Array.isArray(parsed.data)
        ? parsed.data.map((e) => ({
            event_id: e.event_id,
            type: e.type,
            summary: e.summary,
            ts: e.ts,
            branch: e.branch,
            tags: e.tags,
          }))
        : parsed.data.events.map((e) => ({
            event_id: e.event_id,
            type: e.event_type,
            summary: e.detail,
            ts: e.ts,
            branch: e.branch,
            tags: e.tags,
          }));
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * 取得決策的 outcomes。使用 GET /api/decisions/{event_id}/outcomes
   */
  async getDecisionOutcomes(eventId: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${this.eddaUrl}/api/decisions/${eventId}/outcomes`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return await res.json() as Record<string, unknown>;
    } catch {
      return null;
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
      payload: JSON.parse((r.payload as string) || '{}') as Record<string, unknown>,
      created_at: r.created_at,
    }));
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
}
