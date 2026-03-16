import { useCallback, useState } from 'react'
import { listChiefs, listTelemetry, resumeChief } from '../../api/client'
import type { Chief, TelemetryEntry } from '../../api/types'
import { usePolling } from '../../hooks/usePolling'
import styles from './ChiefStatusPanel.module.css'

interface ChiefStatusPanelProps {
  villageId: string
}

function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

function badgeClass(status: string): string {
  switch (status) {
    case 'active': return styles.badgeActive
    case 'paused': return styles.badgePaused
    default: return styles.badgeError
  }
}

interface ChiefWithTelemetry {
  chief: Chief
  lastAction: TelemetryEntry | null
}

export function ChiefStatusPanel({ villageId }: ChiefStatusPanelProps) {
  const [resuming, setResuming] = useState<string | null>(null)

  const fetcher = useCallback(async (): Promise<ChiefWithTelemetry[]> => {
    const [chiefs, telemetry] = await Promise.all([
      listChiefs(villageId),
      listTelemetry(villageId, 50),
    ])

    // Group latest telemetry by chief_id
    const latestByChief = new Map<string, TelemetryEntry>()
    for (const entry of telemetry) {
      if (!latestByChief.has(entry.chief_id)) {
        latestByChief.set(entry.chief_id, entry)
      }
    }

    return chiefs.map((chief) => ({
      chief,
      lastAction: latestByChief.get(chief.id) ?? null,
    }))
  }, [villageId])

  const { data, loading, error, refresh } = usePolling(fetcher, 30_000)

  const handleResume = async (chiefId: string) => {
    setResuming(chiefId)
    try {
      await resumeChief(chiefId)
      void refresh()
    } catch {
      // Error will show on next poll
    } finally {
      setResuming(null)
    }
  }

  if (loading && !data) {
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>Chief Status</h2>
        <p className={styles.empty}>Loading chiefs...</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>Chief Status</h2>
        <p className={styles.error}>{error}</p>
      </div>
    )
  }

  const items = data ?? []

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Chief Status</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No chiefs configured</p>
      ) : (
        <div className={styles.list}>
          {items.map(({ chief, lastAction }) => (
            <div key={chief.id} className={styles.chiefCard}>
              <div className={styles.chiefInfo}>
                <div className={styles.chiefName}>{chief.name}</div>
                <div className={styles.chiefRole}>{chief.role}</div>
                {lastAction && (
                  <div className={styles.chiefMeta}>
                    <span>{lastAction.operation}</span>
                    <span>{lastAction.duration_ms}ms</span>
                    <span>{formatRelativeTime(lastAction.created_at)}</span>
                    {lastAction.status === 'error' && (
                      <span style={{ color: '#e94560' }}>ERROR</span>
                    )}
                  </div>
                )}
              </div>
              <span className={`${styles.badge} ${badgeClass(chief.status)}`}>
                {chief.status}
              </span>
              {chief.status === 'paused' && (
                <button
                  className={styles.resumeBtn}
                  onClick={() => void handleResume(chief.id)}
                  disabled={resuming === chief.id}
                >
                  {resuming === chief.id ? '...' : 'Resume'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
