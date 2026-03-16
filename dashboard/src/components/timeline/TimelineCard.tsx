/**
 * TimelineCard — 單一事件的折疊/展開卡片。
 * 折疊狀態：dot + title + severity badge + timestamp
 * 展開狀態：增加 actor、payload detail、judge result、diff
 */

import { useState } from 'react'
import type { TimelineEvent } from '../../api/types'
import { getCategoryColor, formatRelativeTime } from '../../api/timeline'
import { TimelineEventDetail } from './TimelineEventDetail'
import styles from './TimelineCard.module.css'

interface TimelineCardProps {
  event: TimelineEvent
}

export function TimelineCard({ event }: TimelineCardProps) {
  const [expanded, setExpanded] = useState(false)
  const color = getCategoryColor(event.category)

  const severityClass =
    event.severity === 'error' ? styles.severityError :
    event.severity === 'warning' ? styles.severityWarning :
    styles.severityInfo

  return (
    <div
      className={`${styles.card} ${expanded ? styles.cardExpanded : ''}`}
      style={{ '--tl-color': color } as React.CSSProperties}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className={styles.header}>
        <span className={styles.dot} />
        <span className={styles.title}>{event.title}</span>
        <div className={styles.meta}>
          {event.severity !== 'info' && (
            <span className={`${styles.severity} ${severityClass}`}>
              {event.severity}
            </span>
          )}
          <span className={styles.time}>
            {formatRelativeTime(event.created_at)}
          </span>
        </div>
      </div>

      {expanded && (
        <>
          <div className={styles.actor}>
            {event.actor} &middot; {event.entity_type}:{event.entity_id}
          </div>
          <div className={styles.detail}>
            <TimelineEventDetail event={event} />
          </div>
        </>
      )}
    </div>
  )
}
