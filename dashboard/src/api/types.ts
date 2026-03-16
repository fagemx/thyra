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

export interface WorldChange {
  type: WorldChangeType
  payload: Record<string, unknown>
}

export interface JudgeVerdict {
  allowed: boolean
  reason: string
  risk_level?: string
  violations?: string[]
}

export interface ApplyResult {
  applied: boolean
  change_id: string
  snapshot_id?: string
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
