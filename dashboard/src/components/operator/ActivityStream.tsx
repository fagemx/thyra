import { useCallback } from 'react'
import { listAudit } from '../../api/client'
import type { AuditEntry } from '../../api/types'
import { usePolling } from '../../hooks/usePolling'
import styles from './ActivityStream.module.css'

interface ActivityStreamProps {
  villageId: string
}

type DotColor = 'dotGreen' | 'dotRed' | 'dotBlue' | 'dotYellow' | 'dotGray'

function parsePayload(entry: AuditEntry): Record<string, unknown> {
  if (typeof entry.payload === 'string') {
    try { return JSON.parse(entry.payload) as Record<string, unknown> }
    catch { return {} }
  }
  if (typeof entry.payload === 'object' && entry.payload !== null) {
    return entry.payload as Record<string, unknown>
  }
  return {}
}

function formatAuditEntry(entry: AuditEntry): { message: string; dot: DotColor } {
  const action = entry.action
  const details = parsePayload(entry)
  const entityType = entry.entity_type

  switch (action) {
    case 'cycle_complete':
      return {
        message: `Governance cycle: ${details.applied ?? 0} applied, ${details.rejected ?? 0} rejected`,
        dot: 'dotBlue',
      }
    case 'apply':
    case 'applied':
      return {
        message: `Applied ${entityType}: ${String(details.name ?? details.type ?? entry.entity_id)}`,
        dot: 'dotGreen',
      }
    case 'rollback':
      return {
        message: `Rolled back to snapshot ${String(details.snapshot_id ?? entry.entity_id)}`,
        dot: 'dotRed',
      }
    case 'pipeline_dispatch':
      return {
        message: `Dispatched pipeline for ${String(details.chief_name ?? entry.entity_id)}`,
        dot: 'dotBlue',
      }
    case 'governance_action':
      return {
        message: `${String(details.chief ?? entry.actor)} executed ${String(details.action_type ?? 'action')}`,
        dot: 'dotYellow',
      }
    case 'create':
    case 'created':
      return {
        message: `Created ${entityType}: ${String(details.name ?? entry.entity_id)}`,
        dot: 'dotGreen',
      }
    case 'revoke':
    case 'revoked':
      return {
        message: `Revoked ${entityType}: ${String(details.name ?? entry.entity_id)}`,
        dot: 'dotRed',
      }
    case 'supersede':
    case 'superseded':
      return {
        message: `Superseded ${entityType}: ${String(details.name ?? entry.entity_id)}`,
        dot: 'dotYellow',
      }
    case 'error':
      return {
        message: `Error in ${entityType}: ${String(details.message ?? entry.entity_id)}`,
        dot: 'dotRed',
      }
    default:
      return {
        message: `${entityType}.${action}: ${entry.entity_id}`,
        dot: 'dotGray',
      }
  }
}

function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

export function ActivityStream({ villageId }: ActivityStreamProps) {
  const fetcher = useCallback(
    () => listAudit(villageId, 30),
    [villageId],
  )

  const { data, loading, error } = usePolling(fetcher, 15_000)

  if (loading && !data) {
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>Activity Stream</h2>
        <p className={styles.empty}>Loading activity...</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>Activity Stream</h2>
        <p className={styles.error}>{error}</p>
      </div>
    )
  }

  const entries = data ?? []

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Activity Stream</h2>
      {entries.length === 0 ? (
        <p className={styles.empty}>No recent activity</p>
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => {
            const { message, dot } = formatAuditEntry(entry)
            return (
              <div key={entry.id} className={styles.entry}>
                <span className={`${styles.dot} ${styles[dot]}`} />
                <div className={styles.content}>
                  <span className={styles.message}>{message}</span>
                </div>
                <span className={styles.time}>
                  {formatRelativeTime(entry.created_at)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
