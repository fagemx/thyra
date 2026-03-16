import { Hono } from 'hono';
import type { Context } from 'hono';
import { CreateChiefInput, UpdateChiefInput, GovernanceActionInput } from '../schemas/chief';
import type { GovernanceActionInput as GovernanceActionInputType } from '../schemas/chief';
import type { ChiefEngine, Chief } from '../chief-engine';
import { buildChiefPrompt, listProfiles } from '../chief-engine';
import type { SkillRegistry } from '../skill-registry';
import type { RiskAssessor, Action, AssessmentContext } from '../risk-assessor';
import type { KarviBridge } from '../karvi-bridge';
import type { Constitution } from '../constitution-store';
import { appendAudit } from '../db';
import type { Database } from 'bun:sqlite';

export interface ChiefRouteDeps {
  riskAssessor?: RiskAssessor;
  karviBridge?: KarviBridge;
  db?: Database;
}

/** 將 validation error message 映射到 HTTP error code + status */
function mapValidationError(msg: string): { code: string; status: 400 | 403 | 404 } {
  if (msg.includes('PERMISSION_DENIED')) return { code: 'PERMISSION_DENIED', status: 403 };
  if (msg.includes('CHIEF_INACTIVE')) return { code: 'CHIEF_INACTIVE', status: 403 };
  if (msg.includes('not found')) return { code: 'NOT_FOUND', status: 404 };
  if (msg.includes('VALIDATION')) return { code: 'VALIDATION', status: 400 };
  return { code: 'BAD_REQUEST', status: 400 };
}

/** 建構 risk assessment action 物件 */
function buildRiskAction(chief: Chief, actionInput: GovernanceActionInputType): Action {
  return {
    type: actionInput.action_type,
    description: actionInput.description,
    initiated_by: chief.id,
    village_id: chief.village_id,
    estimated_cost: actionInput.estimated_cost,
    reason: `T2 governance action: ${actionInput.description}`,
    rollback_plan: actionInput.rollback_plan,
  };
}

/** 執行 risk assessment，回傳 error response 或 null（通過） */
function assessGovernanceRisk(
  riskAssessor: RiskAssessor,
  chief: Chief,
  constitution: Constitution,
  actionInput: GovernanceActionInputType,
  c: Context,
): Response | null {
  const action = buildRiskAction(chief, actionInput);
  const ctx: AssessmentContext = {
    constitution,
    recent_rollbacks: [],
    chief_personality: chief.personality,
  };
  const assessment = riskAssessor.assess(action, ctx);

  if (assessment.blocked) {
    return c.json({
      ok: false,
      error: {
        code: 'RISK_BLOCKED',
        message: 'Governance action blocked by risk assessment',
        details: { level: assessment.level, reasons: assessment.reasons },
      },
    }, 403);
  }

  // T2 governance actions — high risk 需要人類確認 (THY-03)
  if (assessment.level === 'high') {
    return c.json({
      ok: false,
      error: {
        code: 'RISK_HIGH',
        message: 'Governance action requires human approval (high risk)',
        details: { level: assessment.level, reasons: assessment.reasons },
      },
    }, 403);
  }

  return null;
}

/** 透過 KarviBridge 執行治理動作 */
async function executeViaKarvi(
  bridge: KarviBridge,
  actionInput: GovernanceActionInputType,
): Promise<Record<string, unknown>> {
  if (actionInput.action_type === 'create_project' && actionInput.project) {
    const projectResult = await bridge.dispatchProject({
      title: actionInput.project.title,
      repo: actionInput.project.repo,
      tasks: actionInput.project.tasks,
    });
    return { dispatched: projectResult !== null, project: projectResult };
  }

  if (actionInput.action_type === 'cancel_task' && actionInput.task_id) {
    const cancelled = await bridge.cancelTask(actionInput.task_id);
    return { cancelled, task_id: actionInput.task_id };
  }

  if (actionInput.action_type === 'adjust_priority' && actionInput.task_id) {
    // Karvi 尚未實作 priority API，記錄 intent
    return { recorded: true, task_id: actionInput.task_id, priority: actionInput.priority };
  }

  return {};
}

export function chiefRoutes(engine: ChiefEngine, skillRegistry: SkillRegistry, deps?: ChiefRouteDeps): Hono {
  const app = new Hono();

  // 列出所有可用的 personality profiles
  app.get('/api/chiefs/profiles', (_c) => {
    return _c.json({ ok: true, data: listProfiles() });
  });

  app.get('/api/villages/:vid/chiefs', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json({ ok: true, data: engine.list(c.req.param('vid'), status ? { status } : undefined) });
  });

  app.post('/api/villages/:vid/chiefs', async (c) => {
    const parsed = CreateChiefInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: engine.create(c.req.param('vid'), parsed.data, 'human') }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const code = msg.includes('PERMISSION_EXCEEDS') ? 'PERMISSION_EXCEEDS_CONSTITUTION'
        : msg.includes('SKILL_NOT_VERIFIED') ? 'SKILL_NOT_VERIFIED'
        : 'BAD_REQUEST';
      return c.json({ ok: false, error: { code, message: msg } }, 400);
    }
  });

  app.get('/api/chiefs/:id', (c) => {
    const chief = engine.get(c.req.param('id'));
    if (!chief) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Chief not found' } }, 404);
    return c.json({ ok: true, data: chief });
  });

  app.patch('/api/chiefs/:id', async (c) => {
    const parsed = UpdateChiefInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: engine.update(c.req.param('id'), parsed.data, 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.delete('/api/chiefs/:id', (c) => {
    try {
      engine.deactivate(c.req.param('id'), 'human');
      return c.json({ ok: true, data: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  app.get('/api/chiefs/:id/prompt', (c) => {
    const chief = engine.get(c.req.param('id'));
    if (!chief) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Chief not found' } }, 404);
    const prompt = buildChiefPrompt(chief, skillRegistry);
    return c.json({ ok: true, data: { prompt } });
  });

  /**
   * Resume a paused chief — 只有人類能恢復 (#226)
   */
  app.post('/api/chiefs/:id/resume', (c) => {
    const id = c.req.param('id');
    try {
      const chief = engine.resumeChief(id, 'human');
      return c.json({ ok: true, data: chief });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg.includes('not found')) {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      if (msg.includes('CHIEF_NOT_PAUSED')) {
        return c.json({ ok: false, error: { code: 'CHIEF_NOT_PAUSED', message: msg } }, 400);
      }
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  /**
   * T2 Governance Action — Chief 執行治理動作
   * 流程：validate → risk assess (medium) → dispatch via KarviBridge
   */
  app.post('/api/chiefs/:id/actions', async (c) => {
    const parsed = GovernanceActionInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }

    // Step 1: Validate chief permissions + state
    let validated: ReturnType<typeof engine.validateGovernanceAction>;
    try {
      validated = engine.validateGovernanceAction(c.req.param('id'), parsed.data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const mapped = mapValidationError(msg);
      return c.json({ ok: false, error: { code: mapped.code, message: msg } }, mapped.status);
    }

    const { chief, constitution } = validated;

    // Step 2: Risk assessment (T2 actions = medium risk baseline)
    if (deps?.riskAssessor) {
      const riskError = assessGovernanceRisk(deps.riskAssessor, chief, constitution, parsed.data, c);
      if (riskError) return riskError;
    }

    // Step 3: Execute via KarviBridge
    if (!deps?.karviBridge) {
      if (deps?.db) {
        appendAudit(deps.db, 'chief', chief.id, 'governance_action_no_bridge', { action: parsed.data }, chief.id);
      }
      return c.json({
        ok: true,
        data: { action_type: parsed.data.action_type, status: 'recorded', message: 'KarviBridge not configured; action recorded but not dispatched' },
      });
    }

    try {
      const result = await executeViaKarvi(deps.karviBridge, parsed.data);
      if (deps.db) {
        appendAudit(deps.db, 'chief', chief.id, 'governance_action', { action: parsed.data, result }, chief.id);
      }
      return c.json({ ok: true, data: { action_type: parsed.data.action_type, status: 'executed', result } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'DISPATCH_FAILED', message: msg } }, 502);
    }
  });

  return app;
}
