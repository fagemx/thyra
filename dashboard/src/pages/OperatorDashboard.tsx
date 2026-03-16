import { usePulseSSE } from '../hooks/usePulseSSE'
import { useTimelineSSE } from '../hooks/useTimelineSSE'
import { AlertsBanner } from '../components/operator/AlertsBanner'
import { WorldPulseOperator } from '../components/operator/WorldPulseOperator'
import { QuickStats } from '../components/operator/QuickStats'
import { ChiefStatusPanel } from '../components/operator/ChiefStatusPanel'
import { ActivityStream } from '../components/operator/ActivityStream'
import { InterventionPanel } from '../components/operator/InterventionPanel'
import { TimelineList } from '../components/timeline/TimelineList'
import styles from './OperatorDashboard.module.css'

interface OperatorDashboardProps {
  villageId: string
}

export function OperatorDashboard({ villageId }: OperatorDashboardProps) {
  const { health, connected: pulseConnected } = usePulseSSE(villageId)
  const timeline = useTimelineSSE(villageId)

  return (
    <div className={styles.container}>
      <AlertsBanner health={health} />
      <QuickStats villageId={villageId} health={health} />
      <div className={styles.topRow}>
        <WorldPulseOperator health={health} connected={pulseConnected} />
        <ChiefStatusPanel villageId={villageId} />
      </div>
      <div className={styles.bottomRow}>
        <TimelineList
          events={timeline.filteredEvents}
          connected={timeline.connected}
          error={timeline.error}
          compact={true}
        />
        <ActivityStream villageId={villageId} />
        <InterventionPanel villageId={villageId} />
      </div>
    </div>
  )
}
