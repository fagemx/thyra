/**
 * execution-adapter.ts — Heartbeat Protocol 的 adapter 層
 *
 * 定義 ExecutionAdapter interface + ExecutionAdapterRegistry + LocalAdapter。
 * GovernanceScheduler 透過此層 invoke chief，而非直接 executeChiefCycle。
 *
 * 核心元件：
 *   - ExecutionAdapter: 統一的 agent 呼叫介面
 *   - ExecutionAdapterRegistry: adapter 註冊表（DI friendly）
 *   - LocalAdapter: 包裝現有 rule-based 策略為 heartbeat protocol
 *   - buildHeartbeatContext: 組裝心跳 context（fat/thin mode）
 *   - processHeartbeatResult: 處理 agent 回報的結果
 *
 * 契約遵守：
 *   - CHIEF-01: proposals 全部經 WorldManager.apply() 含 judge pipeline
 *   - THY-07: usage 寫入 audit_log
 *   - ADAPTER-01: adapter failure 不影響主循環（由 scheduler try/catch 保證）
 */

import { randomUUID } from 'crypto';
import type { Database } from 'bun:sqlite';
import type { HeartbeatContext, HeartbeatResult, HeartbeatTrigger } from './schemas/heartbeat';
import { HeartbeatResultSchema } from './schemas/heartbeat';
import type { Chief } from './chief-engine';
import type { WorldState } from './world/state';
import type { WorldManager, ApplyResult } from './world-manager';
import { makeChiefDecision, dispatchChiefPipelines } from './chief-autonomy';
import { appendAudit } from './db';
import type { KarviBridge } from './karvi-bridge';

// ---------------------------------------------------------------------------
// ExecutionAdapter 介面
// ---------------------------------------------------------------------------

/**
 * 統一的 agent 呼叫介面。
 * 每種 adapter 實作此介面，讓 GovernanceScheduler 不需要知道具體實現。
 */
export interface ExecutionAdapter {
  /** adapter 類型標識 */
  readonly type: string;

  /**
   * 呼叫 agent，傳入心跳 context，回傳結果。
   * 失敗應拋出 Error，由呼叫方 catch。
   */
  invoke(context: HeartbeatContext): Promise<HeartbeatResult>;

  /** 健康檢查（Phase 2+）。回傳 adapter 是否可用。 */
  healthCheck?(): Promise<boolean>;

  /** 建立 stateful session（Phase 2+）。回傳 session ID。 */
  createSession?(chiefId: string): Promise<string>;

  /** 銷毀 session（Phase 2+）。 */
  destroySession?(sessionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// ExecutionAdapterRegistry
// ---------------------------------------------------------------------------

/**
 * Adapter 註冊表。
 * GovernanceScheduler 透過 registry 取得對應 adapter，
 * 不直接依賴具體 adapter 實作。
 */
export class ExecutionAdapterRegistry {
  private adapters = new Map<string, ExecutionAdapter>();

  /** 註冊一個 adapter。重複註冊同一 type 會覆蓋。 */
  register(adapter: ExecutionAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /** 取得指定 type 的 adapter。不存在時拋出錯誤。 */
  get(type: string): ExecutionAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`ADAPTER_NOT_FOUND: no adapter registered for type "${type}"`);
    }
    return adapter;
  }

  /** 是否已註冊指定 type */
  has(type: string): boolean {
    return this.adapters.has(type);
  }

  /** 列出所有已註冊的 adapter types */
  listTypes(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// ---------------------------------------------------------------------------
// LocalAdapter — 包裝現有 rule-based 策略
// ---------------------------------------------------------------------------

/**
 * 本地 adapter：使用現有 makeChiefDecision() 產生提案。
 * 這保證了零回歸 — 現有行為完全保留。
 *
 * 需要 WorldManager + chiefs 資訊才能運作。
 * chiefs 的查找透過 chiefLookup 函數注入（避免直接依賴 ChiefEngine）。
 */
export class LocalAdapter implements ExecutionAdapter {
  readonly type = 'local';

  constructor(
    private worldManager: WorldManager,
    private chiefLookup: (chiefId: string) => Chief | null,
  ) {}

  invoke(context: HeartbeatContext): Promise<HeartbeatResult> {
    const startMs = Date.now();

    const chief = this.chiefLookup(context.chief_id);
    if (!chief) {
      return Promise.resolve({
        heartbeat_id: context.heartbeat_id,
        status: 'failed',
        usage: { duration_ms: Date.now() - startMs },
      });
    }

    // 取得最新 WorldState
    const state = this.worldManager.getState(context.village_id);

    // 使用現有 rule-based 策略
    const chiefProposals = makeChiefDecision(chief, state);

    // 轉換 proposals → WorldChange[]
    const proposals = chiefProposals.map(p => p.change);

    const durationMs = Date.now() - startMs;

    return Promise.resolve({
      heartbeat_id: context.heartbeat_id,
      status: 'completed',
      proposals: proposals.length > 0 ? proposals : undefined,
      usage: { duration_ms: durationMs },
    });
  }
}

// ---------------------------------------------------------------------------
// KarviPipelineAdapter — 封裝 pipeline dispatch 到 Karvi
// ---------------------------------------------------------------------------

/**
 * Karvi pipeline adapter：將 chief 的 pipelines 派發到 Karvi 執行。
 * 包裝 dispatchChiefPipelines()，回傳 in_progress（pipeline 是非同步，結果透過 webhook 回報）。
 *
 * 需要 KarviBridge + chiefs 資訊才能運作。
 */
export class KarviPipelineAdapter implements ExecutionAdapter {
  readonly type = 'karvi';

  constructor(
    private bridge: KarviBridge,
    private chiefLookup: (chiefId: string) => Chief | null,
  ) {}

  async invoke(context: HeartbeatContext): Promise<HeartbeatResult> {
    const startMs = Date.now();

    const chief = this.chiefLookup(context.chief_id);
    if (!chief) {
      return {
        heartbeat_id: context.heartbeat_id,
        status: 'failed',
        usage: { duration_ms: Date.now() - startMs },
      };
    }

    try {
      const dispatches = await dispatchChiefPipelines(this.bridge, context.village_id, chief);
      const durationMs = Date.now() - startMs;
      const allDispatched = dispatches.length > 0 && dispatches.every(d => d.dispatched);

      return {
        heartbeat_id: context.heartbeat_id,
        status: allDispatched ? 'in_progress' : 'failed',
        usage: { duration_ms: durationMs },
      };
    } catch {
      const durationMs = Date.now() - startMs;
      return {
        heartbeat_id: context.heartbeat_id,
        status: 'failed',
        usage: { duration_ms: durationMs },
      };
    }
  }

  healthCheck(): Promise<boolean> {
    // Phase 2: implement Karvi health endpoint check
    return Promise.resolve(true);
  }
}

// ---------------------------------------------------------------------------
// buildHeartbeatContext — 組裝心跳 context
// ---------------------------------------------------------------------------

/** buildHeartbeatContext 的可選參數 */
export interface BuildContextOpts {
  goals?: Record<string, unknown>[];
  precedents?: Record<string, unknown>[];
  assigned_tasks?: Record<string, unknown>[];
}

/**
 * 根據 chief 設定組裝心跳 context。
 *
 * Fat mode: 包含完整 world_state_summary。
 * Thin mode: 只包含 identifiers + constraints。
 */
export function buildHeartbeatContext(
  chief: Chief,
  state: WorldState,
  trigger: HeartbeatTrigger,
  opts?: BuildContextOpts,
): HeartbeatContext {
  const heartbeatId = `hb-${randomUUID()}`;

  // 約束資訊（始終存在）
  const budgetLimits = state.constitution?.budget_limits;
  const budgetRemaining = budgetLimits?.max_cost_per_day ?? 0;
  const permissions = [...chief.permissions];
  const constitutionRules = state.constitution?.rules.map(r => r.description) ?? [];

  const context: HeartbeatContext = {
    heartbeat_id: heartbeatId,
    village_id: chief.village_id,
    chief_id: chief.id,
    trigger,
    context_mode: chief.context_mode,
    budget_remaining: budgetRemaining,
    permissions,
    constitution_rules: constitutionRules,
    assigned_tasks: opts?.assigned_tasks ?? [],
  };

  // Fat mode: 填入完整狀態摘要
  if (chief.context_mode === 'fat') {
    context.world_state_summary = {
      village_name: state.village.name,
      village_status: state.village.status,
      chiefs_count: state.chiefs.length,
      active_laws_count: state.active_laws.length,
      skills_count: state.skills.length,
      running_cycles_count: state.running_cycles.length,
      assembled_at: state.assembled_at,
    };

    if (opts?.goals && opts.goals.length > 0) {
      context.goals = opts.goals;
    }
    if (opts?.precedents && opts.precedents.length > 0) {
      context.precedents = opts.precedents;
    }
  }

  return context;
}

// ---------------------------------------------------------------------------
// processHeartbeatResult — 處理心跳結果
// ---------------------------------------------------------------------------

/** processHeartbeatResult 的回傳值 */
export interface ProcessedHeartbeat {
  heartbeat_id: string;
  status: HeartbeatResult['status'];
  proposals_count: number;
  applied: ApplyResult[];
  rejected_count: number;
  usage: HeartbeatResult['usage'];
}

/**
 * 處理 agent 回報的心跳結果：
 *   1. 驗證 result schema
 *   2. proposals → worldManager.apply()（經 judge pipeline）
 *   3. usage → audit_log
 */
export function processHeartbeatResult(
  worldManager: WorldManager,
  db: Database,
  villageId: string,
  chief: Chief,
  rawResult: HeartbeatResult,
): ProcessedHeartbeat {
  // 1. 驗證 result
  const result = HeartbeatResultSchema.parse(rawResult);

  const applied: ApplyResult[] = [];
  let rejectedCount = 0;

  // 2. 如果有 proposals，逐一 apply（經 judge pipeline）
  if (result.proposals && result.proposals.length > 0) {
    for (const proposal of result.proposals) {
      const applyResult = worldManager.apply(
        villageId,
        proposal,
        `Heartbeat ${result.heartbeat_id} from chief ${chief.id}`,
      );
      if (applyResult.applied) {
        applied.push(applyResult);
      } else {
        rejectedCount++;
      }
    }
  }

  // 3. 寫入 usage audit（THY-07）
  if (result.usage) {
    appendAudit(db, 'heartbeat', result.heartbeat_id, 'usage', {
      chief_id: chief.id,
      village_id: villageId,
      ...result.usage,
    }, chief.id);
  }

  // 寫入 heartbeat 完成記錄
  appendAudit(db, 'heartbeat', result.heartbeat_id, 'result', {
    chief_id: chief.id,
    village_id: villageId,
    status: result.status,
    proposals_count: result.proposals?.length ?? 0,
    applied_count: applied.length,
    rejected_count: rejectedCount,
  }, chief.id);

  return {
    heartbeat_id: result.heartbeat_id,
    status: result.status,
    proposals_count: result.proposals?.length ?? 0,
    applied,
    rejected_count: rejectedCount,
    usage: result.usage,
  };
}

// ---------------------------------------------------------------------------
// createDefaultRegistry — 建立包含 LocalAdapter 的預設 registry
// ---------------------------------------------------------------------------

/**
 * 建立預設 ExecutionAdapterRegistry，已註冊 LocalAdapter。
 * 若提供 KarviBridge，額外註冊 KarviPipelineAdapter。
 * 供 GovernanceScheduler 使用。
 */
export function createDefaultRegistry(
  worldManager: WorldManager,
  chiefLookup: (chiefId: string) => Chief | null,
  karviBridge?: KarviBridge,
): ExecutionAdapterRegistry {
  const registry = new ExecutionAdapterRegistry();
  registry.register(new LocalAdapter(worldManager, chiefLookup));
  if (karviBridge) {
    registry.register(new KarviPipelineAdapter(karviBridge, chiefLookup));
  }
  return registry;
}
