/**
 * world/diff.ts — WorldState 兩次快照的結構化差異比較
 *
 * Pure function，無 DB 依賴。用於 judge、audit、continuity proof 等場景。
 * 回答「兩個時刻之間，世界變了什麼」。
 *
 * @see docs/最小世界.md step 3
 */

import { deepEqual } from '../pack-diff';
import { constitutionFingerprint } from '../pack-diff';
import type { WorldState } from './state';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';
import type { Law } from '../law-engine';
import type { Skill } from '../skill-registry';
import type { LoopCycle } from '../loop-runner';

// ---------------------------------------------------------------------------
// Domain Diff 型別
// ---------------------------------------------------------------------------

/** Village 欄位變化 */
export interface VillageDiff {
  fields_changed: Array<'name' | 'description' | 'target_repo' | 'status' | 'metadata'>;
}

/** Constitution 變化（created / superseded / revoked） */
export interface ConstitutionDiff {
  action: 'created' | 'superseded' | 'revoked';
  before_id: string | null;
  after_id: string | null;
  fingerprint_before: string | null;
  fingerprint_after: string | null;
}

/** 單一 Chief 變化描述 */
export interface ChiefDiffEntry {
  id: string;
  name: string;
}

export interface ChiefChangedEntry extends ChiefDiffEntry {
  fields_changed: Array<'name' | 'role' | 'permissions' | 'skills' | 'personality' | 'constraints'>;
}

/** Chiefs 集合變化 */
export interface ChiefsDiff {
  added: ChiefDiffEntry[];
  removed: ChiefDiffEntry[];
  changed: ChiefChangedEntry[];
}

/** Law diff entry */
export interface LawDiffEntry {
  id: string;
  category: string;
}

export interface LawChangedEntry extends LawDiffEntry {
  fields: string[];
}

/** Laws 集合變化 */
export interface LawsDiff {
  added: LawDiffEntry[];
  removed: LawDiffEntry[];
  changed: LawChangedEntry[];
}

/** Skill diff entry */
export interface SkillDiffEntry {
  id: string;
  name: string;
}

export interface SkillChangedEntry extends SkillDiffEntry {
  fields: string[];
}

/** Skills 集合變化 */
export interface SkillsDiff {
  added: SkillDiffEntry[];
  removed: SkillDiffEntry[];
  changed: SkillChangedEntry[];
}

/** Loop cycles 變化 */
export interface LoopCyclesDiff {
  added: string[];   // cycle ids
  removed: string[]; // cycle ids
}

// ---------------------------------------------------------------------------
// Top-level WorldStateDiff
// ---------------------------------------------------------------------------

export interface WorldStateDiff {
  village_id: string;
  village: VillageDiff | null;
  constitution: ConstitutionDiff | null;
  chiefs: ChiefsDiff;
  laws: LawsDiff;
  skills: SkillsDiff;
  loops: LoopCyclesDiff;
  has_changes: boolean;
}

// ---------------------------------------------------------------------------
// Domain diff helpers
// ---------------------------------------------------------------------------

const VILLAGE_DIFF_FIELDS = ['name', 'description', 'target_repo', 'status', 'metadata'] as const;

function diffVillageState(before: Village, after: Village): VillageDiff | null {
  const fields_changed: VillageDiff['fields_changed'] = [];

  for (const field of VILLAGE_DIFF_FIELDS) {
    if (!deepEqual(before[field], after[field])) {
      fields_changed.push(field);
    }
  }

  return fields_changed.length > 0 ? { fields_changed } : null;
}

/**
 * 計算 Constitution fingerprint（映射 DB 的 budget_limits → budget）。
 */
function safeConstitutionFingerprint(c: Constitution): string {
  return constitutionFingerprint({
    rules: c.rules,
    allowed_permissions: c.allowed_permissions,
    budget: c.budget_limits,
  });
}

function diffConstitutionState(
  before: Constitution | null,
  after: Constitution | null,
): ConstitutionDiff | null {
  // 兩邊都沒有
  if (!before && !after) return null;

  // 新建
  if (!before && after) {
    return {
      action: 'created',
      before_id: null,
      after_id: after.id,
      fingerprint_before: null,
      fingerprint_after: safeConstitutionFingerprint(after),
    };
  }

  // 撤銷
  if (before && !after) {
    return {
      action: 'revoked',
      before_id: before.id,
      after_id: null,
      fingerprint_before: safeConstitutionFingerprint(before),
      fingerprint_after: null,
    };
  }

  // 兩邊都有 — 判斷是否相同（上面已排除 null 情況）
  if (!before || !after) return null;

  const fpBefore = safeConstitutionFingerprint(before);
  const fpAfter = safeConstitutionFingerprint(after);

  if (before.id === after.id && fpBefore === fpAfter) {
    return null; // 完全相同
  }

  return {
    action: 'superseded',
    before_id: before.id,
    after_id: after.id,
    fingerprint_before: fpBefore,
    fingerprint_after: fpAfter,
  };
}

const CHIEF_DIFF_FIELDS = ['name', 'role', 'permissions', 'skills', 'personality', 'constraints'] as const;

function diffChiefsState(before: Chief[], after: Chief[]): ChiefsDiff {
  const beforeMap = new Map(before.map(c => [c.id, c]));
  const afterMap = new Map(after.map(c => [c.id, c]));

  const added: ChiefDiffEntry[] = [];
  const removed: ChiefDiffEntry[] = [];
  const changed: ChiefChangedEntry[] = [];

  // added: in after but not in before
  for (const [id, chief] of afterMap) {
    if (!beforeMap.has(id)) {
      added.push({ id, name: chief.name });
    }
  }

  // removed: in before but not in after
  for (const [id, chief] of beforeMap) {
    if (!afterMap.has(id)) {
      removed.push({ id, name: chief.name });
    }
  }

  // changed: in both, compare fields
  for (const [id, beforeChief] of beforeMap) {
    const afterChief = afterMap.get(id);
    if (!afterChief) continue;

    const fields_changed: ChiefChangedEntry['fields_changed'] = [];
    for (const field of CHIEF_DIFF_FIELDS) {
      if (!deepEqual(beforeChief[field], afterChief[field])) {
        fields_changed.push(field);
      }
    }

    if (fields_changed.length > 0) {
      changed.push({ id, name: afterChief.name, fields_changed });
    }
  }

  return { added, removed, changed };
}

const LAW_COMPARE_FIELDS = ['content', 'risk_level', 'status', 'evidence', 'effectiveness'] as const;

function diffLawsState(before: Law[], after: Law[]): LawsDiff {
  const beforeMap = new Map(before.map(l => [l.id, l]));
  const afterMap = new Map(after.map(l => [l.id, l]));

  const added: LawDiffEntry[] = [];
  const removed: LawDiffEntry[] = [];
  const changed: LawChangedEntry[] = [];

  for (const [id, law] of afterMap) {
    if (!beforeMap.has(id)) {
      added.push({ id, category: law.category });
    }
  }

  for (const [id, law] of beforeMap) {
    if (!afterMap.has(id)) {
      removed.push({ id, category: law.category });
    }
  }

  for (const [id, beforeLaw] of beforeMap) {
    const afterLaw = afterMap.get(id);
    if (!afterLaw) continue;

    const fields: string[] = [];
    for (const field of LAW_COMPARE_FIELDS) {
      if (!deepEqual(beforeLaw[field], afterLaw[field])) {
        fields.push(field);
      }
    }

    if (fields.length > 0) {
      changed.push({ id, category: afterLaw.category, fields });
    }
  }

  return { added, removed, changed };
}

const SKILL_COMPARE_FIELDS = ['version', 'status', 'definition'] as const;

function diffSkillsState(before: Skill[], after: Skill[]): SkillsDiff {
  const beforeMap = new Map(before.map(s => [s.id, s]));
  const afterMap = new Map(after.map(s => [s.id, s]));

  const added: SkillDiffEntry[] = [];
  const removed: SkillDiffEntry[] = [];
  const changed: SkillChangedEntry[] = [];

  for (const [id, skill] of afterMap) {
    if (!beforeMap.has(id)) {
      added.push({ id, name: skill.name });
    }
  }

  for (const [id, skill] of beforeMap) {
    if (!afterMap.has(id)) {
      removed.push({ id, name: skill.name });
    }
  }

  for (const [id, beforeSkill] of beforeMap) {
    const afterSkill = afterMap.get(id);
    if (!afterSkill) continue;

    const fields: string[] = [];
    for (const field of SKILL_COMPARE_FIELDS) {
      if (!deepEqual(beforeSkill[field], afterSkill[field])) {
        fields.push(field);
      }
    }

    if (fields.length > 0) {
      changed.push({ id, name: afterSkill.name, fields });
    }
  }

  return { added, removed, changed };
}

function diffLoopCyclesState(before: LoopCycle[], after: LoopCycle[]): LoopCyclesDiff {
  const beforeIds = new Set(before.map(c => c.id));
  const afterIds = new Set(after.map(c => c.id));

  const added: string[] = [];
  const removed: string[] = [];

  for (const id of afterIds) {
    if (!beforeIds.has(id)) added.push(id);
  }
  for (const id of beforeIds) {
    if (!afterIds.has(id)) removed.push(id);
  }

  return { added, removed };
}

// ---------------------------------------------------------------------------
// 主函數
// ---------------------------------------------------------------------------

/**
 * 比較兩個 WorldState snapshot，回傳結構化 diff。
 * Pure function，無 DB 依賴。
 *
 * @throws 如果 before.village.id !== after.village.id
 */
export function diffWorldState(before: WorldState, after: WorldState): WorldStateDiff {
  if (before.village.id !== after.village.id) {
    throw new Error('Cannot diff WorldState across different villages');
  }

  const village = diffVillageState(before.village, after.village);
  const constitution = diffConstitutionState(before.constitution, after.constitution);
  const chiefs = diffChiefsState(before.chiefs, after.chiefs);
  const laws = diffLawsState(before.active_laws, after.active_laws);
  const skills = diffSkillsState(before.skills, after.skills);
  const loops = diffLoopCyclesState(before.running_cycles, after.running_cycles);

  const has_changes = !!(
    village ||
    constitution ||
    chiefs.added.length || chiefs.removed.length || chiefs.changed.length ||
    laws.added.length || laws.removed.length || laws.changed.length ||
    skills.added.length || skills.removed.length || skills.changed.length ||
    loops.added.length || loops.removed.length
  );

  return {
    village_id: before.village.id,
    village,
    constitution,
    chiefs,
    laws,
    skills,
    loops,
    has_changes,
  };
}
