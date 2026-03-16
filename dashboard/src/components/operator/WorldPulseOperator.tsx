import type { WorldHealth, WorldHealthScores } from '../../api/types'
import styles from './WorldPulseOperator.module.css'

interface WorldPulseOperatorProps {
  health: WorldHealth | null
  connected: boolean
}

function scoreColor(score: number): string {
  if (score >= 60) return styles.scoreGreen
  if (score >= 30) return styles.scoreYellow
  return styles.scoreRed
}

function barColor(score: number): string {
  if (score >= 60) return '#2ecc71'
  if (score >= 30) return '#ffc107'
  return '#e94560'
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

const SCORE_LABELS: Array<{ key: keyof WorldHealthScores; label: string }> = [
  { key: 'chief', label: 'Chief' },
  { key: 'constitution', label: 'Const.' },
  { key: 'law', label: 'Law' },
  { key: 'skill', label: 'Skill' },
  { key: 'budget', label: 'Budget' },
  { key: 'freshness', label: 'Fresh' },
]

export function WorldPulseOperator({ health, connected }: WorldPulseOperatorProps) {
  if (!health) {
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>World Pulse</h2>
        <p className={styles.empty}>Waiting for health data...</p>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>World Pulse</h2>
        <span className={`${styles.sseStatus} ${connected ? styles.sseConnected : styles.sseDisconnected}`}>
          {connected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      <div className={styles.overallScore}>
        <div className={`${styles.scoreNumber} ${scoreColor(health.overall)}`}>
          {Math.round(health.overall)}
        </div>
        <div className={styles.scoreLabel}>Overall Health</div>
      </div>

      <div className={styles.bars}>
        {SCORE_LABELS.map(({ key, label }) => {
          const value = health.scores[key]
          return (
            <div key={key} className={styles.barRow}>
              <span className={styles.barLabel}>{label}</span>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${value}%`, background: barColor(value) }}
                />
              </div>
              <span className={styles.barValue}>{Math.round(value)}</span>
            </div>
          )
        })}
      </div>

      <div className={styles.meta}>
        <span className={styles.metaItem}>
          Last change: <span className={styles.metaValue}>{formatAge(health.last_change_age_ms)}</span>
        </span>
        <span className={styles.metaItem}>
          Cycles: <span className={styles.metaValue}>{health.cycle_count}</span>
        </span>
        <span className={styles.metaItem}>
          Constitution: <span className={styles.metaValue}>{health.constitution_active ? 'Active' : 'None'}</span>
        </span>
      </div>
    </div>
  )
}
