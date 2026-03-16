/**
 * useTimelineSSE — SSE hook for governance event timeline.
 * Connects to GET /api/villages/:id/world/events?interval=3000
 * and provides enriched TimelineEvent[] to subscribers.
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import type { AuditEntry, TimelineEvent, TimelineCategory } from '../api/types'
import { enrichAuditEvent } from '../api/timeline'

const BASE = '/api'

interface UseTimelineSSEResult {
  events: TimelineEvent[]
  connected: boolean
  error: boolean
  /** 當前啟用的分類篩選 */
  filters: Set<TimelineCategory>
  setFilters: (value: Set<TimelineCategory> | ((prev: Set<TimelineCategory>) => Set<TimelineCategory>)) => void
  /** 篩選後的事件 */
  filteredEvents: TimelineEvent[]
}

export function useTimelineSSE(villageId: string | null): UseTimelineSSEResult {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(false)
  const [filters, setFilters] = useState<Set<TimelineCategory>>(new Set())
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!villageId) {
      setEvents([])
      setConnected(false)
      setError(false)
      return
    }

    setError(false)

    const url = `${BASE}/villages/${villageId}/world/events?interval=3000`
    const source = new EventSource(url)
    sourceRef.current = source

    source.addEventListener('timeline', (event) => {
      const raw = JSON.parse(event.data) as AuditEntry
      const enriched = enrichAuditEvent(raw)

      setEvents((prev) => {
        // 去重 — SSE 重連可能重送
        if (prev.some((e) => e.id === enriched.id)) return prev
        // 插入到正確位置（newest first）
        const next = [enriched, ...prev]
        // 上限 500 筆
        if (next.length > 500) next.length = 500
        return next
      })

      setConnected(true)
      setError(false)
    })

    source.onerror = () => {
      setError(true)
      setConnected(false)
    }

    // EventSource 自動重連後觸發 open
    source.onopen = () => {
      setConnected(true)
      setError(false)
    }

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [villageId])

  const filteredEvents = useFilteredEvents(events, filters)

  return { events, connected, error, filters, setFilters, filteredEvents }
}

function useFilteredEvents(
  events: TimelineEvent[],
  filters: Set<TimelineCategory>,
): TimelineEvent[] {
  return useMemo(() => {
    if (filters.size === 0) return events
    return events.filter((e) => filters.has(e.category))
  }, [events, filters])
}
