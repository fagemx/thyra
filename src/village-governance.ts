import type { Database } from 'bun:sqlite';
import type { VillageManager, Village } from './village-manager';
import type { ConstitutionStore, Constitution } from './constitution-store';
import type { ChiefEngine, Chief } from './chief-engine';
import type { LawEngine, Law } from './law-engine';
import type { RiskAssessor, AssessmentResult, Action } from './risk-assessor';
import type { BriefInput, AskInput, CommandInput, AskTopic } from './schemas/governance';
import { appendAudit } from './db';

// ---- Brief 簡報 ----

export interface VillageBrief {
  village: Village;
  constitution: {
    active: Constitution | null;
    total_versions: number;
  };
  chiefs: {
    active_count: number;
    total_count: number;
    list: Chief[];
  };
  laws: {
    active_count: number;
    proposed_count: number;
    total_count: number;
    recent: Law[];
  };
  loops: {
    running_count: number;
    completed_today: number;
    total_count: number;
  };
  budget: {
    spent_today: number;
    limits: { max_cost_per_action: number; max_cost_per_day: number; max_cost_per_loop: number } | null;
  };
  generated_at: string;
}

// ---- Ask 回答 ----

export interface AskAnswer {
  question: string;
  topic: AskTopic;
  answer: string;
  sources: Array<{ type: string; id: string; detail: string }>;
  generated_at: string;
}

// ---- Command 結果 ----

export interface CommandResult {
  action: string;
  assessment: AssessmentResult;
  approved: boolean;
  message: string;
  generated_at: string;
}

// ---- Dependencies ----

export interface GovernanceDeps {
  db: Database;
  villageMgr: VillageManager;
  constitutionStore: ConstitutionStore;
  chiefEngine: ChiefEngine;
  lawEngine: LawEngine;
  riskAssessor: RiskAssessor;
}

/**
 * 產生村莊簡報 — 聚合所有治理狀態
 */
export function generateBrief(
  deps: GovernanceDeps,
  villageId: string,
  input: BriefInput,
): VillageBrief {
  const village = deps.villageMgr.get(villageId);
  if (!village) throw new Error('Village not found');

  const activeConstitution = deps.constitutionStore.getActive(villageId);
  const allConstitutions = deps.constitutionStore.list(villageId);

  const allChiefs = deps.chiefEngine.list(villageId);
  const activeChiefs = allChiefs.filter((c) => c.status === 'active');

  const allLaws = deps.lawEngine.list(villageId);
  const activeLaws = allLaws.filter((l) => l.status === 'active');
  const proposedLaws = allLaws.filter((l) => l.status === 'proposed');

  // Loop 統計（直接查 DB）
  const loopStats = getLoopStats(deps.db, villageId);

  // 預算
  const spentToday = deps.riskAssessor.getSpentToday(villageId);
  const budgetLimits = activeConstitution?.budget_limits ?? null;

  // detailed 模式顯示更多 recent laws
  const recentLimit = input.depth === 'detailed' ? 20 : 5;
  const recentLaws = allLaws.slice(0, recentLimit);

  // detailed 模式顯示所有 chiefs，summary 只顯示 active
  const chiefList = input.depth === 'detailed' ? allChiefs : activeChiefs;

  return {
    village,
    constitution: {
      active: activeConstitution,
      total_versions: allConstitutions.length,
    },
    chiefs: {
      active_count: activeChiefs.length,
      total_count: allChiefs.length,
      list: chiefList,
    },
    laws: {
      active_count: activeLaws.length,
      proposed_count: proposedLaws.length,
      total_count: allLaws.length,
      recent: recentLaws,
    },
    loops: loopStats,
    budget: {
      spent_today: spentToday,
      limits: budgetLimits,
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * 回答關於村莊的治理問題
 */
export function answerQuestion(
  deps: GovernanceDeps,
  villageId: string,
  input: AskInput,
): AskAnswer {
  const village = deps.villageMgr.get(villageId);
  if (!village) throw new Error('Village not found');

  const topic = classifyTopic(input.question);
  const { answer, sources } = buildAnswer(deps, villageId, topic, input);

  return {
    question: input.question,
    topic,
    answer,
    sources,
    generated_at: new Date().toISOString(),
  };
}

/**
 * 執行指令（經 risk assessment）
 */
export function executeCommand(
  deps: GovernanceDeps,
  villageId: string,
  input: CommandInput,
): CommandResult {
  const village = deps.villageMgr.get(villageId);
  if (!village) throw new Error('Village not found');

  const constitution = deps.constitutionStore.getActive(villageId);

  const action: Action = {
    type: input.action,
    description: input.description,
    initiated_by: input.initiated_by,
    village_id: villageId,
    estimated_cost: input.estimated_cost,
    reason: input.reason,
    rollback_plan: input.rollback_plan,
    metadata: input.metadata,
  };

  const recentRollbacks = getRecentRollbacks(deps.db, villageId);

  const assessment = deps.riskAssessor.assess(action, {
    constitution,
    recent_rollbacks: recentRollbacks,
  });

  // THY-03: low → 自動, medium → 需確認, high → 需人類發起
  const approved = assessment.level === 'low' && !assessment.blocked;

  let message: string;
  if (assessment.blocked) {
    message = `Command blocked: ${assessment.reasons.filter((r) => r.severity === 'block').map((r) => r.message).join('; ')}`;
  } else if (assessment.level === 'high') {
    message = 'Command requires human initiation (risk: high)';
  } else if (assessment.level === 'medium') {
    message = 'Command requires human confirmation (risk: medium)';
  } else {
    message = 'Command approved for automatic execution (risk: low)';
  }

  // 記錄到 audit log (THY-07)
  appendAudit(deps.db, 'governance_command', villageId, 'command', {
    action: input.action,
    risk_level: assessment.level,
    approved,
    blocked: assessment.blocked,
  }, input.initiated_by);

  return {
    action: input.action,
    assessment,
    approved,
    message,
    generated_at: new Date().toISOString(),
  };
}

// ---- Internal helpers ----

function getLoopStats(db: Database, villageId: string): {
  running_count: number;
  completed_today: number;
  total_count: number;
} {
  const running = db.prepare(
    "SELECT COUNT(*) as cnt FROM loop_cycles WHERE village_id = ? AND status = 'running'"
  ).get(villageId) as { cnt: number } | null;

  const today = new Date().toISOString().split('T')[0];
  const completedToday = db.prepare(
    "SELECT COUNT(*) as cnt FROM loop_cycles WHERE village_id = ? AND status = 'completed' AND created_at >= ?"
  ).get(villageId, today + 'T00:00:00.000Z') as { cnt: number } | null;

  const total = db.prepare(
    'SELECT COUNT(*) as cnt FROM loop_cycles WHERE village_id = ?'
  ).get(villageId) as { cnt: number } | null;

  return {
    running_count: running?.cnt ?? 0,
    completed_today: completedToday?.cnt ?? 0,
    total_count: total?.cnt ?? 0,
  };
}

function getRecentRollbacks(db: Database, villageId: string): Array<{ category: string; rolled_back_at: string }> {
  const rows = db.prepare(`
    SELECT l.category, a.created_at as rolled_back_at
    FROM audit_log a
    JOIN laws l ON a.entity_id = l.id
    WHERE a.entity_type = 'law' AND a.action = 'rolled_back'
      AND l.village_id = ?
    ORDER BY a.created_at DESC LIMIT 10
  `).all(villageId) as Array<{ category: string; rolled_back_at: string }>;
  return rows;
}

/**
 * 根據問題關鍵字分類主題
 */
function classifyTopic(question: string): AskTopic {
  const q = question.toLowerCase();
  if (q.includes('constitution') || q.includes('rule') || q.includes('permission')) return 'constitution';
  if (q.includes('chief') || q.includes('agent') || q.includes('村長')) return 'chiefs';
  if (q.includes('law') || q.includes('策略') || q.includes('policy')) return 'laws';
  if (q.includes('budget') || q.includes('cost') || q.includes('預算') || q.includes('spend')) return 'budget';
  if (q.includes('loop') || q.includes('cycle') || q.includes('運行')) return 'loops';
  if (q.includes('skill') || q.includes('能力') || q.includes('tool')) return 'skills';
  return 'general';
}

interface AnswerResult {
  answer: string;
  sources: Array<{ type: string; id: string; detail: string }>;
}

function buildAnswer(
  deps: GovernanceDeps,
  villageId: string,
  topic: AskTopic,
  input: AskInput,
): AnswerResult {
  const sources: Array<{ type: string; id: string; detail: string }> = [];

  switch (topic) {
    case 'constitution': {
      const c = deps.constitutionStore.getActive(villageId);
      if (!c) return { answer: 'No active constitution found for this village.', sources };
      sources.push({ type: 'constitution', id: c.id, detail: `v${c.version}, ${c.rules.length} rules` });
      const rulesSummary = c.rules.map((r) => `[${r.enforcement}] ${r.description}`).join('; ');
      const permsSummary = c.allowed_permissions.join(', ');
      return {
        answer: `Active constitution: ${c.id} (v${c.version}). Rules: ${rulesSummary}. Permissions: ${permsSummary}. Budget: action=${c.budget_limits.max_cost_per_action}, day=${c.budget_limits.max_cost_per_day}, loop=${c.budget_limits.max_cost_per_loop}.`,
        sources,
      };
    }
    case 'chiefs': {
      const chiefs = input.chief_id
        ? [deps.chiefEngine.get(input.chief_id)].filter((c): c is Chief => c !== null)
        : deps.chiefEngine.list(villageId, { status: 'active' });
      if (chiefs.length === 0) return { answer: 'No active chiefs found.', sources };
      for (const ch of chiefs) {
        sources.push({ type: 'chief', id: ch.id, detail: `${ch.name} (${ch.role})` });
      }
      const summary = chiefs.map((ch) => `${ch.name}: ${ch.role}, ${ch.skills.length} skills, ${ch.permissions.length} permissions`).join('; ');
      return { answer: `Active chiefs: ${summary}.`, sources };
    }
    case 'laws': {
      const laws = deps.lawEngine.list(villageId);
      const active = laws.filter((l) => l.status === 'active');
      const proposed = laws.filter((l) => l.status === 'proposed');
      for (const l of active.slice(0, 5)) {
        sources.push({ type: 'law', id: l.id, detail: `[${l.status}] ${l.category}` });
      }
      return {
        answer: `Total laws: ${laws.length}. Active: ${active.length}. Proposed (pending): ${proposed.length}.${active.length > 0 ? ' Active categories: ' + [...new Set(active.map((l) => l.category))].join(', ') + '.' : ''}`,
        sources,
      };
    }
    case 'budget': {
      const c = deps.constitutionStore.getActive(villageId);
      const spentToday = deps.riskAssessor.getSpentToday(villageId);
      if (!c) return { answer: `No constitution. Today's spend: $${spentToday}.`, sources };
      sources.push({ type: 'constitution', id: c.id, detail: 'budget limits' });
      const remaining = c.budget_limits.max_cost_per_day - spentToday;
      return {
        answer: `Budget: spent today $${spentToday} / $${c.budget_limits.max_cost_per_day} daily limit ($${remaining} remaining). Per-action limit: $${c.budget_limits.max_cost_per_action}. Per-loop limit: $${c.budget_limits.max_cost_per_loop}.`,
        sources,
      };
    }
    case 'loops': {
      const stats = getLoopStats(deps.db, villageId);
      return {
        answer: `Loops: ${stats.running_count} running, ${stats.completed_today} completed today, ${stats.total_count} total.`,
        sources,
      };
    }
    case 'skills': {
      // 查 chiefs 綁定的 skills
      const chiefs = deps.chiefEngine.list(villageId, { status: 'active' });
      const skillIds = new Set<string>();
      for (const ch of chiefs) {
        for (const s of ch.skills) {
          skillIds.add(s.skill_id);
        }
      }
      return {
        answer: `${chiefs.length} active chiefs with ${skillIds.size} unique skills bound.`,
        sources: chiefs.map((ch) => ({ type: 'chief', id: ch.id, detail: `${ch.skills.length} skills` })),
      };
    }
    case 'general':
    default: {
      // 提供概覽
      const brief = generateBrief(deps, villageId, { depth: 'summary' });
      return {
        answer: `Village "${brief.village.name}" (${brief.village.status}): ${brief.chiefs.active_count} chiefs, ${brief.laws.active_count} active laws, ${brief.loops.running_count} running loops. Constitution: ${brief.constitution.active ? 'active' : 'none'}.`,
        sources: brief.constitution.active
          ? [{ type: 'constitution', id: brief.constitution.active.id, detail: 'active' }]
          : [],
      };
    }
  }
}
