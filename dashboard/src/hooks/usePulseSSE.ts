import { useEffect, useRef, useState } from 'react'
import { subscribePulse } from '../api/client'
import type { WorldHealth } from '../api/types'

/**
 * Shared SSE hook for WorldHealth pulse stream.
 * Connects to GET /api/villages/:id/world/pulse?interval=5000
 * and provides latest health data to any subscriber.
 */
export function usePulseSSE(villageId: string | null): {
  health: WorldHealth | null
  connected: boolean
  error: boolean
} {
  const [health, setHealth] = useState<WorldHealth | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!villageId) {
      setHealth(null)
      setConnected(false)
      setError(false)
      return
    }

    setError(false)

    const unsub = subscribePulse(
      villageId,
      (data) => {
        setHealth(data)
        setConnected(true)
        setError(false)
      },
      () => {
        setError(true)
        setConnected(false)
      },
    )

    unsubRef.current = unsub

    return () => {
      unsub()
      unsubRef.current = null
    }
  }, [villageId])

  return { health, connected, error }
}
