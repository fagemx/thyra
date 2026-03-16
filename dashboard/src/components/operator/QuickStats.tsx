import { useCallback } from 'react'
import { listAudit } from '../../api/client'
import type { WorldHealth } from '../../api/types'
import { usePolling } from '../../hooks/usePolling'
import styles from './QuickStats.module.css'

interface QuickStatsProps {
  villageId: string
  health: WorldHealth | null
}

function budgetProgressClass(utilization: number): string {
  if (utilization > 0.85) return styles.progressRed
  if (utilization > 0.6) return styles.progressYellow
  return styles.progressGreen
}

export function QuickStats({ villageId, health }: QuickStatsProps) {
  // Count rollbacks from audit log
  const rollbackFetcher = useCallback(async (): Promise<number> => {
    try {
      const audit = await listAudit(villageId, 100)
      return audit.filter((e) => e.action === 'rollback').length
    } catch {
      return 0
    }
  }, [villageId])

  const { data: rollbackCount } = usePolling(rollbackFetcher, 30_000)

  const budgetPct = health ? Math.round(health.budget_utilization * 100) : 0
  const chiefCount = health?.chief_count ?? 0
  const cycleCount = health?.cycle_count ?? 0

  return (
    <div className={styles.bar}>
      <div className={styles.stat}>
        <div className={styles.label}>Budget Used</div>
        <div className={styles.value}>{budgetPct}%</div>
        <div className={styles.progressTrack}>
          <div
            className={`${styles.progressFill} ${budgetProgressClass(health?.budget_utilization ?? 0)}`}
            style={{ width: `${Math.min(budgetPct, 100)}%` }}
          />
        </div>
      </div>

      <div className={styles.stat}>
        <div className={styles.label}>Cycles</div>
        <div className={styles.value}>{cycleCount}</div>
        <div className={styles.sub}>governance cycles</div>
      </div>

      <div className={styles.stat}>
        <div className={styles.label}>Chiefs</div>
        <div className={styles.value}>{chiefCount}</div>
        <div className={styles.sub}>active</div>
      </div>

      <div className={styles.stat}>
        <div className={styles.label}>Rollbacks</div>
        <div className={styles.value}>{rollbackCount ?? 0}</div>
        <div className={styles.sub}>total</div>
      </div>
    </div>
  )
}
