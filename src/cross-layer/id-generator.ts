import { nanoid } from 'nanoid';

// ID prefixes for storage pack scope (L1, promotion, L5). L3/L4 prefixes defined separately.
export const ID_PREFIXES = {
  // L1 — Völva Working State
  decision_session: 'ds',
  card: 'card',
  candidate: 'cand',
  probe: 'probe',
  signal: 'sig',
  commit_memo: 'commit',
  promotion_check: 'promo',
  checklist: 'chk',
  decision_event: 'evt',

  // Promotion layer
  handoff: 'handoff',
  rollback: 'rollback',

  // L5 — Edda
  precedent: 'prec',
  decision_trace: 'dec',
  suggestion: 'sug',
} as const;

export type IdPrefix = typeof ID_PREFIXES[keyof typeof ID_PREFIXES];

export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${nanoid(12)}`;
}

export function extractPrefix(id: string): string | null {
  const match = id.match(/^([a-z]+)_/);
  return match ? match[1] : null;
}

/**
 * Validate ID format. Accepts two random part formats:
 * - Thyra/Edda: `<prefix>_<nanoid(12)>` (e.g., "ds_aBcDeFgHiJkL")
 * - Völva: `<prefix>_<crypto.randomUUID()>` (e.g., "ds_550e8400-e29b-41d4-a716-446655440000")
 * Both are valid — cross-layer operations must accept either format.
 */
export function isValidIdFormat(id: string): boolean {
  const prefix = extractPrefix(id);
  if (!prefix) return false;
  const rest = id.slice(prefix.length + 1);
  // Accept nanoid (12+ alphanumeric) or UUID (36 chars with dashes)
  return rest.length >= 12;
}
