/**
 * interface.ts — Adapter interface 定義。
 *
 * ADAPTER-01: adapter 失敗不影響 governance loop。
 * ADAPTER-02: adapter 只讀 state 不寫。
 */
import type { AdapterAction, AdapterExecutionReport } from '../schemas/adapter';

// ---------------------------------------------------------------------------
// Adapter — 單一平台 adapter
// ---------------------------------------------------------------------------

export interface Adapter {
  /** 平台識別符（如 'x', 'discord'） */
  readonly platform: string;

  /**
   * 執行一個 adapter action。
   * 實作必須自行處理平台 API 呼叫。
   * ADAPTER-02: 只讀，不得修改 world state。
   */
  execute(action: AdapterAction): Promise<void>;
}

// ---------------------------------------------------------------------------
// AdapterRegistry — adapter 註冊與批次執行
// ---------------------------------------------------------------------------

export interface AdapterRegistry {
  /** 註冊一個 adapter */
  register(adapter: Adapter): void;

  /**
   * 批次執行 actions，每個 action 根據 platform 分派到對應 adapter。
   * ADAPTER-01: 任何 adapter 失敗都不影響其他 adapter 或 governance loop。
   * 回傳執行報告。
   */
  executeAll(actions: AdapterAction[]): Promise<AdapterExecutionReport>;

  /** 列出已註冊的平台名稱 */
  getRegisteredPlatforms(): string[];

  /** 檢查指定平台是否已註冊 */
  has(platform: string): boolean;
}

// ---------------------------------------------------------------------------
// ChiefCycleResult — 決策結果 stub（D1 會定義完整版本）
// ---------------------------------------------------------------------------

export interface ChiefCycleResult {
  applied: boolean;
  change_type: string;
  village_id: string;
  diff: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// chiefResultToActions — 決策結果 -> 平台動作映射（stub）
// ---------------------------------------------------------------------------

/**
 * 將 Chief 決策結果映射為 adapter actions。
 * Stub 實作 — D1 完成後會擴充映射規則。
 */
export function chiefResultToActions(
  result: ChiefCycleResult,
  _marketState?: unknown,
): AdapterAction[] {
  if (!result.applied) return [];

  return [{
    type: 'notify',
    platform: 'discord',
    content: `[${result.village_id}] Change applied: ${result.change_type}`,
    metadata: { change_type: result.change_type, diff: result.diff },
  }];
}
