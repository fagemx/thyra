import { useEffect, useRef } from 'react'
import { useWorldPulse } from '../hooks/useWorldPulse'
import styles from './WorldPulse.module.css'

interface WorldPulseProps {
  villageId: string
}

/** 分數 -> 顏色 class */
function healthColorClass(score: number): string {
  if (score >= 80) return styles.healthy
  if (score >= 50) return styles.warning
  return styles.danger
}

/** 子分數標籤 */
const SCORE_LABELS: { key: keyof typeof SCORE_LABELS extends never ? never : string; label: string }[] = [
  { key: 'chief', label: 'Chief' },
  { key: 'constitution', label: 'Constitution' },
  { key: 'law', label: 'Law' },
  { key: 'skill', label: 'Skill' },
  { key: 'budget', label: 'Budget' },
  { key: 'freshness', label: 'Freshness' },
]

export function WorldPulse({ villageId }: WorldPulseProps) {
  const { health, connected, error, tick, bumped } = useWorldPulse(villageId)
  const numberRef = useRef<HTMLDivElement>(null)

  // Trigger animation on each SSE tick
  useEffect(() => {
    const el = numberRef.current
    if (!el || tick === 0) return

    // Remove existing animation classes
    el.classList.remove(styles.pulse, styles.bump)

    // Force reflow to restart animation
    void el.offsetWidth

    // Add appropriate animation class
    el.classList.add(bumped ? styles.bump : styles.pulse)
  }, [tick, bumped])

  if (error && !health) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>World Pulse</h2>
        </div>
        <div className={styles.errorText}>{error}</div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>World Pulse</h2>
        <div className={`${styles.dot} ${connected ? styles.dotLive : styles.dotOff}`} />
      </div>

      {health ? (
        <>
          <div className={styles.numberWrap}>
            <div
              ref={numberRef}
              className={`${styles.number} ${healthColorClass(health.overall)}`}
            >
              {health.overall}
            </div>
            <div className={styles.numberLabel}>World Health</div>
          </div>

          <div className={styles.bars}>
            {SCORE_LABELS.map(({ key, label }) => {
              const value = health.scores[key as keyof typeof health.scores]
              return (
                <div key={key} className={styles.barRow}>
                  <span className={styles.barLabel}>{label}</span>
                  <div className={styles.barTrack}>
                    <div
                      className={`${styles.barFill} ${healthColorClass(value)}`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  <span className={`${styles.barValue} ${healthColorClass(value)}`}>
                    {value}
                  </span>
                </div>
              )
            })}
          </div>

          <div className={styles.meta}>
            <span>Chiefs: {health.chief_count}</span>
            <span>Laws: {health.law_count}</span>
            <span>Skills: {health.skill_count}</span>
            <span>Cycles: {health.cycle_count}</span>
          </div>
        </>
      ) : (
        <div className={styles.loading}>Connecting...</div>
      )}
    </div>
  )
}
