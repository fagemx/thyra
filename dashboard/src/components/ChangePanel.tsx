import styles from './ChangePanel.module.css'

interface ChangePanelProps {
  villageId: string
}

export function ChangePanel({ villageId: _villageId }: ChangePanelProps) {
  // E1 skeleton — judge + apply form in E2
  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Change Panel</h2>
      <p className={styles.placeholder}>
        Judge and apply world changes from here.
      </p>
    </div>
  )
}
