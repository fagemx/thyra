import { useCallback, useEffect, useState } from 'react'
import { getVillageAudit, ApiError } from '../api/client'
import type { AuditEntry } from '../api/types'

const POLL_INTERVAL = 15_000

interface UseActivityFeedResult {
  events: AuditEntry[]
  loading: boolean
  error: string | null
}

/**
 * Polls the audit API every 15 seconds to get the latest events.
 */
export function useActivityFeed(villageId: string): UseActivityFeedResult {
  const [events, setEvents] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEvents = useCallback(async (id: string, isInitial: boolean) => {
    if (isInitial) setLoading(true)
    try {
      const data = await getVillageAudit(id, 10)
      setEvents(data)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Failed to load events')
    } finally {
      if (isInitial) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async (isInitial: boolean) => {
      if (cancelled) return
      await fetchEvents(villageId, isInitial)
    }

    void load(true)

    const timer = setInterval(() => {
      void load(false)
    }, POLL_INTERVAL)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [villageId, fetchEvents])

  return { events, loading, error }
}
