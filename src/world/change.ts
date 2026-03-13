import type { WorldState } from './state';
import type {
  WorldChange,
  ConstitutionCreateChange,
  ConstitutionSupersedeChange,
  ConstitutionRevokeChange,
  LawProposeChange,
  LawApproveChange,
  LawRevokeChange,
  LawRollbackChange,
  ChiefCreateChange,
  ChiefUpdateChange,
  ChiefDeactivateChange,
  SkillRegisterChange,
  SkillVerifyChange,
  SkillDeprecateChange,
} from '../schemas/world-change';
import type { Constitution } from '../constitution-store';
import type { Law } from '../law-engine';
import type { Chief } from '../chief-engine';
import type { Skill } from '../skill-registry';
import { createGovernancePatch, type GovernancePatch } from '../schemas/governance-patch';

/**
 * Pure function：將 WorldChange 套用到 WorldState，回傳新的 WorldState。
 * 不做 DB 操作，不寫 audit_log。可用於 preview / dry-run。
 *
 * @throws Error 如果 change.village_id 與 state 不符
 * @throws Error 如果目標 entity 不存在（approve/revoke/rollback 找不到 law 等）
 * @throws Error 如果 constitution create 時已有 active constitution
 */
export function applyChange(state: WorldState, change: WorldChange): WorldState {
  if (change.village_id !== state.village.id) {
    throw new Error(
      `Village mismatch: change targets ${change.village_id} but state is ${state.village.id}`,
    );
  }

  switch (change.change_type) {
    case 'constitution.create':
      return applyConstitutionCreate(state, change);
    case 'constitution.supersede':
      return applyConstitutionSupersede(state, change);
    case 'constitution.revoke':
      return applyConstitutionRevoke(state, change);
    case 'law.propose':
      return applyLawPropose(state, change);
    case 'law.approve':
      return applyLawApprove(state, change);
    case 'law.revoke':
      return applyLawRevoke(state, change);
    case 'law.rollback':
      return applyLawRollback(state, change);
    case 'chief.create':
      return applyChiefCreate(state, change);
    case 'chief.update':
      return applyChiefUpdate(state, change);
    case 'chief.deactivate':
      return applyChiefDeactivate(state, change);
    case 'skill.register':
      return applySkillRegister(state, change);
    case 'skill.verify':
      return applySkillVerify(state, change);
    case 'skill.deprecate':
      return applySkillDeprecate(state, change);
    default: {
      // exhaustive check
      const _exhaustive: never = change;
      throw new Error(`Unknown change type: ${(_exhaustive as WorldChange).change_type}`);
    }
  }
}

// --- Constitution helpers ---

function applyConstitutionCreate(
  state: WorldState,
  change: ConstitutionCreateChange,
): WorldState {
  if (state.constitution !== null) {
    throw new Error('Cannot create constitution: village already has an active constitution');
  }
  const now = change.proposed_at;
  const constitution: Constitution = {
    id: change.change_id, // 使用 change_id 作為 entity id placeholder
    village_id: change.village_id,
    version: 1,
    status: 'active',
    created_at: now,
    created_by: change.proposed_by,
    rules: change.payload.rules.map((r, i) => ({
      id: r.id ?? `rule_${i + 1}`,
      description: r.description,
      enforcement: r.enforcement,
      scope: r.scope,
    })),
    allowed_permissions: [...change.payload.allowed_permissions],
    budget_limits: { ...change.payload.budget_limits },
    superseded_by: null,
  };
  return { ...state, constitution, assembled_at: now };
}

function applyConstitutionSupersede(
  state: WorldState,
  change: ConstitutionSupersedeChange,
): WorldState {
  if (state.constitution === null) {
    throw new Error('Cannot supersede: no active constitution');
  }
  if (state.constitution.id !== change.payload.old_id) {
    throw new Error(
      `Constitution mismatch: expected ${change.payload.old_id} but active is ${state.constitution.id}`,
    );
  }
  const now = change.proposed_at;
  const newConstitution: Constitution = {
    id: change.change_id,
    village_id: change.village_id,
    version: state.constitution.version + 1,
    status: 'active',
    created_at: now,
    created_by: change.proposed_by,
    rules: change.payload.new_input.rules.map((r, i) => ({
      id: r.id ?? `rule_${i + 1}`,
      description: r.description,
      enforcement: r.enforcement,
      scope: r.scope,
    })),
    allowed_permissions: [...change.payload.new_input.allowed_permissions],
    budget_limits: { ...change.payload.new_input.budget_limits },
    superseded_by: null,
  };
  return { ...state, constitution: newConstitution, assembled_at: now };
}

function applyConstitutionRevoke(
  state: WorldState,
  change: ConstitutionRevokeChange,
): WorldState {
  if (state.constitution === null) {
    throw new Error('Cannot revoke: no active constitution');
  }
  if (state.constitution.id !== change.payload.constitution_id) {
    throw new Error(
      `Constitution mismatch: expected ${change.payload.constitution_id} but active is ${state.constitution.id}`,
    );
  }
  return { ...state, constitution: null, assembled_at: change.proposed_at };
}

// --- Law helpers ---

function applyLawPropose(state: WorldState, change: LawProposeChange): WorldState {
  const now = change.proposed_at;
  const newLaw: Law = {
    id: change.change_id,
    village_id: change.village_id,
    proposed_by: change.payload.chief_id,
    approved_by: null,
    version: 1,
    status: 'proposed',
    category: change.payload.input.category,
    content: {
      description: change.payload.input.content.description,
      strategy: { ...change.payload.input.content.strategy },
    },
    risk_level: 'low', // risk assessment 由 commitChange 負責，preview 預設 low
    evidence: {
      source: change.payload.input.evidence.source,
      reasoning: change.payload.input.evidence.reasoning,
      edda_refs: change.payload.input.evidence.edda_refs,
    },
    effectiveness: null,
    created_at: now,
    updated_at: now,
  };
  return {
    ...state,
    active_laws: [...state.active_laws, newLaw],
    assembled_at: now,
  };
}

function findLawOrThrow(state: WorldState, lawId: string): { law: Law; index: number } {
  const index = state.active_laws.findIndex((l) => l.id === lawId);
  if (index === -1) {
    throw new Error(`Law not found in active_laws: ${lawId}`);
  }
  return { law: state.active_laws[index], index };
}

function applyLawApprove(state: WorldState, change: LawApproveChange): WorldState {
  const { law, index } = findLawOrThrow(state, change.payload.law_id);
  const updatedLaw: Law = {
    ...law,
    status: 'active',
    approved_by: change.proposed_by,
    updated_at: change.proposed_at,
  };
  const newLaws = [...state.active_laws];
  newLaws[index] = updatedLaw;
  return { ...state, active_laws: newLaws, assembled_at: change.proposed_at };
}

function applyLawRevoke(state: WorldState, change: LawRevokeChange): WorldState {
  const { index } = findLawOrThrow(state, change.payload.law_id);
  // revoked law 不再出現在 active_laws 中
  const newLaws = state.active_laws.filter((_, i) => i !== index);
  return { ...state, active_laws: newLaws, assembled_at: change.proposed_at };
}

function applyLawRollback(state: WorldState, change: LawRollbackChange): WorldState {
  const { index } = findLawOrThrow(state, change.payload.law_id);
  // rolled_back law 不再出現在 active_laws 中
  const newLaws = state.active_laws.filter((_, i) => i !== index);
  return { ...state, active_laws: newLaws, assembled_at: change.proposed_at };
}

// --- Chief helpers ---

function applyChiefCreate(state: WorldState, change: ChiefCreateChange): WorldState {
  const now = change.proposed_at;
  const newChief: Chief = {
    id: change.change_id,
    village_id: change.village_id,
    name: change.payload.name,
    role: change.payload.role,
    version: 1,
    status: 'active',
    skills: change.payload.skills.map((s) => ({
      skill_id: s.skill_id,
      skill_version: s.skill_version,
      config: s.config,
    })),
    permissions: [...change.payload.permissions],
    personality: { ...change.payload.personality },
    constraints: change.payload.constraints.map((c) => ({
      type: c.type,
      description: c.description,
    })),
    created_at: now,
    updated_at: now,
  };
  return {
    ...state,
    chiefs: [...state.chiefs, newChief],
    assembled_at: now,
  };
}

function findChiefOrThrow(state: WorldState, chiefId: string): { chief: Chief; index: number } {
  const index = state.chiefs.findIndex((c) => c.id === chiefId);
  if (index === -1) {
    throw new Error(`Chief not found: ${chiefId}`);
  }
  return { chief: state.chiefs[index], index };
}

function applyChiefUpdate(state: WorldState, change: ChiefUpdateChange): WorldState {
  const { chief, index } = findChiefOrThrow(state, change.payload.chief_id);
  const updates = change.payload.updates;
  const updatedChief: Chief = {
    ...chief,
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.role !== undefined && { role: updates.role }),
    ...(updates.skills !== undefined && {
      skills: updates.skills.map((s) => ({
        skill_id: s.skill_id,
        skill_version: s.skill_version,
        config: s.config,
      })),
    }),
    ...(updates.permissions !== undefined && { permissions: [...updates.permissions] }),
    ...(updates.personality !== undefined && { personality: { ...updates.personality } }),
    ...(updates.constraints !== undefined && {
      constraints: updates.constraints.map((c) => ({
        type: c.type,
        description: c.description,
      })),
    }),
    version: chief.version + 1,
    updated_at: change.proposed_at,
  };
  const newChiefs = [...state.chiefs];
  newChiefs[index] = updatedChief;
  return { ...state, chiefs: newChiefs, assembled_at: change.proposed_at };
}

function applyChiefDeactivate(state: WorldState, change: ChiefDeactivateChange): WorldState {
  const { index } = findChiefOrThrow(state, change.payload.chief_id);
  // inactive chief 不再出現在 chiefs 列表中（WorldState 只含 active chiefs）
  const newChiefs = state.chiefs.filter((_, i) => i !== index);
  return { ...state, chiefs: newChiefs, assembled_at: change.proposed_at };
}

// --- Skill helpers ---

function applySkillRegister(state: WorldState, change: SkillRegisterChange): WorldState {
  const now = change.proposed_at;
  const newSkill: Skill = {
    id: change.change_id,
    name: change.payload.name,
    version: 1,
    status: 'draft', // 新建 skill 是 draft，尚未 verified
    village_id: change.payload.village_id ?? null,
    definition: { ...change.payload.definition },
    created_at: now,
    updated_at: now,
    verified_at: null,
    verified_by: null,
  };
  return {
    ...state,
    skills: [...state.skills, newSkill],
    assembled_at: now,
  };
}

function findSkillOrThrow(state: WorldState, skillId: string): { skill: Skill; index: number } {
  const index = state.skills.findIndex((s) => s.id === skillId);
  if (index === -1) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  return { skill: state.skills[index], index };
}

function applySkillVerify(state: WorldState, change: SkillVerifyChange): WorldState {
  const { skill, index } = findSkillOrThrow(state, change.payload.skill_id);
  const updatedSkill: Skill = {
    ...skill,
    status: 'verified',
    verified_at: change.proposed_at,
    verified_by: change.proposed_by,
    updated_at: change.proposed_at,
  };
  const newSkills = [...state.skills];
  newSkills[index] = updatedSkill;
  return { ...state, skills: newSkills, assembled_at: change.proposed_at };
}

function applySkillDeprecate(state: WorldState, change: SkillDeprecateChange): WorldState {
  const { index } = findSkillOrThrow(state, change.payload.skill_id);
  // deprecated skill 不再出現在 skills 列表中（WorldState 只含 verified skills）
  const newSkills = state.skills.filter((_, i) => i !== index);
  return { ...state, skills: newSkills, assembled_at: change.proposed_at };
}

// --- toGovernancePatch: WorldChange → governance.patch.v1 ---

/**
 * 將 WorldChange 轉換為 GovernancePatch（通知 Karvi 用）。
 * 不是所有 change 都需要通知 Karvi：chief/skill changes 回傳 null。
 */
export function toGovernancePatch(change: WorldChange): GovernancePatch | null {
  switch (change.change_type) {
    case 'constitution.create':
      return createGovernancePatch(
        change.village_id,
        'constitution_created',
        { rules: change.payload.rules, allowed_permissions: change.payload.allowed_permissions },
      );
    case 'constitution.supersede':
      return createGovernancePatch(
        change.village_id,
        'constitution_superseded',
        { old_id: change.payload.old_id },
      );
    case 'constitution.revoke':
      return createGovernancePatch(
        change.village_id,
        'constitution_revoked',
        { constitution_id: change.payload.constitution_id },
      );
    case 'law.propose':
      return createGovernancePatch(
        change.village_id,
        'law_proposed',
        { chief_id: change.payload.chief_id, category: change.payload.input.category },
      );
    case 'law.approve':
      return createGovernancePatch(
        change.village_id,
        'law_enacted',
        { law_id: change.payload.law_id },
      );
    case 'law.revoke':
    case 'law.rollback':
      return createGovernancePatch(
        change.village_id,
        'law_repealed',
        { law_id: change.payload.law_id },
      );
    // chief 和 skill changes 不需要通知 Karvi
    case 'chief.create':
    case 'chief.update':
    case 'chief.deactivate':
    case 'skill.register':
    case 'skill.verify':
    case 'skill.deprecate':
      return null;
    default: {
      const _exhaustive: never = change;
      return null;
    }
  }
}
