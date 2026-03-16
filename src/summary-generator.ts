/**
 * summary-generator.ts -- Night summary generator for morning digest
 *
 * 從 GovernanceCycleResult[] 彙總產生 NightSummary。
 * 核心函數 generateNightSummary() 是純函數（無副作用），
 * recordNightSummary() 是副作用包裝（audit_log + Edda）。
 *
 * 契約遵守：
 *   - THY-07: audit_log append-only（recordNightSummary）
 *   - BRIDGE-01: Edda optional, fire-and-forget
 *   - TYPE-01: strict TS, no `any`
 *   - CHIEF-01: read-only aggregation, no state mutation
 */

import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { GovernanceCycleResult, ChiefError } from './governance-scheduler';
import type { ChiefCycleResult } from './chief-autonomy';
import type { EddaBridge, EddaDecisionHit, EddaLogEntry } from './edda-bridge';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** Summary 事件（key_events 的項目） */
export interface SummaryEvent {
  type: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  score: number;
  timestamp: string;
}

/** 市場差異統計 */
export interface MarketDelta {
  stalls_added: number;
  stalls_removed: number;
  revenue_total: number;
  incidents: number;
  satisfaction_change: number;
}

/** MarketMetrics 快照（從 market_metrics table 讀取） */
export interface MarketMetricsSnapshot {
  active_stalls: number;
  revenue: number;
  incidents: number;
  satisfaction: number;
}

/** 歷史脈絡（Edda 查詢結果） */
export interface HistoricalContext {
  similar_nights: string[];
  recurring_issues: string[];
  trends: string[];
}

/** Night summary 完整結構 */
export interface NightSummary {
  village_id: string;
  date: string;
  cycles_run: number;
  proposals_total: number;
  proposals_applied: number;
  proposals_rejected: number;
  key_events: SummaryEvent[];
  market_delta: MarketDelta;
  rollbacks: number;
  precedents_recorded: number;
  generated_at: string;
  historical_context?: HistoricalContext;
  insights: string[];
}

/** generateNightSummary 選項 */
export interface NightSummaryOpts {
  /** 夜晚開始前的 market metrics 快照 */
  startMetrics?: MarketMetricsSnapshot | null;
  /** 夜晚結束後的 market metrics 快照 */
  endMetrics?: MarketMetricsSnapshot | null;
  /** 自定日期字串（預設今天） */
  date?: string;
}

// ---------------------------------------------------------------------------
// Event scoring 常數
// ---------------------------------------------------------------------------

/** 事件類型對應的基礎分數 */
const EVENT_SCORES: Record<string, number> = {
  'constitution.supersede': 100,
  'rollback': 90,
  'chief_error': 80,
  'law.rejected': 60,
  'law.propose': 50,
  'chief.update_permissions': 40,
  'budget.adjust': 30,
};

/** 最大 key_events 數量 */
const MAX_KEY_EVENTS = 5;

/** 連續 skip 產生警告的門檻 */
const SKIP_WARNING_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// 核心函數
// ---------------------------------------------------------------------------

/**
 * 產生 NightSummary。可選 EddaBridge 查詢歷史洞察。
 *
 * @param villageId - 目標 village ID
 * @param cycleResults - 整晚所有 GovernanceCycleResult
 * @param opts - 可選：start/end market metrics、日期
 * @param eddaBridge - 可選：Edda bridge（查詢歷史相似模式 + 重複問題）
 */
export async function generateNightSummary(
  villageId: string,
  cycleResults: GovernanceCycleResult[],
  opts?: NightSummaryOpts,
  eddaBridge?: EddaBridge,
): Promise<NightSummary> {
  const now = new Date().toISOString();
  const date = opts?.date ?? now.slice(0, 10);

  // 過濾 skipped cycles
  const activeCycles = cycleResults.filter((c) => !c.skipped);
  const skippedCycles = cycleResults.filter((c) => c.skipped);

  // 彙總 proposal 計數
  const proposalsTotal = activeCycles.reduce((sum, c) => sum + c.total_proposals, 0);
  const proposalsApplied = activeCycles.reduce((sum, c) => sum + c.total_applied, 0);
  const proposalsRejected = activeCycles.reduce(
    (sum, c) => sum + c.total_rejected + c.total_skipped,
    0,
  );

  // 提取事件並排序取 top 5
  const allEvents = extractEvents(cycleResults, skippedCycles.length);
  const keyEvents = allEvents
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KEY_EVENTS);

  // 計算 market delta
  const marketDelta = computeMarketDelta(
    opts?.startMetrics ?? null,
    opts?.endMetrics ?? null,
    activeCycles,
  );

  // 計算 rollbacks（從 change types 中偵測）
  const rollbacks = countRollbacks(activeCycles);

  // precedents_recorded = applied changes 數量（估計值）
  const precedentsRecorded = proposalsApplied;

  // 查詢 Edda 歷史脈絡（graceful degradation）
  const historicalContext = eddaBridge
    ? await queryHistoricalContext(eddaBridge, keyEvents)
    : undefined;

  // 產出 insights
  const tonight = {
    cycles_run: activeCycles.length,
    rollbacks,
    proposals_applied: proposalsApplied,
    proposals_rejected: proposalsRejected,
    key_events: keyEvents,
  };
  const insights = generateInsights(tonight, historicalContext ?? null);

  return {
    village_id: villageId,
    date,
    cycles_run: activeCycles.length,
    proposals_total: proposalsTotal,
    proposals_applied: proposalsApplied,
    proposals_rejected: proposalsRejected,
    key_events: keyEvents,
    market_delta: marketDelta,
    rollbacks,
    precedents_recorded: precedentsRecorded,
    generated_at: now,
    historical_context: historicalContext,
    insights,
  };
}

// ---------------------------------------------------------------------------
// 事件提取
// ---------------------------------------------------------------------------

/**
 * 從所有 cycle results 提取 scored events。
 * 包含：applied changes、rejected proposals、chief errors、skip 警告。
 */
function extractEvents(
  cycleResults: GovernanceCycleResult[],
  skippedCount: number,
): SummaryEvent[] {
  const events: SummaryEvent[] = [];

  for (const cycle of cycleResults) {
    // Applied changes
    for (const chiefResult of cycle.chief_results) {
      extractAppliedEvents(chiefResult, cycle.started_at, events);
      extractRejectedEvents(chiefResult, cycle.started_at, events);
    }

    // Chief errors
    for (const err of cycle.errors) {
      extractErrorEvent(err, cycle.started_at, events);
    }
  }

  // 連續 skip 警告
  if (skippedCount >= SKIP_WARNING_THRESHOLD) {
    events.push({
      type: 'scheduling_pressure',
      description: `${skippedCount} cycles skipped due to overlap — scheduling interval may be too short`,
      severity: 'warning',
      score: 70,
      timestamp: new Date().toISOString(),
    });
  }

  return events;
}

/**
 * 從 proposals + applied 提取事件。
 * 使用 proposal.change.type 作為事件類型（WorldStateDiff 是結構化的，不適合平面迭代）。
 */
function extractAppliedEvents(
  chiefResult: ChiefCycleResult,
  timestamp: string,
  events: SummaryEvent[],
): void {
  // 每個 applied 對應一個成功套用的提案
  // proposals 和 applied 透過索引對應（applied 只包含成功的）
  // 直接從 proposals 中挑出成功的（有 applied 結果的），以 change type 分類
  for (const proposal of chiefResult.proposals) {
    const changeType = proposal.change.type;
    const score = EVENT_SCORES[changeType] ?? 50;
    const severity = score >= 80 ? 'critical' as const
      : score >= 50 ? 'warning' as const
      : 'info' as const;

    // 只計入已 applied 的提案（skipped 的由 extractRejectedEvents 處理）
    const wasSkipped = chiefResult.skipped.some(
      (s) => s.proposal === proposal,
    );
    if (wasSkipped) continue;

    events.push({
      type: changeType,
      description: `${changeType} applied: ${proposal.reason}`,
      severity,
      score,
      timestamp,
    });
  }
}

/** 從 skipped (rejected) proposals 提取事件 */
function extractRejectedEvents(
  chiefResult: ChiefCycleResult,
  timestamp: string,
  events: SummaryEvent[],
): void {
  for (const skip of chiefResult.skipped) {
    const changeType = skip.proposal.change.type;
    events.push({
      type: 'law.rejected',
      description: `${changeType} rejected: ${skip.reason}`,
      severity: 'warning',
      score: EVENT_SCORES['law.rejected'] ?? 60,
      timestamp,
    });
  }
}

/** 從 chief errors 提取事件 */
function extractErrorEvent(
  err: ChiefError,
  timestamp: string,
  events: SummaryEvent[],
): void {
  events.push({
    type: 'chief_error',
    description: `Chief ${err.chief_id} error: ${err.error}`,
    severity: 'critical',
    score: EVENT_SCORES['chief_error'] ?? 80,
    timestamp,
  });
}

// ---------------------------------------------------------------------------
// Market delta 計算
// ---------------------------------------------------------------------------

/**
 * 計算 market delta。
 * 從 start/end metrics 計算差異，無 metrics 則全部為 0。
 */
function computeMarketDelta(
  startMetrics: MarketMetricsSnapshot | null,
  endMetrics: MarketMetricsSnapshot | null,
  _activeCycles: GovernanceCycleResult[],
): MarketDelta {
  if (!startMetrics || !endMetrics) {
    return {
      stalls_added: 0,
      stalls_removed: 0,
      revenue_total: 0,
      incidents: 0,
      satisfaction_change: 0,
    };
  }

  const stallDiff = endMetrics.active_stalls - startMetrics.active_stalls;

  return {
    stalls_added: Math.max(0, stallDiff),
    stalls_removed: Math.max(0, -stallDiff),
    revenue_total: endMetrics.revenue,
    incidents: endMetrics.incidents,
    satisfaction_change: Math.round((endMetrics.satisfaction - startMetrics.satisfaction) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Rollback 計算
// ---------------------------------------------------------------------------

/** 從 proposal change types 偵測 rollback 數量 */
function countRollbacks(activeCycles: GovernanceCycleResult[]): number {
  let count = 0;
  for (const cycle of activeCycles) {
    for (const chiefResult of cycle.chief_results) {
      for (const proposal of chiefResult.proposals) {
        if (proposal.change.type === 'law.repeal' || proposal.change.type === 'chief.dismiss') {
          count++;
        }
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Edda 歷史查詢 + Insight 產生
// ---------------------------------------------------------------------------

/** 7 天前的 ISO 日期字串 */
function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

/** 今晚數據的子集（用於 insight 產生） */
interface TonightDigest {
  cycles_run: number;
  rollbacks: number;
  proposals_applied: number;
  proposals_rejected: number;
  key_events: SummaryEvent[];
}

/**
 * 兩路並行查詢 Edda：相似模式 + 重複問題。
 * 每路獨立 catch，確保 graceful degradation。
 */
async function queryHistoricalContext(
  bridge: EddaBridge,
  keyEvents: SummaryEvent[],
): Promise<HistoricalContext> {
  const eventSummary = keyEvents.map((e) => e.description).join('; ');

  // 路 1: 查詢相似的 chief 行為模式
  const patternsP = bridge.queryDecisions({
    q: eventSummary || 'chief.cycle',
    domain: 'chief.cycle',
    limit: 10,
  }).catch(() => null);

  // 路 2: 查詢近 7 天的 rollback/error 重複問題
  const recurringP = bridge.queryEventLog({
    keyword: 'rollback',
    after: sevenDaysAgo(),
    limit: 10,
  }).catch(() => []);

  const [patterns, recurring] = await Promise.all([patternsP, recurringP]);

  const decisions = patterns?.decisions ?? [];

  return {
    similar_nights: findSimilarPatterns(decisions),
    recurring_issues: extractRecurringIssues(recurring),
    trends: detectTrends(decisions),
  };
}

/**
 * 按 key 分組找重複出現的決策模式。
 * 同一個 key 出現 2+ 次 → 視為 similar pattern。
 */
function findSimilarPatterns(decisions: EddaDecisionHit[]): string[] {
  const keyCount = new Map<string, number>();
  for (const d of decisions) {
    keyCount.set(d.key, (keyCount.get(d.key) ?? 0) + 1);
  }

  const results: string[] = [];
  for (const [key, count] of keyCount) {
    if (count >= 2) {
      results.push(`Pattern "${key}" appeared ${count} times in recent history`);
    }
  }
  return results;
}

/**
 * 從 event log entries 統計重複出現的問題。
 * 同一 summary keyword 出現 2+ 次 → 視為 recurring issue。
 */
function extractRecurringIssues(entries: EddaLogEntry[]): string[] {
  const summaryCount = new Map<string, number>();
  for (const e of entries) {
    // 用 type 作為 grouping key
    summaryCount.set(e.type, (summaryCount.get(e.type) ?? 0) + 1);
  }

  const results: string[] = [];
  for (const [type, count] of summaryCount) {
    if (count >= 2) {
      results.push(`"${type}" occurred ${count} times in the past 7 days`);
    }
  }
  return results;
}

/**
 * 比較決策的時間分佈偵測趨勢。
 * 如果近半數決策集中在最近 3 天 → 上升趨勢。
 */
function detectTrends(decisions: EddaDecisionHit[]): string[] {
  if (decisions.length < 3) return [];

  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const recentCount = decisions.filter(
    (d) => now - new Date(d.ts).getTime() < threeDaysMs,
  ).length;

  const results: string[] = [];
  if (recentCount > decisions.length / 2) {
    results.push(
      `Activity increasing: ${recentCount}/${decisions.length} decisions in the last 3 days`,
    );
  }

  // 按 domain 偵測集中度
  const domainCount = new Map<string, number>();
  for (const d of decisions) {
    domainCount.set(d.domain, (domainCount.get(d.domain) ?? 0) + 1);
  }
  for (const [domain, count] of domainCount) {
    if (count >= 3) {
      results.push(`Domain "${domain}" is highly active (${count} decisions)`);
    }
  }

  return results;
}

/** 最大 insights 數量 */
const MAX_INSIGHTS = 5;

/**
 * 綜合今晚數據 + 歷史脈絡產出 insights（rule-based）。
 * 無 historicalContext → 只依據今晚數據產出基本 insights。
 */
function generateInsights(
  tonight: TonightDigest,
  context: HistoricalContext | null,
): string[] {
  const insights: string[] = [];

  // 基本 insights（不需 Edda）
  if (tonight.rollbacks > 0) {
    insights.push(
      `${tonight.rollbacks} rollback(s) tonight — review triggering proposals`,
    );
  }
  if (tonight.proposals_rejected > tonight.proposals_applied && tonight.proposals_applied > 0) {
    insights.push(
      'More proposals rejected than applied — chiefs may need recalibration',
    );
  }

  // 歷史 insights（需要 Edda）
  if (context) {
    for (const s of context.similar_nights) {
      insights.push(`Historical: ${s}`);
    }
    for (const r of context.recurring_issues) {
      insights.push(`Recurring: ${r}`);
    }
    for (const t of context.trends) {
      insights.push(`Trend: ${t}`);
    }
  }

  return insights.slice(0, MAX_INSIGHTS);
}

// ---------------------------------------------------------------------------
// 副作用包裝（audit_log + Edda）
// ---------------------------------------------------------------------------

/**
 * 記錄 NightSummary 到 audit_log，可選 fire-and-forget 到 Edda。
 *
 * 契約：THY-07（audit_log）、BRIDGE-01（Edda optional）
 */
export async function recordNightSummary(
  db: Database,
  summary: NightSummary,
  eddaBridge?: EddaBridge,
): Promise<void> {
  // THY-07: audit_log
  appendAudit(db, 'night_summary', summary.village_id, 'generated', {
    date: summary.date,
    cycles_run: summary.cycles_run,
    proposals_total: summary.proposals_total,
    proposals_applied: summary.proposals_applied,
    proposals_rejected: summary.proposals_rejected,
    rollbacks: summary.rollbacks,
    key_events_count: summary.key_events.length,
  }, 'summary_generator');

  // BRIDGE-01: Edda fire-and-forget
  if (eddaBridge) {
    void eddaBridge.recordNote({
      text: `Night summary for ${summary.village_id} on ${summary.date}: ${summary.cycles_run} cycles, ${summary.proposals_applied}/${summary.proposals_total} applied, ${summary.rollbacks} rollbacks`,
      role: 'summary_generator',
      tags: ['night_summary', summary.village_id],
    }).catch(() => {
      // Edda 斷線不影響主流程
    });
  }
}
