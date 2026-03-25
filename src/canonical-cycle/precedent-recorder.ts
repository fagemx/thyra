/**
 * canonical-cycle/precedent-recorder.ts — PrecedentRecord 建構器
 *
 * 從完成的 OutcomeReport 建構先例記錄：
 * - 自動收錄觸發：beneficial / harmful 自動建立，inconclusive 跳過
 * - Append-only — 沒有 UPDATE 或 DELETE（PREC-02）
 * - 必須連結 proposalId + outcomeReportId（PREC-01）
 * - 所有狀態變更寫 audit_log（THY-07）
 *
 * @see docs/plan/world-cycle/TRACK_F_PRECEDENT_RECORDER.md Step 1
 */

import { generateId, ID_PREFIXES } from '../cross-layer/id-generator';
import { escapeLikePattern } from '../cross-layer/escape-like';
import type { Database } from '../db';
import { appendAudit } from '../db';
import type { EddaBridge } from '../edda-bridge';
import type { OutcomeReport } from '../schemas/outcome-report';
import type { ChangeKind } from '../schemas/canonical-proposal';
import {
  PrecedentRecordSchema,
  CreatePrecedentInputSchema,
  type PrecedentRecord,
  type CreatePrecedentInput,
} from '../schemas/precedent-record';

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface PrecedentContext {
  worldId: string;
  worldType: string;
  proposalId: string;
  changeKind: ChangeKind;
  cycleId: string;
  worldStateDescription: string;
  decisionDescription: string;
  tags: string[];
}

export interface PrecedentFilter {
  changeKind?: string;
  verdict?: string;
  contextTag?: string;
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface PrecedentRow {
  id: string;
  world_id: string;
  world_type: string;
  proposal_id: string;
  outcome_report_id: string;
  change_kind: string;
  cycle_id: string;
  context: string;
  decision: string;
  outcome: string;
  recommendation: string;
  lessons_learned: string;
  context_tags: string;
  version: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// PrecedentRecorder
// ---------------------------------------------------------------------------

export class PrecedentRecorder {
  constructor(
    private db: Database,
    private eddaBridge?: EddaBridge,
  ) {}

  /**
   * 從 OutcomeReport + context 建構 PrecedentRecord。
   *
   * 自動收錄觸發：
   * - beneficial / harmful → 自動建立
   * - neutral → 自動建立（有學習價值）
   * - inconclusive → 跳過（無足夠資料）
   */
  buildFromOutcome(
    report: OutcomeReport,
    context: PrecedentContext,
  ): PrecedentRecord | null {
    if (report.verdict === 'inconclusive') return null;

    const input: CreatePrecedentInput = {
      worldId: context.worldId,
      worldType: context.worldType,
      proposalId: context.proposalId,
      outcomeReportId: report.id,
      changeKind: context.changeKind,
      cycleId: context.cycleId,
      context: context.worldStateDescription,
      decision: context.decisionDescription,
      outcome: report.verdict,
      recommendation: report.recommendation,
      lessonsLearned: this.extractLessons(report),
      contextTags: context.tags,
    };

    // Validate（PREC-01: proposalId + outcomeReportId required）
    CreatePrecedentInputSchema.parse(input);

    return this.create(input);
  }

  /**
   * INSERT precedent into DB. Append-only — no UPDATE or DELETE（PREC-02）。
   */
  create(input: CreatePrecedentInput): PrecedentRecord {
    const id = generateId(ID_PREFIXES.precedent);
    const createdAt = new Date().toISOString();

    // INSERT only — never UPDATE or DELETE（PREC-02）
    this.db.prepare(`
      INSERT INTO precedent_records (
        id, world_id, world_type, proposal_id, outcome_report_id,
        change_kind, cycle_id, context, decision, outcome,
        recommendation, lessons_learned, context_tags, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.worldId,
      input.worldType,
      input.proposalId,
      input.outcomeReportId,
      input.changeKind,
      input.cycleId,
      input.context,
      input.decision,
      input.outcome,
      input.recommendation,
      JSON.stringify(input.lessonsLearned),
      JSON.stringify(input.contextTags),
      1,
      createdAt,
    );

    // THY-07: audit log
    appendAudit(this.db, 'precedent_record', id, 'created', { ...input }, 'system');

    // THY-06: fire-and-forget — 送先例到 Edda（graceful degradation）
    if (this.eddaBridge) {
      void this.eddaBridge.recordDecision({
        domain: 'world.precedent',
        aspect: input.changeKind,
        value: input.outcome,
        reason: input.lessonsLearned.join('; '),
      }).catch(() => { /* Edda 斷線不影響主流程 */ });
    }

    return PrecedentRecordSchema.parse({
      id,
      ...input,
      createdAt,
      version: 1,
    });
  }

  /**
   * 取得單筆 PrecedentRecord
   */
  get(id: string): PrecedentRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM precedent_records WHERE id = ?',
    ).get(id) as PrecedentRow | null;

    if (!row) return null;
    return this.rowToRecord(row);
  }

  /**
   * 列出指定 world 的所有 PrecedentRecords，可過濾
   */
  listByWorld(worldId: string, filters?: PrecedentFilter): PrecedentRecord[] {
    let sql = 'SELECT * FROM precedent_records WHERE world_id = ?';
    const params: string[] = [worldId];

    if (filters?.changeKind) {
      sql += ' AND change_kind = ?';
      params.push(filters.changeKind);
    }
    if (filters?.verdict) {
      sql += ' AND outcome = ?';
      params.push(filters.verdict);
    }
    if (filters?.contextTag) {
      sql += " AND context_tags LIKE ? ESCAPE '\\'";
      params.push(`%"${escapeLikePattern(filters.contextTag)}"%`);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as PrecedentRow[];
    return rows.map(r => this.rowToRecord(r));
  }

  /**
   * 從 OutcomeReport 萃取 lessons learned
   */
  private extractLessons(report: OutcomeReport): string[] {
    const lessons: string[] = [];

    // 從預期效果分析
    const matched = report.expectedEffects.filter(e => e.matched).length;
    const total = report.expectedEffects.length;
    if (total > 0) {
      if (matched === total) {
        lessons.push('All expected effects materialized as predicted');
      } else if (matched === 0) {
        lessons.push('None of the expected effects materialized');
      } else {
        lessons.push(`Partial effect: ${matched}/${total} expected effects matched`);
      }
    }

    // 從副作用分析
    const significant = report.sideEffects.filter(s => s.severity === 'significant');
    if (significant.length > 0) {
      for (const se of significant) {
        lessons.push(`Significant side effect on ${se.metric}: delta=${se.delta}`);
      }
    }

    // 從 verdict 分析
    if (report.verdict === 'harmful') {
      lessons.push('Change produced harmful outcome — avoid similar approach');
    } else if (report.verdict === 'beneficial') {
      lessons.push('Change produced beneficial outcome — consider reinforcing');
    } else if (report.verdict === 'neutral') {
      lessons.push('Change had mixed results — consider retuning parameters');
    }

    // 加入 report notes
    for (const note of report.notes) {
      lessons.push(note);
    }

    return lessons;
  }

  /**
   * DB row → PrecedentRecord
   */
  private rowToRecord(row: PrecedentRow): PrecedentRecord {
    return PrecedentRecordSchema.parse({
      id: row.id,
      worldId: row.world_id,
      worldType: row.world_type,
      proposalId: row.proposal_id,
      outcomeReportId: row.outcome_report_id,
      changeKind: row.change_kind,
      cycleId: row.cycle_id,
      context: row.context,
      decision: row.decision,
      outcome: row.outcome,
      recommendation: row.recommendation,
      lessonsLearned: JSON.parse(row.lessons_learned) as string[],
      contextTags: JSON.parse(row.context_tags) as string[],
      createdAt: row.created_at,
      version: row.version,
    });
  }
}
