/**
 * alert-triggers.ts -- Condition checkers for 6 alert types (#236)
 *
 * Pure functions that check conditions and call AlertManager.emit().
 * Designed to be called from governance-scheduler, world-manager, etc.
 */

import type { Database } from 'bun:sqlite';
import type { AlertManager } from './alert-manager';
import type { AlertSeverity } from './schemas/alert';

// ---------------------------------------------------------------------------
// Budget alert
// ---------------------------------------------------------------------------

/**
 * Check budget utilization and emit/auto-resolve alerts.
 * - >= 0.80 -> warning
 * - >= 0.95 -> critical
 * - >= 1.00 -> emergency
 * - < 0.70 (was warning) -> auto-resolve existing
 */
export function checkBudgetAlert(
  am: AlertManager,
  villageId: string,
  utilization: number,
  limits: { max_cost_per_day: number },
): void {
  // Auto-resolve if utilization dropped below 70%
  if (utilization < 0.70) {
    const existing = am.findActiveByType(villageId, 'budget_warning');
    for (const alert of existing) {
      am.autoResolve(alert.id, `utilization dropped to ${Math.round(utilization * 100)}%`);
    }
    return;
  }

  if (utilization < 0.80) return;

  let severity: AlertSeverity;
  if (utilization >= 1.00) severity = 'emergency';
  else if (utilization >= 0.95) severity = 'critical';
  else severity = 'warning';

  const pct = Math.round(utilization * 100);
  am.emit(
    villageId,
    'budget_warning',
    severity,
    `Budget ${pct}% utilized`,
    `Daily budget utilization at ${pct}% (limit: ${limits.max_cost_per_day})`,
    { utilization, limit: limits.max_cost_per_day },
  );
}

// ---------------------------------------------------------------------------
// Chief timeout alert
// ---------------------------------------------------------------------------

export interface ChiefTimeoutInfo {
  chief_id: string;
  chief_name: string;
  village_id: string;
  timeout_count: number;
  auto_paused: boolean;
  run_id?: string;
}

/**
 * Check chief timeout and emit alerts.
 * - first timeout -> warning
 * - consecutive -> critical
 * - auto-paused -> emergency
 */
export function checkChiefTimeoutAlert(
  am: AlertManager,
  info: ChiefTimeoutInfo,
): void {
  let severity: AlertSeverity;
  if (info.auto_paused) severity = 'emergency';
  else if (info.timeout_count > 1) severity = 'critical';
  else severity = 'warning';

  am.emit(
    info.village_id,
    'chief_timeout',
    severity,
    `Chief "${info.chief_name}" heartbeat lost`,
    info.auto_paused
      ? `Chief "${info.chief_name}" auto-paused after ${info.timeout_count} consecutive timeouts`
      : `Chief "${info.chief_name}" heartbeat timeout #${info.timeout_count}`,
    {
      chief_id: info.chief_id,
      chief_name: info.chief_name,
      timeout_count: info.timeout_count,
      auto_paused: info.auto_paused,
      run_id: info.run_id,
    },
  );
}

// ---------------------------------------------------------------------------
// Consecutive rollbacks alert
// ---------------------------------------------------------------------------

/** Default: look at last 24 hours */
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Check consecutive rollbacks from audit_log.
 * - count >= 3 -> warning
 * - count >= 5 -> critical
 */
export function checkConsecutiveRollbacks(
  am: AlertManager,
  db: Database,
  villageId: string,
): void {
  const cutoff = new Date(Date.now() - ROLLBACK_WINDOW_MS).toISOString();
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM audit_log
     WHERE entity_type = 'world' AND entity_id = ? AND action = 'rollback'
     AND created_at >= ?`
  ).get(villageId, cutoff) as { cnt: number };

  const count = row.cnt;
  if (count < 3) return;

  const severity: AlertSeverity = count >= 5 ? 'critical' : 'warning';
  am.emit(
    villageId,
    'consecutive_rollbacks',
    severity,
    `${count} rollbacks in 24h`,
    `Village has ${count} rollbacks in the last 24 hours`,
    { rollback_count: count, window_hours: 24 },
  );
}

// ---------------------------------------------------------------------------
// Health drop alert
// ---------------------------------------------------------------------------

/**
 * Check world health drop and emit alerts.
 * Reads and updates villages.last_health_score for delta tracking.
 *
 * - drop >= 10 -> warning
 * - drop >= 20 -> critical
 * - overall < 30 -> emergency (regardless of delta)
 */
export function checkHealthDrop(
  am: AlertManager,
  db: Database,
  villageId: string,
  currentHealth: number,
): void {
  // Read previous health score
  const row = db.prepare(
    'SELECT last_health_score FROM villages WHERE id = ?'
  ).get(villageId) as { last_health_score: number | null } | null;

  const previousScore = row?.last_health_score;

  // Update stored score
  db.prepare(
    'UPDATE villages SET last_health_score = ? WHERE id = ?'
  ).run(currentHealth, villageId);

  // Emergency: overall below 30 regardless of delta
  if (currentHealth < 30) {
    am.emit(
      villageId,
      'health_drop',
      'emergency',
      `World health critical: ${currentHealth}`,
      `World health score dropped to ${currentHealth} (below 30 threshold)`,
      { current: currentHealth, previous: previousScore, delta: previousScore != null ? previousScore - currentHealth : null },
    );
    return;
  }

  // No previous score -> first reading, skip delta check
  if (previousScore == null) return;

  const delta = previousScore - currentHealth;
  if (delta < 10) {
    // Health recovered or stable — auto-resolve existing alerts
    const existing = am.findActiveByType(villageId, 'health_drop');
    for (const alert of existing) {
      am.autoResolve(alert.id, `health recovered to ${currentHealth}`);
    }
    return;
  }

  const severity: AlertSeverity = delta >= 20 ? 'critical' : 'warning';
  am.emit(
    villageId,
    'health_drop',
    severity,
    `World health dropped ${delta} points`,
    `World health dropped from ${previousScore} to ${currentHealth} (-${delta})`,
    { current: currentHealth, previous: previousScore, delta },
  );
}

// ---------------------------------------------------------------------------
// High-risk proposal alert
// ---------------------------------------------------------------------------

export interface HighRiskInfo {
  change_type: string;
  reasons: string[];
  requires_approval?: boolean;
}

/**
 * Emit alert for high-risk proposals that need human approval.
 * Always critical severity.
 */
export function checkHighRiskAlert(
  am: AlertManager,
  villageId: string,
  info: HighRiskInfo,
): void {
  am.emit(
    villageId,
    'high_risk_proposal',
    'critical',
    `High-risk proposal: ${info.change_type}`,
    `Change "${info.change_type}" requires human approval: ${info.reasons.join('; ')}`,
    {
      change_type: info.change_type,
      reasons: info.reasons,
      requires_approval: info.requires_approval ?? true,
    },
  );
}

// ---------------------------------------------------------------------------
// Anomaly alert (Edda pattern)
// ---------------------------------------------------------------------------

export interface AnomalyInfo {
  pattern: string;
  confidence: number;
  description: string;
}

/**
 * Emit alert for anomaly detected by Edda.
 * Severity based on confidence level.
 */
export function checkAnomalyAlert(
  am: AlertManager,
  villageId: string,
  info: AnomalyInfo,
): void {
  const severity: AlertSeverity = info.confidence >= 0.9 ? 'critical' : 'warning';
  am.emit(
    villageId,
    'anomaly',
    severity,
    `Anomaly detected: ${info.pattern}`,
    info.description,
    {
      pattern: info.pattern,
      confidence: info.confidence,
    },
  );
}
