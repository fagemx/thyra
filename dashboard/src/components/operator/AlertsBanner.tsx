import { useState } from 'react'
import type { WorldHealth } from '../../api/types'
import styles from './AlertsBanner.module.css'

interface AlertsBannerProps {
  health: WorldHealth | null
}

type AlertLevel = 'red' | 'yellow' | 'green'

interface Alert {
  level: AlertLevel
  messages: string[]
}

function deriveAlerts(health: WorldHealth): Alert {
  const red: string[] = []
  const yellow: string[] = []

  if (health.overall < 30) red.push(`Overall health critical: ${health.overall}/100`)
  if (!health.constitution_active) red.push('No active constitution')
  if (health.chief_count === 0) red.push('No chiefs configured')

  if (health.overall < 60 && health.overall >= 30) yellow.push(`Overall health low: ${health.overall}/100`)
  if (health.budget_utilization > 0.85) yellow.push(`Budget utilization high: ${Math.round(health.budget_utilization * 100)}%`)
  if (health.scores.freshness < 30) yellow.push(`World state stale (freshness: ${health.scores.freshness}/100)`)

  if (red.length > 0) return { level: 'red', messages: red }
  if (yellow.length > 0) return { level: 'yellow', messages: yellow }
  return { level: 'green', messages: ['All systems nominal'] }
}

const LEVEL_ICONS: Record<AlertLevel, string> = {
  red: '[!]',
  yellow: '[~]',
  green: '[ok]',
}

export function AlertsBanner({ health }: AlertsBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (!health) return null

  const alert = deriveAlerts(health)

  // Don't show green banner or dismissed alerts
  if (alert.level === 'green' || dismissed) return null

  return (
    <div className={`${styles.banner} ${styles[alert.level]}`}>
      <span className={styles.icon}>{LEVEL_ICONS[alert.level]}</span>
      <div className={styles.messages}>
        {alert.messages.map((msg, i) => (
          <span key={i}>{msg}</span>
        ))}
      </div>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        title="Dismiss"
      >
        x
      </button>
    </div>
  )
}
