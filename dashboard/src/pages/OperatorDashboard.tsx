import { usePulseSSE } from '../hooks/usePulseSSE'
import { AlertsBanner } from '../components/operator/AlertsBanner'
import { WorldPulseOperator } from '../components/operator/WorldPulseOperator'
import { QuickStats } from '../components/operator/QuickStats'
import { ChiefStatusPanel } from '../components/operator/ChiefStatusPanel'
import { ActivityStream } from '../components/operator/ActivityStream'
import { InterventionPanel } from '../components/operator/InterventionPanel'
import styles from './OperatorDashboard.module.css'

interface OperatorDashboardProps {
  villageId: string
}

export function OperatorDashboard({ villageId }: OperatorDashboardProps) {
  const { health, connected } = usePulseSSE(villageId)

  return (
    <div className={styles.container}>
      <AlertsBanner health={health} />
      <QuickStats villageId={villageId} health={health} />
      <div className={styles.topRow}>
        <WorldPulseOperator health={health} connected={connected} />
        <ChiefStatusPanel villageId={villageId} />
      </div>
      <div className={styles.bottomRow}>
        <ActivityStream villageId={villageId} />
        <InterventionPanel villageId={villageId} />
      </div>
    </div>
  )
}
