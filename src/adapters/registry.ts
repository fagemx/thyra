/**
 * registry.ts — DefaultAdapterRegistry 實作。
 *
 * ADAPTER-01: 每個 adapter 的 execute() 獨立 try/catch，失敗不影響其他。
 * THY-07: adapter 失敗寫 audit_log（當 db 可用時）。
 */
import type { Database } from 'bun:sqlite';
import { appendAudit } from '../db';
import type { AdapterAction, AdapterExecutionReport } from '../schemas/adapter';
import type { Adapter, AdapterRegistry } from './interface';

export class DefaultAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  constructor(private db?: Database) {}

  register(adapter: Adapter): void {
    if (this.adapters.has(adapter.platform)) {
      console.warn(`[AdapterRegistry] overwriting existing adapter for platform: ${adapter.platform}`);
    }
    this.adapters.set(adapter.platform, adapter);
  }

  async executeAll(actions: AdapterAction[]): Promise<AdapterExecutionReport> {
    const report: AdapterExecutionReport = {
      total: actions.length,
      dispatched: 0,
      skipped: 0,
      failed: [],
    };

    for (const action of actions) {
      const adapter = this.adapters.get(action.platform);
      if (!adapter) {
        report.skipped++;
        continue;
      }

      try {
        await adapter.execute(action);
        report.dispatched++;
      } catch (err: unknown) {
        report.failed.push(action.platform);
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[AdapterRegistry] adapter '${action.platform}' failed: ${message}`);

        // THY-07: audit log adapter failure
        if (this.db) {
          try {
            appendAudit(
              this.db,
              'adapter',
              action.platform,
              'execute_failed',
              { action_type: action.type, error: message },
              'system',
            );
          } catch {
            // audit log 寫入失敗不影響流程
          }
        }
      }
    }

    return report;
  }

  getRegisteredPlatforms(): string[] {
    return [...this.adapters.keys()];
  }

  has(platform: string): boolean {
    return this.adapters.has(platform);
  }
}
