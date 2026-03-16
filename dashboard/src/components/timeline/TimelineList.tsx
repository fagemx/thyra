/**
 * TimelineList — 主時間軸容器。
 * compact 模式：嵌入 OperatorDashboard，無篩選
 * full 模式：獨立頁面，有篩選 + SSE 狀態
 */

import type { TimelineCategory, TimelineEvent } from '../../api/types'
import { getCategoryColor } from '../../api/timeline'
import { TimelineCard } from './TimelineCard'
import styles from './TimelineList.module.css'

const ALL_CATEGORIES: TimelineCategory[] = [
  'governance', 'change', 'rollback', 'policy', 'alert', 'system',
]

interface TimelineListProps {
  events: TimelineEvent[]
  connected: boolean
  error: boolean
  compact?: boolean
  /** Filter state — only used in full mode */
  filters?: Set<TimelineCategory>
  onToggleFilter?: (category: TimelineCategory) => void
}

export function TimelineList({
  events,
  connected,
  error,
  compact = false,
  filters,
  onToggleFilter,
}: TimelineListProps) {
  const displayEvents = compact ? events.slice(0, 15) : events

  return (
    <div className={`${styles.container} ${compact ? styles.containerCompact : styles.containerFull}`}>
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.title}>
          {compact ? 'Timeline' : 'Governance Timeline'}
        </h2>
        <div className={styles.status}>
          <span
            className={`${styles.statusDot} ${connected ? styles.statusConnected : styles.statusDisconnected}`}
          />
          <span className={styles.statusLabel}>
            {connected ? 'Live' : error ? 'Disconnected' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Filters — full mode only */}
      {!compact && filters && onToggleFilter && (
        <div className={styles.filters}>
          {ALL_CATEGORIES.map((cat) => {
            const active = filters.has(cat)
            const color = getCategoryColor(cat)
            return (
              <button
                key={cat}
                className={`${styles.filterPill} ${active ? styles.filterPillActive : ''}`}
                style={active ? { '--pill-color': color } as React.CSSProperties : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFilter(cat)
                }}
              >
                {cat}
              </button>
            )
          })}
        </div>
      )}

      {/* Event list */}
      <div className={styles.list}>
        {error && events.length === 0 && (
          <p className={styles.error}>Failed to connect to event stream</p>
        )}

        {!error && events.length === 0 && (
          <p className={styles.empty}>No events yet</p>
        )}

        {displayEvents.map((event) => (
          <TimelineCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  )
}
