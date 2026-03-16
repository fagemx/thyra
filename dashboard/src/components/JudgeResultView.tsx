/**
 * JudgeResultView — displays the 5-layer judge pipeline result.
 *
 * Shows pipeline status bar, verdict badge, reasons, warnings, and Apply button.
 */

import type { JudgeResult } from '../api/types'
import styles from './JudgeResultView.module.css'

interface JudgeResultViewProps {
  result: JudgeResult
  onApply: () => void
  applying: boolean
}

interface PipelineStep {
  label: string
  passed: boolean
}

export function JudgeResultView({ result, onApply, applying }: JudgeResultViewProps) {
  const steps: PipelineStep[] = [
    { label: 'Safety', passed: result.safety_check },
    { label: 'Legality', passed: result.legality_check },
    { label: 'Boundary', passed: result.boundary_check },
    { label: 'Evaluator', passed: result.evaluator_check },
    { label: 'Consistency', passed: result.consistency_check },
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
    <div className={styles.container}>
      <h3 className={styles.heading}>Judge Result</h3>

      {/* Pipeline bar */}
      <div className={styles.pipeline}>
        {steps.map((step) => (
          <div
            key={step.label}
            className={`${styles.step} ${step.passed ? styles.stepPass : styles.stepFail}`}
            title={`${step.label}: ${step.passed ? 'Passed' : 'Failed'}`}
          >
            {step.label}
          </div>
        ))}
      </div>

      {/* Verdict badge */}
      <div className={`${styles.verdict} ${verdictClass}`}>
        {verdict}
      </div>

      {/* Reasons */}
      {result.reasons.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Reasons</h4>
          <ul className={styles.reasonList}>
            {result.reasons.map((reason, i) => (
              <li key={i} className={styles.reasonItem}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Warnings</h4>
          <ul className={styles.warningList}>
            {result.warnings.map((warning, i) => (
              <li key={i} className={styles.warningItem}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Apply button — only when allowed */}
      {result.allowed && (
        <button
          className={styles.applyButton}
          onClick={onApply}
          disabled={applying}
        >
          {applying ? 'Applying...' : 'Apply Change'}
        </button>
      )}
    </div>
  )
}
