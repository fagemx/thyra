/**
 * Timeline event categorization + formatting utilities.
 * Evolves logic from ActivityStream.formatAuditEntry() with richer taxonomy.
 */

import type { AuditEntry, TimelineCategory, TimelineEvent, TimelineSeverity } from './types'

/**
 * 根據 entity_type + action 判斷事件分類
 */
export function categorizeEvent(entityType: string, action: string): TimelineCategory {
  // rollback 類
  if (action === 'rollback' || action === 'rolled_back') return 'rollback'

  // alert 類
  if (entityType === 'alert' || action.startsWith('alert_')) return 'alert'

  // policy 類 — constitution, law 相關
  if (action === 'supersede' || action === 'superseded') return 'policy'
  if (entityType === 'law' && (action === 'propose' || action === 'enact' || action === 'repeal')) return 'policy'
  if (entityType === 'constitution') return 'policy'

  // governance 類
  if (action === 'cycle_complete' || action === 'governance_action' || action === 'pipeline_dispatch') return 'governance'

  // change 類 — apply, create, revoke
  if (action === 'apply' || action === 'applied' || action === 'create' || action === 'created') return 'change'
  if (action === 'revoke' || action === 'revoked') return 'change'

  // system 類 — snapshot, webhook 等
  if (action === 'snapshot' || action === 'webhook' || entityType === 'system') return 'system'

  return 'system'
}

/**
 * 根據 action 判斷事件嚴重度
 */
export function getEventSeverity(action: string, entityType: string): TimelineSeverity {
  if (action === 'error' || action === 'rollback' || action === 'rolled_back') return 'error'
  if (entityType === 'alert') return 'warning'
  if (action === 'revoke' || action === 'revoked') return 'warning'
  if (action === 'supersede' || action === 'superseded') return 'warning'
  return 'info'
}

/**
 * 將 audit action 轉為可讀標題
 */
export function formatEventTitle(entityType: string, action: string, payload: Record<string, unknown>): string {
  switch (action) {
    case 'cycle_complete':
      return `Governance cycle: ${payload.applied ?? 0} applied, ${payload.rejected ?? 0} rejected`
    case 'apply':
    case 'applied':
      return `Applied ${entityType}: ${String(payload.name ?? payload.type ?? '')}`
    case 'rollback':
    case 'rolled_back':
      return `Rollback to snapshot ${String(payload.snapshot_id ?? '')}`
    case 'pipeline_dispatch':
      return `Pipeline dispatched for ${String(payload.chief_name ?? '')}`
    case 'governance_action':
      return `${String(payload.chief ?? 'Chief')} executed ${String(payload.action_type ?? 'action')}`
    case 'create':
    case 'created':
      return `Created ${entityType}: ${String(payload.name ?? '')}`
    case 'revoke':
    case 'revoked':
      return `Revoked ${entityType}: ${String(payload.name ?? '')}`
    case 'supersede':
    case 'superseded':
      return `Superseded ${entityType}: ${String(payload.name ?? '')}`
    case 'propose':
      return `Law proposed: ${String(payload.category ?? '')} — ${String(payload.content ?? '').slice(0, 60)}`
    case 'enact':
      return `Law enacted: ${String(payload.category ?? '')}`
    case 'repeal':
      return `Law repealed: ${String(payload.category ?? '')}`
    case 'snapshot':
      return `Snapshot taken: ${String(payload.trigger ?? 'manual')}`
    case 'error':
      return `Error in ${entityType}: ${String(payload.message ?? '')}`
    default:
      return `${entityType}.${action}`
  }
}

/**
 * 分類對應的顏色（CSS class 名稱）
 */
export function getCategoryColor(category: TimelineCategory): string {
  switch (category) {
    case 'governance': return '#3498db'
    case 'change': return '#2ecc71'
    case 'rollback': return '#e94560'
    case 'policy': return '#ffc107'
    case 'alert': return '#ff6b35'
    case 'system': return '#666'
  }
}

/**
 * 將 raw AuditEntry 轉為 enriched TimelineEvent
 */
export function enrichAuditEvent(entry: AuditEntry): TimelineEvent {
  const payload = parsePayload(entry.payload)
  const category = categorizeEvent(entry.entity_type, entry.action)
  const severity = getEventSeverity(entry.action, entry.entity_type)
  const title = formatEventTitle(entry.entity_type, entry.action, payload)

  return {
    id: entry.id,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    action: entry.action,
    payload,
    actor: entry.actor,
    created_at: entry.created_at,
    event_id: entry.event_id,
    category,
    title,
    severity,
  }
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown> }
    catch { return {} }
  }
  if (typeof raw === 'object' && raw !== null) {
    return raw as Record<string, unknown>
  }
  return {}
}

/**
 * 相對時間格式化
 */
export function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}
