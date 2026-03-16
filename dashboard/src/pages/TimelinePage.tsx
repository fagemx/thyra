/**
 * TimelinePage — 全頁時間軸。
 * 路由：/timeline
 */

import type { TimelineCategory } from '../api/types'
import { useTimelineSSE } from '../hooks/useTimelineSSE'
import { TimelineList } from '../components/timeline/TimelineList'

interface TimelinePageProps {
  villageId: string
}

export function TimelinePage({ villageId }: TimelinePageProps) {
  const { filteredEvents, connected, error, filters, setFilters } = useTimelineSSE(villageId)

  const handleToggleFilter = (category: TimelineCategory) => {
    setFilters((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TimelineList
        events={filteredEvents}
        connected={connected}
        error={error}
        compact={false}
        filters={filters}
        onToggleFilter={handleToggleFilter}
      />
    </div>
  )
}
