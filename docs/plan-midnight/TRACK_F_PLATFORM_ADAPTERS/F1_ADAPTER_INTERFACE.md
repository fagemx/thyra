# F1: Adapter Interface + Registry

> **Layer**: L1
> **Dependencies**: A1（WorldManager — 讀 state）
> **Blocks**: F2
> **Output**: `src/adapters/interface.ts` + `src/adapters/registry.ts`

---

## 實作

### AdapterAction type

```typescript
export interface AdapterAction {
  type: 'post' | 'notify' | 'update' | 'alert';
  platform: string;             // 'x' | 'discord' | 'telegram'
  content: string;              // text to post/send
  metadata?: Record<string, unknown>;
}

export interface Adapter {
  platform: string;
  execute(action: AdapterAction): Promise<void>;
}

export interface AdapterRegistry {
  register(adapter: Adapter): void;
  executeAll(actions: AdapterAction[]): Promise<void>;  // fire-and-forget per adapter
}
```

### Registry pattern

```typescript
export class DefaultAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter) { this.adapters.set(adapter.platform, adapter); }

  async executeAll(actions: AdapterAction[]) {
    for (const action of actions) {
      const adapter = this.adapters.get(action.platform);
      if (!adapter) continue;
      // ADAPTER-01: fire-and-forget, catch errors
      void adapter.execute(action).catch(err => {
        console.warn(`Adapter ${action.platform} failed (non-blocking)`, err);
      });
    }
  }
}
```

### 決策 → 動作映射

```typescript
export function chiefResultToActions(
  result: ChiefCycleResult,
  marketState: MarketState,
): AdapterAction[]
```

Chiefs 的 apply 結果轉成 platform actions：
- stall ranking changed → X: post spotlight
- new event → Discord: notify
- limit applied → Discord: alert
- rollback → X: update

---

## 驗收
```bash
bun run build && bun run lint && bun test src/adapters/
```
