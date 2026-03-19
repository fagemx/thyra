/**
 * observation-sources/state-diff-source.ts — 從 WorldState diff 產生觀察
 *
 * Pure function：接受兩個 WorldState，回傳 Observation[]。
 * 每個顯著變化產生一個結構化觀察。
 *
 * @see TRACK_A_OBSERVATION_BUILDER.md Step 2
 */

import type { WorldState } from '../../world/state';
import type { Observation } from '../../schemas/observation';
import { diffWorldState } from '../../world/diff';
import { randomUUID } from 'crypto';

/**
 * 從兩個 WorldState 快照的差異產生觀察。
 * 不同領域的變化映射到不同的 scope + importance。
 */
export function observeFromStateDiff(
  previous: WorldState,
  current: WorldState,
): Observation[] {
  const diff = diffWorldState(previous, current);

  if (!diff.has_changes) return [];

  const observations: Observation[] = [];
  const now = new Date().toISOString();

  // village 欄位變化 → medium
  if (diff.village) {
    observations.push({
      id: `obs_diff_village_${randomUUID()}`,
      source: 'state_diff',
      timestamp: now,
      scope: 'world',
      importance: 'medium',
      summary: `Village fields changed: ${diff.village.fields_changed.join(', ')}`,
      details: { fields_changed: diff.village.fields_changed },
    });
  }

  // constitution 變化 → high
  if (diff.constitution) {
    observations.push({
      id: `obs_diff_const_${randomUUID()}`,
      source: 'state_diff',
      timestamp: now,
      scope: 'world',
      importance: 'high',
      summary: `Constitution ${diff.constitution.action}`,
      details: {
        action: diff.constitution.action,
        before_id: diff.constitution.before_id,
        after_id: diff.constitution.after_id,
      },
    });
  }

  // chiefs 變化 → high
  if (diff.chiefs.added.length > 0 || diff.chiefs.removed.length > 0 || diff.chiefs.changed.length > 0) {
    observations.push({
      id: `obs_diff_chief_${randomUUID()}`,
      source: 'state_diff',
      timestamp: now,
      scope: 'chief',
      importance: 'high',
      summary: `Chief changes: +${diff.chiefs.added.length} -${diff.chiefs.removed.length} ~${diff.chiefs.changed.length}`,
      targetIds: [
        ...diff.chiefs.added.map(c => c.id),
        ...diff.chiefs.removed.map(c => c.id),
        ...diff.chiefs.changed.map(c => c.id),
      ],
    });
  }

  // laws 變化 → medium
  if (diff.laws.added.length > 0 || diff.laws.removed.length > 0 || diff.laws.changed.length > 0) {
    observations.push({
      id: `obs_diff_law_${randomUUID()}`,
      source: 'state_diff',
      timestamp: now,
      scope: 'law',
      importance: 'medium',
      summary: `Law changes: +${diff.laws.added.length} -${diff.laws.removed.length} ~${diff.laws.changed.length}`,
      targetIds: [
        ...diff.laws.added.map(l => l.id),
        ...diff.laws.removed.map(l => l.id),
        ...diff.laws.changed.map(l => l.id),
      ],
    });
  }

  // skills 變化 → low
  if (diff.skills.added.length > 0 || diff.skills.removed.length > 0 || diff.skills.changed.length > 0) {
    observations.push({
      id: `obs_diff_skill_${randomUUID()}`,
      source: 'state_diff',
      timestamp: now,
      scope: 'world',
      importance: 'low',
      summary: `Skill changes: +${diff.skills.added.length} -${diff.skills.removed.length} ~${diff.skills.changed.length}`,
    });
  }

  // loop cycles 變化 → low
  if (diff.loops.added.length > 0 || diff.loops.removed.length > 0) {
    observations.push({
      id: `obs_diff_loop_${randomUUID()}`,
      source: 'state_diff',
      timestamp: now,
      scope: 'world',
      importance: 'low',
      summary: `Loop cycle changes: +${diff.loops.added.length} -${diff.loops.removed.length}`,
    });
  }

  return observations;
}
