/**
 * pack-diff.ts — Village Pack diff engine
 *
 * Pure functions for computing diff between YAML desired-state and DB current-state.
 * No DB access, no side effects. Used by the compiler (Step 3) to determine
 * which lifecycle operations to trigger.
 *
 * @see docs/VILLAGE_PACK_V01.md §4
 */

import { createHash } from 'crypto';
import type { VillagePackConstitution, VillagePackChief, VillagePackLaw } from './schemas/village-pack';
import type { Constitution } from './constitution-store';
import type { Chief } from './chief-engine';
import type { Law } from './law-engine';
import type { SkillBinding } from './schemas/skill';

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/** Recursive deep equality for plain objects, arrays, and primitives. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!deepEqual(aObj[aKeys[i]], bObj[bKeys[i]])) return false;
    }
    return true;
  }

  return false;
}

/** Order-insensitive string array comparison. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join('\0') === [...b].sort().join('\0');
}

/** Order-insensitive SkillBinding[] comparison (by skill_id + skill_version + config). */
function sameBindings(a: SkillBinding[], b: SkillBinding[]): boolean {
  if (a.length !== b.length) return false;
  const sortKey = (s: SkillBinding) => `${s.skill_id}:${s.skill_version}`;
  const aSorted = [...a].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  const bSorted = [...b].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  for (let i = 0; i < aSorted.length; i++) {
    if (aSorted[i].skill_id !== bSorted[i].skill_id) return false;
    if (aSorted[i].skill_version !== bSorted[i].skill_version) return false;
    if (!deepEqual(aSorted[i].config ?? {}, bSorted[i].config ?? {})) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Constitution fingerprint
// ---------------------------------------------------------------------------

/** Input shape accepted by canonicalize (works for both YAML and mapped DB objects). */
interface CanonicalConstitutionInput {
  rules: Array<{ description: string; enforcement: string; scope: string[] }>;
  allowed_permissions: string[];
  budget: { max_cost_per_action: number; max_cost_per_day: number; max_cost_per_loop: number };
}

/**
 * Produce a deterministic canonical JSON for a constitution.
 *
 * Canonicalization rules (§4.1):
 * - Rules: drop id, description → trim().toLowerCase(), sort scope, sort rules by canonical description
 * - allowed_permissions: sort alphabetically
 * - budget: numeric values, key order doesn't matter (JSON.stringify is deterministic for same keys)
 */
export function canonicalizeConstitution(c: CanonicalConstitutionInput): string {
  const canonical = {
    rules: c.rules
      .map((r) => ({
        description: r.description.trim().toLowerCase(),
        enforcement: r.enforcement,
        scope: [...r.scope].sort(),
      }))
      .sort((a, b) => a.description.localeCompare(b.description)),
    allowed_permissions: [...c.allowed_permissions].sort(),
    budget: c.budget,
  };
  return JSON.stringify(canonical);
}

/**
 * SHA-256 fingerprint of canonical constitution form.
 * Returns first 16 hex characters for compact representation.
 */
export function constitutionFingerprint(c: CanonicalConstitutionInput): string {
  return createHash('sha256')
    .update(canonicalizeConstitution(c))
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// diffConstitution
// ---------------------------------------------------------------------------

/**
 * Compare YAML constitution against current DB constitution.
 *
 * - null current → 'create'
 * - Different fingerprint → 'supersede' (THY-01: immutable, can only supersede)
 * - Same fingerprint → 'skip'
 */
export function diffConstitution(
  yaml: VillagePackConstitution,
  current: Constitution | null,
): 'create' | 'supersede' | 'skip' {
  if (!current) return 'create';

  const yamlFp = constitutionFingerprint({
    rules: yaml.rules,
    allowed_permissions: yaml.allowed_permissions,
    budget: yaml.budget,
  });

  // Map DB field name: budget_limits → budget
  const currentFp = constitutionFingerprint({
    rules: current.rules,
    allowed_permissions: current.allowed_permissions,
    budget: current.budget_limits,
  });

  return yamlFp !== currentFp ? 'supersede' : 'skip';
}

// ---------------------------------------------------------------------------
// diffChief
// ---------------------------------------------------------------------------

/**
 * Compare YAML chief against current DB chief.
 *
 * - null current → 'create'
 * - Any semantic difference → 'update'
 * - All same → 'skip'
 *
 * @param resolvedSkills - Pre-resolved SkillBinding[] from compiler's skill resolution phase
 */
export function diffChief(
  yaml: VillagePackChief,
  current: Chief | null,
  resolvedSkills: SkillBinding[],
): 'create' | 'update' | 'skip' {
  if (!current) return 'create';

  const changed =
    yaml.name !== current.name ||
    yaml.role !== current.role ||
    !deepEqual(yaml.personality, current.personality) ||
    !deepEqual(yaml.constraints, current.constraints) ||
    !sameSet(yaml.permissions, current.permissions) ||
    !sameSet(yaml.pipelines ?? [], current.pipelines ?? []) ||
    !sameBindings(resolvedSkills, current.skills);

  return changed ? 'update' : 'skip';
}

// ---------------------------------------------------------------------------
// diffLaws
// ---------------------------------------------------------------------------

/** Result of laws diff — three buckets of operations. */
export interface LawsDiffResult {
  toPropose: VillagePackLaw[];
  toRevoke: Law[];
  toReplace: Array<{ old: Law; new: VillagePackLaw }>;
}

/**
 * Compare YAML laws against active DB laws.
 *
 * Phase 1: category is the unique key (one active law per category).
 *
 * - YAML has, DB doesn't → toPropose
 * - DB has, YAML doesn't → toRevoke
 * - Both have, content differs → toReplace (revoke old + propose new)
 * - Both have, content same → skip
 */
export function diffLaws(
  yamlLaws: VillagePackLaw[],
  activeLaws: Law[],
): LawsDiffResult {
  const yamlByCategory = new Map(yamlLaws.map((l) => [l.category, l]));
  const activeByCategory = new Map(activeLaws.map((l) => [l.category, l]));

  const toPropose: VillagePackLaw[] = [];
  const toRevoke: Law[] = [];
  const toReplace: Array<{ old: Law; new: VillagePackLaw }> = [];

  // YAML has, DB doesn't → propose
  for (const [cat, law] of yamlByCategory) {
    if (!activeByCategory.has(cat)) {
      toPropose.push(law);
    }
  }

  // DB has, YAML doesn't → revoke
  for (const [cat, law] of activeByCategory) {
    if (!yamlByCategory.has(cat)) {
      toRevoke.push(law);
    }
  }

  // Both have → compare content, different = replace
  for (const [cat, yamlLaw] of yamlByCategory) {
    const activeLaw = activeByCategory.get(cat);
    if (!activeLaw) continue;
    if (!deepEqual(yamlLaw.content, activeLaw.content)) {
      toReplace.push({ old: activeLaw, new: yamlLaw });
    }
  }

  return { toPropose, toRevoke, toReplace };
}
