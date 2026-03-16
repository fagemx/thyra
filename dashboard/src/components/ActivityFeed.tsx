import styles from './ActivityFeed.module.css'

interface ActivityFeedProps {
  villageId: string
}

export function ActivityFeed({ villageId: _villageId }: ActivityFeedProps) {
  // E1 skeleton — real data integration in E2
  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Activity Feed</h2>
      <p className={styles.placeholder}>
        Recent changes and audit events will appear here.
      </p>
    </div>
  )
}
