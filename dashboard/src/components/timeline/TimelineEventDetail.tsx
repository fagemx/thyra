/**
 * TimelineEventDetail — 展開後的事件詳情。
 * 根據 payload 內容條件式顯示：
 *   - Judge result (5-layer pipeline)
 *   - Diff summary
 *   - Key-value pairs
 *   - Raw payload (fallback)
 */

import type { TimelineEvent, JudgeResult, WorldStateDiff } from '../../api/types'
import styles from './TimelineEventDetail.module.css'

interface TimelineEventDetailProps {
  event: TimelineEvent
}

export function TimelineEventDetail({ event }: TimelineEventDetailProps) {
  const payload = event.payload

  const judgeResult = extractJudgeResult(payload)
  const diff = extractDiff(payload)

  // 已知的 key-value 欄位
  const knownKeys = ['judge_result', 'diff', 'snapshot_before', 'state_after']
  const kvPairs = Object.entries(payload).filter(([k]) => !knownKeys.includes(k))

  return (
    <div className={styles.container}>
      {/* Judge result */}
      {judgeResult && (
        <div className={styles.section}>
          <h5 className={styles.sectionTitle}>Judge</h5>
          <JudgeMini result={judgeResult} />
        </div>
      )}

      {/* Diff summary */}
      {diff && (
        <div className={styles.section}>
          <h5 className={styles.sectionTitle}>Diff</h5>
          <DiffMini diff={diff} />
        </div>
      )}

      {/* Key-value pairs */}
      {kvPairs.length > 0 && (
        <div className={styles.section}>
          <h5 className={styles.sectionTitle}>Details</h5>
          {kvPairs.map(([key, value]) => (
            <div key={key} className={styles.kvRow}>
              <span className={styles.kvKey}>{key}:</span>
              <span className={styles.kvValue}>{formatValue(value)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Raw payload fallback */}
      {kvPairs.length === 0 && !judgeResult && !diff && (
        <div className={styles.section}>
          <pre className={styles.payload}>
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// --- Mini Judge Component ---

function JudgeMini({ result }: { result: JudgeResult }) {
  const steps = [
    { label: 'Safety', passed: result.safety_check },
    { label: 'Legal', passed: result.legality_check },
    { label: 'Boundary', passed: result.boundary_check },
    { label: 'Eval', passed: result.evaluator_check },
    { label: 'Consist', passed: result.consistency_check },
  ]

  const verdict = result.requires_approval
    ? 'NEEDS APPROVAL'
    : result.allowed
      ? 'ALLOWED'
      : 'REJECTED'

  const verdictClass = result.requires_approval
    ? styles.verdictApproval
    : result.allowed
      ? styles.verdictAllowed
      : styles.verdictRejected

  return (
    <div className={styles.judgeContainer}>
      <div className={styles.pipeline}>
        {steps.map((s) => (
          <div
            key={s.label}
            className={`${styles.step} ${s.passed ? styles.stepPass : styles.stepFail}`}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div className={`${styles.verdict} ${verdictClass}`}>{verdict}</div>
      {result.reasons.length > 0 && (
        <ul className={styles.reasons}>
          {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  )
}

// --- Mini Diff Component ---

function DiffMini({ diff }: { diff: WorldStateDiff }) {
  if (!diff.has_changes) return <span style={{ color: '#666' }}>No changes</span>

  const parts: string[] = []
  if (diff.village) parts.push(`village: ${diff.village.fields_changed.join(', ')}`)
  if (diff.constitution) parts.push(`constitution: ${diff.constitution.action}`)
  if (diff.chiefs.added.length > 0) parts.push(`+${diff.chiefs.added.length} chiefs`)
  if (diff.chiefs.removed.length > 0) parts.push(`-${diff.chiefs.removed.length} chiefs`)
  if (diff.chiefs.changed.length > 0) parts.push(`~${diff.chiefs.changed.length} chiefs`)
  if (diff.laws.added.length > 0) parts.push(`+${diff.laws.added.length} laws`)
  if (diff.laws.removed.length > 0) parts.push(`-${diff.laws.removed.length} laws`)
  if (diff.skills.added.length > 0) parts.push(`+${diff.skills.added.length} skills`)
  if (diff.skills.removed.length > 0) parts.push(`-${diff.skills.removed.length} skills`)

  return <span style={{ color: '#c0c0c0', fontSize: '0.75rem' }}>{parts.join(' | ')}</span>
}

// --- Helpers ---

function extractJudgeResult(payload: Record<string, unknown>): JudgeResult | null {
  const jr = payload.judge_result
  if (
    typeof jr === 'object' &&
    jr !== null &&
    'allowed' in jr &&
    'safety_check' in jr
  ) {
    return jr as JudgeResult
  }
  return null
}

function extractDiff(payload: Record<string, unknown>): WorldStateDiff | null {
  const d = payload.diff
  if (
    typeof d === 'object' &&
    d !== null &&
    'has_changes' in d
  ) {
    return d as WorldStateDiff
  }
  return null
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
