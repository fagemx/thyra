import type { Database } from 'bun:sqlite';
import type { Constitution, BudgetLimits } from './constitution-store';
import { detectRuleViolation } from './constitution-store';
import type { Permission } from './schemas/constitution';

export interface Action {
  type: string;
  description: string;
  initiated_by: string;
  village_id: string;
  estimated_cost: number;
  reason: string;
  rollback_plan?: string;
  grants_permission?: Permission[];
  cross_village?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AssessmentResult {
  level: 'low' | 'medium' | 'high';
  blocked: boolean;
  reasons: AssessmentReason[];
  budget_check: {
    per_action: { limit: number; current: number; ok: boolean };
    per_day: { limit: number; spent: number; ok: boolean };
    per_loop: { limit: number; spent: number; ok: boolean };
  };
}

export interface AssessmentReason {
  source: 'safety_invariant' | 'constitution' | 'heuristic';
  id: string;
  message: string;
  severity: 'block' | 'high' | 'medium' | 'low';
}

export interface ChiefPersonality {
  risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
  communication_style: 'concise' | 'detailed' | 'minimal';
  decision_speed: 'fast' | 'deliberate' | 'cautious';
}

export interface AssessmentContext {
  constitution: Constitution | null;
  both_constitutions_allow?: boolean;
  recent_rollbacks: { category: string; rolled_back_at: string }[];
  chief_personality?: ChiefPersonality;
  loop_id?: string;
}

interface SafetyInvariant {
  id: string;
  check: (action: Action, ctx: AssessmentContext) => boolean;
  message: string;
}

/** 7 Safety Invariants — hardcoded, never overridable (THY-12) */
export const SAFETY_INVARIANTS: SafetyInvariant[] = [
  {
    id: 'SI-1',
    check: (action) => action.type !== 'disable_human_override',
    message: '人類隨時可以按停止鍵',
  },
  {
    id: 'SI-2',
    check: (action) => !!action.reason,
    message: '所有 AI 決策必須有理由鏈',
  },
  {
    id: 'SI-3',
    check: (action) => action.rollback_plan !== undefined,
    message: '自動執行必須可回滾',
  },
  {
    id: 'SI-4',
    check: (action, ctx) =>
      action.estimated_cost <= (ctx.constitution?.budget_limits.max_cost_per_action ?? 10),
    message: '單次花費不得超過上限',
  },
  {
    id: 'SI-5',
    check: (action, ctx) => {
      if (!action.grants_permission) return true;
      const allowed = ctx.constitution?.allowed_permissions ?? [];
      return action.grants_permission.every((p) => allowed.includes(p));
    },
    message: '不得授予超出 Constitution 的權限',
  },
  {
    id: 'SI-6',
    check: (action) => action.type !== 'delete_constitution',
    message: '不得自動刪除人類建立的 Constitution',
  },
  {
    id: 'SI-7',
    check: (action, ctx) =>
      !action.cross_village || ctx.both_constitutions_allow === true,
    message: '跨村莊操作需雙方 Constitution 允許',
  },
];

export class RiskAssessor {
  constructor(private db: Database) {}

  assess(action: Action, ctx: AssessmentContext): AssessmentResult {
    const reasons: AssessmentReason[] = [];

    // Layer 1: Safety Invariants
    for (const si of SAFETY_INVARIANTS) {
      if (!si.check(action, ctx)) {
        reasons.push({
          source: 'safety_invariant',
          id: si.id,
          message: si.message,
          severity: 'block',
        });
      }
    }

    if (reasons.some((r) => r.severity === 'block')) {
      return {
        level: 'high',
        blocked: true,
        reasons,
        budget_check: this.checkBudgets(action, ctx),
      };
    }

    // Layer 2: Constitution Rules
    if (ctx.constitution) {
      const actionText = [action.type, action.description, action.reason]
        .filter(Boolean)
        .join(' ');
      for (const rule of ctx.constitution.rules) {
        const inScope = rule.scope.includes('*') || rule.scope.includes(action.initiated_by);
        if (!inScope) continue;
        if (detectRuleViolation(rule.description, actionText)) {
          reasons.push({
            source: 'constitution',
            id: rule.id,
            message: rule.description,
            severity: rule.enforcement === 'hard' ? 'block' : 'medium',
          });
        }
      }
    }

    // Early return if any constitution hard rule blocks
    if (reasons.some((r) => r.severity === 'block')) {
      return {
        level: 'high',
        blocked: true,
        reasons,
        budget_check: this.checkBudgets(action, ctx),
      };
    }

    // Layer 3: Heuristic Scoring
    const heuristics = this.computeHeuristics(action, ctx);
    reasons.push(...heuristics);

    // Layer 4: Budget enforcement — per_day / per_loop aggregate limits
    const budgetCheck = this.checkBudgets(action, ctx);

    if (!budgetCheck.per_day.ok) {
      reasons.push({
        source: 'constitution',
        id: 'BUDGET-DAY',
        message: '每日預算已超出限制',
        severity: 'block',
      });
    }
    if (!budgetCheck.per_loop.ok) {
      reasons.push({
        source: 'constitution',
        id: 'BUDGET-LOOP',
        message: '單次 Loop 預算已超出限制',
        severity: 'block',
      });
    }

    const blocked = reasons.some((r) => r.severity === 'block');
    const level = blocked ? 'high' : this.deriveLevel(reasons);

    return {
      level,
      blocked,
      reasons,
      budget_check: budgetCheck,
    };
  }

  private computeHeuristics(action: Action, ctx: AssessmentContext): AssessmentReason[] {
    const reasons: AssessmentReason[] = [];
    const desc = action.type.toLowerCase();

    // H-1: deploy / merge_pr → medium
    if (desc.includes('deploy') || desc.includes('merge_pr')) {
      reasons.push({ source: 'heuristic', id: 'H-1', message: 'Action involves deploy/merge', severity: 'medium' });
    }

    // H-2: cross village → high
    if (action.cross_village) {
      reasons.push({ source: 'heuristic', id: 'H-2', message: 'Cross-village action', severity: 'high' });
    }

    // H-3: 24h 內同 category 被 rollback → high
    const recentRb = ctx.recent_rollbacks.filter((r) => {
      const age = Date.now() - new Date(r.rolled_back_at).getTime();
      return age < 24 * 60 * 60 * 1000;
    });
    if (recentRb.length > 0) {
      reasons.push({ source: 'heuristic', id: 'H-3', message: 'Recent rollback in same category', severity: 'high' });
    }

    // H-4: aggressive chief → medium
    if (ctx.chief_personality?.risk_tolerance === 'aggressive') {
      reasons.push({ source: 'heuristic', id: 'H-4', message: 'Aggressive chief requires extra scrutiny', severity: 'medium' });
    }

    // H-5: cost > 50% of action limit → medium
    if (ctx.constitution) {
      const limit = ctx.constitution.budget_limits.max_cost_per_action;
      if (action.estimated_cost > limit * 0.5) {
        reasons.push({ source: 'heuristic', id: 'H-5', message: 'Cost exceeds 50% of action limit', severity: 'medium' });
      }
    }

    return reasons;
  }

  private deriveLevel(reasons: AssessmentReason[]): 'low' | 'medium' | 'high' {
    if (reasons.some((r) => r.severity === 'high' || r.severity === 'block')) return 'high';
    if (reasons.some((r) => r.severity === 'medium')) return 'medium';
    return 'low';
  }

  private checkBudgets(action: Action, ctx: AssessmentContext) {
    const limits: BudgetLimits = ctx.constitution?.budget_limits ?? {
      max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50,
    };
    const spentToday = this.getSpentToday(action.village_id);
    const spentLoop = ctx.loop_id ? this.getSpentInLoop(action.village_id, ctx.loop_id) : 0;

    return {
      per_action: { limit: limits.max_cost_per_action, current: action.estimated_cost, ok: action.estimated_cost <= limits.max_cost_per_action },
      per_day: { limit: limits.max_cost_per_day, spent: spentToday, ok: spentToday + action.estimated_cost <= limits.max_cost_per_day },
      per_loop: { limit: limits.max_cost_per_loop, spent: spentLoop, ok: spentLoop + action.estimated_cost <= limits.max_cost_per_loop },
    };
  }

  getSpentToday(villageId: string): number {
    const today = new Date().toISOString().split('T')[0];
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(json_extract(payload, '$.cost')), 0) as total
      FROM audit_log WHERE entity_type = 'budget' AND entity_id = ? AND created_at >= ?
    `).get(villageId, today + 'T00:00:00.000Z') as Record<string, unknown> | null;
    return (row?.total as number) ?? 0;
  }

  getSpentInLoop(villageId: string, loopId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(json_extract(payload, '$.cost')), 0) as total
      FROM audit_log WHERE entity_type = 'budget' AND entity_id = ?
        AND json_extract(payload, '$.loop_id') = ?
    `).get(villageId, loopId) as Record<string, unknown> | null;
    return (row?.total as number) ?? 0;
  }

  recordSpend(villageId: string, loopId: string | null, amount: number): void {
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('budget', villageId, 'spend', JSON.stringify({ cost: amount, loop_id: loopId }), 'system', new Date().toISOString());
  }
}
