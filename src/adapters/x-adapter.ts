/**
 * x-adapter.ts — X (Twitter) adapter (MVP: log-only)。
 *
 * Phase 1: console.info 輸出，作為 dry-run audit trail。
 * Phase 2: 接 X API v2 (POST /2/tweets)。
 *
 * ADAPTER-02: 只讀，不寫 world state。
 */
import type { AdapterAction } from '../schemas/adapter';
import type { Adapter } from './interface';

export interface XAdapterConfig {
  apiKey?: string;
  apiSecret?: string;
}

export class XAdapter implements Adapter {
  readonly platform = 'x' as const;

  // Phase 2: config 會用於 X API v2 認證
  readonly config: XAdapterConfig | undefined;

  constructor(config?: XAdapterConfig) {
    this.config = config;
  }

  execute(action: AdapterAction): Promise<void> {
    // MVP: structured log only. Phase 2: X API v2.
    console.info(`[XAdapter] ${action.type}: ${JSON.stringify(action.content)}`);
    return Promise.resolve();
  }
}
