import { useEffect, useRef, useState } from 'react'
import type { WorldHealth } from '../api/types'

interface UseWorldPulseResult {
  health: WorldHealth | null
  connected: boolean
  error: string | null
  /** Increments on each SSE event — drive animation */
  tick: number
  /** True when `overall` value changed from previous tick */
  bumped: boolean
}

/**
 * SSE hook: connects to /api/villages/:id/world/pulse and streams WorldHealth.
 */
export function useWorldPulse(
  villageId: string,
  interval = 5000,
): UseWorldPulseResult {
  const [health, setHealth] = useState<WorldHealth | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [bumped, setBumped] = useState(false)
  const prevOverall = useRef<number | null>(null)

  useEffect(() => {
    const url = `/api/villages/${villageId}/world/pulse?interval=${interval}`
    const es = new EventSource(url)

    es.addEventListener('pulse', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as WorldHealth
        setHealth(data)
        setConnected(true)
        setError(null)
        setTick((t) => t + 1)

        // Detect value change for bump animation
        if (prevOverall.current !== null && prevOverall.current !== data.overall) {
          setBumped(true)
        } else {
          setBumped(false)
        }
        prevOverall.current = data.overall
      } catch {
        // malformed SSE data — ignore
      }
    })

    es.onopen = () => {
      setConnected(true)
      setError(null)
    }

    es.onerror = () => {
      setConnected(false)
      setError('SSE connection lost')
    }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [villageId, interval])

  return { health, connected, error, tick, bumped }
}
