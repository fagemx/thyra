# F2: X Adapter + Discord Adapter (MVP)

> **Layer**: L1
> **Dependencies**: F1（Adapter interface）
> **Blocks**: 無
> **Output**: `src/adapters/x-adapter.ts` + `src/adapters/discord-adapter.ts`

---

## X Adapter

```typescript
export class XAdapter implements Adapter {
  platform = 'x';
  constructor(private apiKey: string, private apiSecret: string) {}

  async execute(action: AdapterAction): Promise<void> {
    // MVP: just log (don't actually call X API yet)
    // Phase 2: use X API v2 to post tweets
    console.log(`[X] ${action.type}: ${action.content}`);
  }
}
```

MVP 第一版先 log-only。真正接 X API 是 Phase 2。

## Discord Adapter

```typescript
export class DiscordAdapter implements Adapter {
  platform = 'discord';
  constructor(private webhookUrl: string) {}

  async execute(action: AdapterAction): Promise<void> {
    // MVP: Discord webhook is easiest to integrate
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: action.content }),
    });
  }
}
```

Discord webhook 最簡單，MVP 直接接。

### Tests

- X adapter: log output contains correct content
- Discord adapter: mock fetch + verify payload
- Both: throw on execute → registry catches（ADAPTER-01）

---

## 驗收
```bash
bun run build && bun run lint && bun test src/adapters/
```
