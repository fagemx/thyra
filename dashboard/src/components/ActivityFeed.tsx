import { useActivityFeed } from '../hooks/useActivityFeed'
import type { AuditEntry } from '../api/types'
import styles from './ActivityFeed.module.css'

interface ActivityFeedProps {
  villageId: string
}

/** Map audit action to human-readable label */
function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    change_applied: 'Change applied',
    change_rejected: 'Change rejected',
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    supersede: 'Superseded',
    revoke: 'Revoked',
    propose: 'Proposed',
    enact: 'Enacted',
    repeal: 'Repealed',
    appoint: 'Appointed',
    dismiss: 'Dismissed',
    register: 'Registered',
    bind: 'Bound',
    start: 'Started',
    end: 'Ended',
  }
  return labels[action] ?? action
}

/** Map entity type + action to a color-coded dot class */
function dotClass(entry: AuditEntry): string {
  if (entry.action === 'change_rejected' || entry.action === 'delete') return styles.dotDanger
  if (entry.action === 'change_applied' || entry.action === 'create') return styles.dotSuccess
  if (entry.entity_type === 'constitution') return styles.dotConst
  return styles.dotDefault
}

/** Format timestamp to relative or short time */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diffSec = Math.floor((now - d.getTime()) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return d.toLocaleDateString()
}

export function ActivityFeed({ villageId }: ActivityFeedProps) {
  const { events, loading, error } = useActivityFeed(villageId)

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Activity Feed</h2>

      {loading && events.length === 0 && (
        <p className={styles.placeholder}>Loading events...</p>
      )}

      {error && events.length === 0 && (
        <p className={styles.errorText}>{error}</p>
      )}

      {!loading && events.length === 0 && !error && (
        <p className={styles.placeholder}>No events yet.</p>
      )}

      {events.length > 0 && (
        <ul className={styles.list}>
          {events.map((entry) => (
            <li key={entry.id} className={styles.event}>
              <span className={`${styles.dot} ${dotClass(entry)}`} />
              <div className={styles.eventBody}>
                <span className={styles.action}>
                  {actionLabel(entry.action)}
                </span>
                <span className={styles.entity}>
                  {entry.entity_type}
                  {entry.actor ? ` by ${entry.actor}` : ''}
                </span>
              </div>
              <span className={styles.time}>{formatTime(entry.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
