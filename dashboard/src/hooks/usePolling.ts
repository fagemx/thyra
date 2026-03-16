import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Generic polling hook. Calls `fetcher` immediately on mount and
 * then every `intervalMs` milliseconds. Cleans up on unmount.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled = true,
): {
  data: T | null
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const doFetch = useCallback(async () => {
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    setLoading(true)
    void doFetch()

    const timer = setInterval(() => void doFetch(), intervalMs)
    return () => clearInterval(timer)
  }, [doFetch, intervalMs, enabled])

  return { data, loading, error, refresh: doFetch }
}
