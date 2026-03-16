/**
 * DiffView — structured display of WorldStateDiff.
 *
 * Shows collapsible sections for each domain (village, constitution, chiefs, etc.)
 * with color-coded added/removed/changed entries.
 */

import type {
  WorldStateDiff,
  ChiefChangedEntry,
  LawChangedEntry,
  SkillChangedEntry,
} from '../api/types'
import styles from './DiffView.module.css'

interface DiffViewProps {
  diff: WorldStateDiff
}

export function DiffView({ diff }: DiffViewProps) {
  if (!diff.has_changes) {
    return (
      <div className={styles.container}>
        <h3 className={styles.heading}>Diff</h3>
        <p className={styles.noChanges}>No changes detected.</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Diff</h3>

      {/* Village */}
      {diff.village && (
        <DiffSection title="Village">
          <p className={styles.changed}>
            Fields changed: {diff.village.fields_changed.join(', ')}
          </p>
        </DiffSection>
      )}

      {/* Constitution */}
      {diff.constitution && (
        <DiffSection title="Constitution">
          <span className={styles.badge} data-action={diff.constitution.action}>
            {diff.constitution.action}
          </span>
          {diff.constitution.fingerprint_before && (
            <p className={styles.fingerprint}>
              Before: <code>{diff.constitution.fingerprint_before.slice(0, 12)}...</code>
            </p>
          )}
          {diff.constitution.fingerprint_after && (
            <p className={styles.fingerprint}>
              After: <code>{diff.constitution.fingerprint_after.slice(0, 12)}...</code>
            </p>
          )}
        </DiffSection>
      )}

      {/* Chiefs */}
      {hasEntries(diff.chiefs) && (
        <DiffSection title="Chiefs">
          {diff.chiefs.added.map((c) => (
            <p key={c.id} className={styles.added}>+ {c.name} ({c.id})</p>
          ))}
          {diff.chiefs.removed.map((c) => (
            <p key={c.id} className={styles.removed}>- {c.name} ({c.id})</p>
          ))}
          {diff.chiefs.changed.map((c: ChiefChangedEntry) => (
            <p key={c.id} className={styles.changed}>
              ~ {c.name}: {c.fields_changed.join(', ')}
            </p>
          ))}
        </DiffSection>
      )}

      {/* Laws */}
      {hasEntries(diff.laws) && (
        <DiffSection title="Laws">
          {diff.laws.added.map((l) => (
            <p key={l.id} className={styles.added}>+ [{l.category}] {l.id}</p>
          ))}
          {diff.laws.removed.map((l) => (
            <p key={l.id} className={styles.removed}>- [{l.category}] {l.id}</p>
          ))}
          {diff.laws.changed.map((l: LawChangedEntry) => (
            <p key={l.id} className={styles.changed}>
              ~ [{l.category}] {l.id}: {l.fields.join(', ')}
            </p>
          ))}
        </DiffSection>
      )}

      {/* Skills */}
      {hasEntries(diff.skills) && (
        <DiffSection title="Skills">
          {diff.skills.added.map((s) => (
            <p key={s.id} className={styles.added}>+ {s.name} ({s.id})</p>
          ))}
          {diff.skills.removed.map((s) => (
            <p key={s.id} className={styles.removed}>- {s.name} ({s.id})</p>
          ))}
          {diff.skills.changed.map((s: SkillChangedEntry) => (
            <p key={s.id} className={styles.changed}>
              ~ {s.name}: {s.fields.join(', ')}
            </p>
          ))}
        </DiffSection>
      )}

      {/* Loops */}
      {(diff.loops.added.length > 0 || diff.loops.removed.length > 0) && (
        <DiffSection title="Cycles">
          {diff.loops.added.map((id) => (
            <p key={id} className={styles.added}>+ {id}</p>
          ))}
          {diff.loops.removed.map((id) => (
            <p key={id} className={styles.removed}>- {id}</p>
          ))}
        </DiffSection>
      )}
    </div>
  )
}

// --- Helper components ---

function DiffSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {children}
    </div>
  )
}

// --- Helper functions ---

function hasEntries(group: { added: unknown[]; removed: unknown[]; changed: unknown[] }): boolean {
  return group.added.length > 0 || group.removed.length > 0 || group.changed.length > 0
}
