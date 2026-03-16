import { useEffect, useState } from 'react'
import { getWorldState, ApiError } from '../api/client'
import type { WorldState } from '../api/types'
import styles from './WorldPulse.module.css'

interface WorldPulseProps {
  villageId: string
}

export function WorldPulse({ villageId }: WorldPulseProps) {
  const [state, setState] = useState<WorldState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWorldState(villageId)
      .then((data) => {
        if (!cancelled) {
          setState(data)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load world state')
          setState(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [villageId])

  if (loading) return <div className={styles.card}>Loading world state...</div>
  if (error) return <div className={`${styles.card} ${styles.error}`}>{error}</div>
  if (!state) return null

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>World Pulse</h2>
      <div className={styles.grid}>
        <div className={styles.stat}>
          <span className={styles.label}>Constitution</span>
          <span className={styles.value}>{state.constitution ? state.constitution.name : 'None'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>Chiefs</span>
          <span className={styles.value}>{state.chiefs.length}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>Active Laws</span>
          <span className={styles.value}>{state.active_laws.length}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>Skills</span>
          <span className={styles.value}>{state.skills.length}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>Running Cycles</span>
          <span className={styles.value}>{state.running_cycles.length}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>Assembled</span>
          <span className={styles.value}>{new Date(state.assembled_at).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  )
}
