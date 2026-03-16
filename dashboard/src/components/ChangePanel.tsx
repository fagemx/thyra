/**
 * ChangePanel — select change type, edit JSON params, judge, apply, view diff.
 *
 * State machine: idle -> judging -> judged -> applying -> applied
 * Uses useReducer for clean state transitions.
 */

import { useReducer } from 'react'
import type { WorldChange, WorldChangeType, JudgeResult, ApplyResult } from '../api/types'
import { judgeChange, applyChange } from '../api/client'
import { CHANGE_TEMPLATES, CHANGE_GROUPS } from './change-templates'
import { JudgeResultView } from './JudgeResultView'
import { DiffView } from './DiffView'
import styles from './ChangePanel.module.css'

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'judging' | 'judged' | 'applying' | 'applied' | 'error'

interface State {
  phase: Phase
  changeType: WorldChangeType
  paramsJson: string
  reason: string
  judgeResult: JudgeResult | null
  applyResult: ApplyResult | null
  error: string | null
}

type Action =
  | { type: 'SET_CHANGE_TYPE'; changeType: WorldChangeType }
  | { type: 'SET_PARAMS'; json: string }
  | { type: 'SET_REASON'; reason: string }
  | { type: 'JUDGE_START' }
  | { type: 'JUDGE_SUCCESS'; result: JudgeResult }
  | { type: 'APPLY_START' }
  | { type: 'APPLY_SUCCESS'; result: ApplyResult }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' }

const DEFAULT_TYPE: WorldChangeType = 'budget.adjust'

function initialState(): State {
  return {
    phase: 'idle',
    changeType: DEFAULT_TYPE,
    paramsJson: JSON.stringify(CHANGE_TEMPLATES[DEFAULT_TYPE].template, null, 2),
    reason: '',
    judgeResult: null,
    applyResult: null,
    error: null,
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CHANGE_TYPE': {
      const template = CHANGE_TEMPLATES[action.changeType]
      return {
        ...initialState(),
        changeType: action.changeType,
        paramsJson: JSON.stringify(template.template, null, 2),
      }
    }
    case 'SET_PARAMS':
      return { ...state, paramsJson: action.json, phase: 'idle', judgeResult: null, applyResult: null, error: null }
    case 'SET_REASON':
      return { ...state, reason: action.reason }
    case 'JUDGE_START':
      return { ...state, phase: 'judging', error: null }
    case 'JUDGE_SUCCESS':
      return { ...state, phase: 'judged', judgeResult: action.result }
    case 'APPLY_START':
      return { ...state, phase: 'applying' }
    case 'APPLY_SUCCESS':
      return { ...state, phase: 'applied', applyResult: action.result }
    case 'ERROR':
      return { ...state, phase: 'error', error: action.message }
    case 'RESET':
      return initialState()
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChangePanelProps {
  villageId: string
}

export function ChangePanel({ villageId }: ChangePanelProps) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)

  // --- handlers ---

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    dispatch({ type: 'SET_CHANGE_TYPE', changeType: e.target.value as WorldChangeType })
  }

  async function handleJudge() {
    let change: WorldChange
    try {
      change = JSON.parse(state.paramsJson) as WorldChange
    } catch {
      dispatch({ type: 'ERROR', message: 'Invalid JSON. Please fix syntax errors.' })
      return
    }

    dispatch({ type: 'JUDGE_START' })
    try {
      const result = await judgeChange(villageId, change)
      dispatch({ type: 'JUDGE_SUCCESS', result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Judge request failed'
      dispatch({ type: 'ERROR', message })
    }
  }

  async function handleApply() {
    let change: WorldChange
    try {
      change = JSON.parse(state.paramsJson) as WorldChange
    } catch {
      dispatch({ type: 'ERROR', message: 'Invalid JSON.' })
      return
    }

    dispatch({ type: 'APPLY_START' })
    try {
      const result = await applyChange(villageId, change, state.reason || undefined)
      dispatch({ type: 'APPLY_SUCCESS', result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Apply request failed'
      dispatch({ type: 'ERROR', message })
    }
  }

  // --- grouped options for select ---

  const groupedOptions = CHANGE_GROUPS.map((group) => {
    const entries = (Object.entries(CHANGE_TEMPLATES) as Array<[WorldChangeType, typeof CHANGE_TEMPLATES[WorldChangeType]]>)
      .filter(([, tmpl]) => tmpl.group === group)
    return { group, entries }
  }).filter((g) => g.entries.length > 0)

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Change Control</h2>

      {/* Type selector */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="change-type">Change Type</label>
        <select
          id="change-type"
          className={styles.select}
          value={state.changeType}
          onChange={handleTypeChange}
          disabled={state.phase === 'judging' || state.phase === 'applying'}
        >
          {groupedOptions.map(({ group, entries }) => (
            <optgroup key={group} label={group}>
              {entries.map(([type, tmpl]) => (
                <option key={type} value={type}>{tmpl.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* JSON editor */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="change-params">Parameters (JSON)</label>
        <textarea
          id="change-params"
          className={styles.textarea}
          value={state.paramsJson}
          onChange={(e) => dispatch({ type: 'SET_PARAMS', json: e.target.value })}
          disabled={state.phase === 'judging' || state.phase === 'applying'}
          rows={10}
          spellCheck={false}
        />
      </div>

      {/* Judge button */}
      <button
        className={styles.judgeButton}
        onClick={() => void handleJudge()}
        disabled={state.phase === 'judging' || state.phase === 'applying'}
      >
        {state.phase === 'judging' ? 'Judging...' : 'Judge'}
      </button>

      {/* Error */}
      {state.error && (
        <div className={styles.error}>{state.error}</div>
      )}

      {/* Judge result */}
      {state.judgeResult && (state.phase === 'judged' || state.phase === 'applying' || state.phase === 'applied') && (
        <>
          {/* Reason input (before apply) */}
          {state.phase === 'judged' && state.judgeResult.allowed && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="apply-reason">Reason (optional)</label>
              <input
                id="apply-reason"
                className={styles.input}
                type="text"
                value={state.reason}
                onChange={(e) => dispatch({ type: 'SET_REASON', reason: e.target.value })}
                placeholder="Why are you applying this change?"
              />
            </div>
          )}

          <JudgeResultView
            result={state.judgeResult}
            onApply={() => void handleApply()}
            applying={state.phase === 'applying'}
          />
        </>
      )}

      {/* Diff view after apply */}
      {state.applyResult && state.phase === 'applied' && (
        <>
          {state.applyResult.diff ? (
            <DiffView diff={state.applyResult.diff} />
          ) : (
            <p className={styles.noChanges}>Change applied but no diff returned.</p>
          )}
          <div className={styles.snapshotInfo}>
            Snapshot: <code>{state.applyResult.snapshot_before}</code>
          </div>
        </>
      )}

      {/* Reset button */}
      {(state.phase === 'applied' || state.phase === 'error') && (
        <button
          className={styles.resetButton}
          onClick={() => dispatch({ type: 'RESET' })}
        >
          Reset
        </button>
      )}
    </div>
  )
}
