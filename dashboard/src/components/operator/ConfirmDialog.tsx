import { useState } from 'react'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  dangerLevel: 'warning' | 'danger'
  requireReason: boolean
  loading: boolean
  error: string | null
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  dangerLevel,
  requireReason,
  loading,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('')

  if (!open) return null

  const canSubmit = !loading && (!requireReason || reason.trim().length > 0)

  const handleConfirm = () => {
    if (canSubmit) {
      onConfirm(reason.trim())
      setReason('')
    }
  }

  const handleCancel = () => {
    setReason('')
    onCancel()
  }

  const confirmClass = dangerLevel === 'danger'
    ? `${styles.confirmBtn} ${styles.confirmBtnDanger}`
    : `${styles.confirmBtn} ${styles.confirmBtnWarning}`

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>

        {requireReason && (
          <textarea
            className={styles.reasonInput}
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={loading}
          />
        )}

        {error && <div className={styles.errorText}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={handleCancel} disabled={loading}>
            Cancel
          </button>
          <button className={confirmClass} onClick={handleConfirm} disabled={!canSubmit}>
            {loading ? 'Processing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
