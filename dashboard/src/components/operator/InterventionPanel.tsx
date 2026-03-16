import { useCallback, useState } from 'react'
import {
  approveLaw,
  getSchedulerStatus,
  listChiefs,
  listPendingChanges,
  listSnapshots,
  pauseChief,
  rejectLaw,
  resumeChief,
  rollbackToSnapshot,
  startScheduler,
  stopScheduler,
} from '../../api/client'
import type { ChangeProposal, Chief, SchedulerStatus, SnapshotMeta } from '../../api/types'
import { usePolling } from '../../hooks/usePolling'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './InterventionPanel.module.css'

interface InterventionPanelProps {
  villageId: string
}

type DialogAction =
  | { kind: 'pause'; chiefId: string; chiefName: string }
  | { kind: 'resume'; chiefId: string; chiefName: string }
  | { kind: 'rollback'; snapshotId: string }
  | { kind: 'approve'; lawId: string }
  | { kind: 'reject'; lawId: string }
  | { kind: 'scheduler-stop' }
  | { kind: 'scheduler-start' }

interface PanelData {
  chiefs: Chief[]
  snapshots: SnapshotMeta[]
  proposals: ChangeProposal[]
  scheduler: SchedulerStatus | null
}

function formatTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

export function InterventionPanel({ villageId }: InterventionPanelProps) {
  const [activeDialog, setActiveDialog] = useState<DialogAction | null>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const fetcher = useCallback(async (): Promise<PanelData> => {
    const [chiefs, snapshots, proposals] = await Promise.all([
      listChiefs(villageId),
      listSnapshots(villageId, 5),
      listPendingChanges(villageId),
    ])

    let scheduler: SchedulerStatus | null = null
    try {
      scheduler = await getSchedulerStatus()
    } catch {
      // Scheduler not initialized — ok
    }

    return { chiefs, snapshots, proposals, scheduler }
  }, [villageId])

  const { data, refresh } = usePolling(fetcher, 30_000)

  const handleConfirm = async (reason: string) => {
    if (!activeDialog) return
    setDialogLoading(true)
    setDialogError(null)

    try {
      switch (activeDialog.kind) {
        case 'pause':
          await pauseChief(activeDialog.chiefId, reason)
          break
        case 'resume':
          await resumeChief(activeDialog.chiefId)
          break
        case 'rollback':
          await rollbackToSnapshot(villageId, activeDialog.snapshotId, reason)
          break
        case 'approve':
          await approveLaw(activeDialog.lawId)
          break
        case 'reject':
          await rejectLaw(activeDialog.lawId)
          break
        case 'scheduler-stop':
          await stopScheduler()
          break
        case 'scheduler-start':
          await startScheduler()
          break
      }
      setActiveDialog(null)
      void refresh()
    } catch (err: unknown) {
      setDialogError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setDialogLoading(false)
    }
  }

  const dialogConfig = activeDialog
    ? getDialogConfig(activeDialog)
    : null

  const chiefs = data?.chiefs ?? []
  const snapshots = data?.snapshots ?? []
  const proposals = data?.proposals ?? []
  const scheduler = data?.scheduler ?? null

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Intervention</h2>

      {/* Chief Control */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Chief Control</h3>
        {chiefs.length === 0 ? (
          <p className={styles.empty}>No chiefs</p>
        ) : (
          chiefs.map((chief) => (
            <div key={chief.id} className={styles.chiefRow}>
              <span className={styles.chiefName}>
                {chief.name}
                <span className={`${styles.chiefStatus} ${chief.status === 'active' ? styles.statusActive : styles.statusPaused}`}>
                  {chief.status}
                </span>
              </span>
              {chief.status === 'active' && (
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnWarning}`}
                  onClick={() => setActiveDialog({ kind: 'pause', chiefId: chief.id, chiefName: chief.name })}
                >
                  Pause
                </button>
              )}
              {chief.status === 'paused' && (
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnSuccess}`}
                  onClick={() => setActiveDialog({ kind: 'resume', chiefId: chief.id, chiefName: chief.name })}
                >
                  Resume
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Rollback */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Rollback to Snapshot</h3>
        {snapshots.length === 0 ? (
          <p className={styles.empty}>No snapshots available</p>
        ) : (
          snapshots.map((snap) => (
            <div key={snap.id} className={styles.snapshotRow}>
              <span className={styles.snapshotInfo}>
                {snap.trigger}
                <span className={styles.snapshotTime}>{formatTime(snap.created_at)}</span>
              </span>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                onClick={() => setActiveDialog({ kind: 'rollback', snapshotId: snap.id })}
              >
                Rollback
              </button>
            </div>
          ))
        )}
      </div>

      {/* Pending Proposals */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Pending Proposals</h3>
        {proposals.length === 0 ? (
          <p className={styles.empty}>No pending proposals</p>
        ) : (
          proposals.map((p) => (
            <div key={p.id} className={styles.proposalRow}>
              <span className={styles.proposalType}>{p.type}</span>
              <div className={styles.proposalActions}>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnSuccess}`}
                  onClick={() => setActiveDialog({ kind: 'approve', lawId: p.id })}
                >
                  Approve
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                  onClick={() => setActiveDialog({ kind: 'reject', lawId: p.id })}
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Scheduler */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Scheduler</h3>
        <div className={styles.schedulerRow}>
          <span className={styles.schedulerStatus}>
            <span className={`${styles.dot} ${scheduler === null ? styles.dotUnknown : scheduler.running ? styles.dotRunning : styles.dotStopped}`} />
            {scheduler === null ? 'Not initialized' : scheduler.running ? 'Running' : 'Stopped'}
          </span>
          {scheduler !== null && (
            scheduler.running ? (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                onClick={() => setActiveDialog({ kind: 'scheduler-stop' })}
              >
                Emergency Stop
              </button>
            ) : (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnSuccess}`}
                onClick={() => setActiveDialog({ kind: 'scheduler-start' })}
              >
                Start
              </button>
            )
          )}
        </div>
      </div>

      {/* Confirm Dialog */}
      {dialogConfig && (
        <ConfirmDialog
          open={activeDialog !== null}
          title={dialogConfig.title}
          message={dialogConfig.message}
          dangerLevel={dialogConfig.dangerLevel}
          requireReason={dialogConfig.requireReason}
          loading={dialogLoading}
          error={dialogError}
          onConfirm={(reason) => void handleConfirm(reason)}
          onCancel={() => { setActiveDialog(null); setDialogError(null) }}
        />
      )}
    </div>
  )
}

function getDialogConfig(action: DialogAction): {
  title: string
  message: string
  dangerLevel: 'warning' | 'danger'
  requireReason: boolean
} {
  switch (action.kind) {
    case 'pause':
      return {
        title: `Pause Chief: ${action.chiefName}`,
        message: 'This will immediately pause the chief. All ongoing governance cycles will complete but no new ones will start.',
        dangerLevel: 'warning',
        requireReason: true,
      }
    case 'resume':
      return {
        title: `Resume Chief: ${action.chiefName}`,
        message: 'This will reactivate the chief and allow governance cycles to resume.',
        dangerLevel: 'warning',
        requireReason: false,
      }
    case 'rollback':
      return {
        title: 'Rollback World State',
        message: 'This will revert the entire village world state to the selected snapshot. This action cannot be undone.',
        dangerLevel: 'danger',
        requireReason: true,
      }
    case 'approve':
      return {
        title: 'Approve Proposal',
        message: 'This will approve the pending law proposal and enact it immediately.',
        dangerLevel: 'warning',
        requireReason: false,
      }
    case 'reject':
      return {
        title: 'Reject Proposal',
        message: 'This will reject the pending law proposal.',
        dangerLevel: 'danger',
        requireReason: true,
      }
    case 'scheduler-stop':
      return {
        title: 'Emergency Stop Scheduler',
        message: 'This will immediately stop the governance scheduler. No new cycles will be triggered until manually restarted.',
        dangerLevel: 'danger',
        requireReason: false,
      }
    case 'scheduler-start':
      return {
        title: 'Start Scheduler',
        message: 'This will start the governance scheduler and resume automatic cycles.',
        dangerLevel: 'warning',
        requireReason: false,
      }
  }
}
