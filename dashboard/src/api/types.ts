/**
 * Dashboard-local type definitions.
 * Mirrored from Thyra API response shapes — NEVER import from src/ (DASH-01).
 */

// --- API envelope ---

export interface ApiOk<T> {
  ok: true
  data: T
}

export interface ApiErr {
  ok: false
  error: { code: string; message: string }
}

export type ApiResponse<T> = ApiOk<T> | ApiErr

// --- Village ---

export interface Village {
  id: string
  name: string
  description: string
  status: string
  target_repo: string
  created_at: string
  version: number
}

// --- Governance entities (minimal for WorldState) ---

export interface Constitution {
  id: string
  village_id: string
  name: string
  rules: string
  allowed_permissions: string[]
  budget_limits: Record<string, number>
  status: string
  created_at: string
  version: number
}

export interface Chief {
  id: string
  village_id: string
  name: string
  role: string
  permissions: string[]
  personality: string
  status: string
  created_at: string
  version: number
}

export interface Law {
  id: string
  village_id: string
  category: string
  content: string
  status: string
  created_at: string
  version: number
}

export interface Skill {
  id: string
  village_id: string
  name: string
  status: string
  created_at: string
  version: number
}

export interface LoopCycle {
  id: string
  village_id: string
  status: string
  created_at: string
}

// --- World ---

export interface WorldState {
  village: Village
  constitution: Constitution | null
  chiefs: Chief[]
  active_laws: Law[]
  skills: Skill[]
  running_cycles: LoopCycle[]
  assembled_at: string
}

export type WorldChangeType =
  | 'constitution.supersede'
  | 'law.propose'
  | 'law.enact'
  | 'law.repeal'
  | 'chief.appoint'
  | 'chief.dismiss'
  | 'chief.update_permissions'
  | 'skill.register'
  | 'skill.revoke'
  | 'budget.adjust'
  | 'cycle.start'
  | 'cycle.end'
  | 'village.update'

/**
 * Loose WorldChange shape for JSON-based input.
 * Backend validates against discriminated union via Zod.
 */
export interface WorldChange {
  type: WorldChangeType
  [key: string]: unknown
}

// --- Judge Result (mirrors src/world/judge.ts JudgeResult) ---

export interface JudgeResult {
  allowed: boolean
  reasons: string[]
  safety_check: boolean
  legality_check: boolean
  boundary_check: boolean
  evaluator_check: boolean
  consistency_check: boolean
  warnings: string[]
  requires_approval: boolean
}

// --- Apply Result (mirrors src/world-manager.ts ApplyResult) ---

export interface ApplyResult {
  applied: boolean
  judge_result: JudgeResult
  snapshot_before: string
  diff: WorldStateDiff | null
  state_after: WorldState | null
}

// --- WorldStateDiff (mirrors src/world/diff.ts) ---

export interface VillageDiff {
  fields_changed: string[]
}

export interface ConstitutionDiff {
  action: 'created' | 'superseded' | 'revoked'
  before_id: string | null
  after_id: string | null
  fingerprint_before: string | null
  fingerprint_after: string | null
}

export interface ChiefDiffEntry {
  id: string
  name: string
}

export interface ChiefChangedEntry extends ChiefDiffEntry {
  fields_changed: string[]
}

export interface ChiefsDiff {
  added: ChiefDiffEntry[]
  removed: ChiefDiffEntry[]
  changed: ChiefChangedEntry[]
}

export interface LawDiffEntry {
  id: string
  category: string
}

export interface LawChangedEntry extends LawDiffEntry {
  fields: string[]
}

export interface LawsDiff {
  added: LawDiffEntry[]
  removed: LawDiffEntry[]
  changed: LawChangedEntry[]
}

export interface SkillDiffEntry {
  id: string
  name: string
}

export interface SkillChangedEntry extends SkillDiffEntry {
  fields: string[]
}

export interface SkillsDiff {
  added: SkillDiffEntry[]
  removed: SkillDiffEntry[]
  changed: SkillChangedEntry[]
}

export interface LoopCyclesDiff {
  added: string[]
  removed: string[]
}

export interface WorldStateDiff {
  village_id: string
  village: VillageDiff | null
  constitution: ConstitutionDiff | null
  chiefs: ChiefsDiff
  laws: LawsDiff
  skills: SkillsDiff
  loops: LoopCyclesDiff
  has_changes: boolean
<<<<<<< HEAD
}

// --- WorldHealth (mirrors src/world/health.ts) ---

export interface WorldHealthScores {
  chief: number
  constitution: number
  law: number
  skill: number
  budget: number
  freshness: number
}

export interface WorldHealth {
  overall: number
  chief_count: number
  law_count: number
  skill_count: number
  budget_utilization: number
  last_change_age_ms: number
  constitution_active: boolean
  cycle_count: number
  scores: WorldHealthScores
}

// --- Audit Entry (mirrors audit_log row) ---

export interface AuditEntry {
  id: string
  village_id: string
  category: string
  entity_id: string
  action: string
  details: Record<string, unknown>
  actor: string
  created_at: string
}

// --- Telemetry (mirrors CycleTelemetry) ---

export interface TelemetryEntry {
  id: string
  village_id: string
  chief_id: string
  operation: string
  duration_ms: number
  status: string
  error_message: string | null
  created_at: string
}

export interface TelemetrySummary {
  total_cycles: number
  avg_duration_ms: number
  slowest_operation: string
  error_rate: number
  chief_breakdown: Record<string, { avg_ms: number; cycles: number }>
}

// --- Budget (mirrors budget endpoint response) ---

export interface BudgetStatus {
  village_id: string
  total_budget: number
  used_budget: number
  remaining_budget: number
  utilization: number
}

// --- World Health ---

export interface WorldHealth {
  overall: number
  chief_count: number
  law_count: number
  skill_count: number
  budget_utilization: number
  last_change_age_ms: number
  constitution_active: boolean
  cycle_count: number
  scores: {
    chief: number
    constitution: number
    law: number
    skill: number
    budget: number
    freshness: number
  }
}

// --- Audit ---

export interface AuditEntry {
  id: number
  entity_type: string
  entity_id: string
  action: string
  payload: string
  actor: string
  created_at: string
}
