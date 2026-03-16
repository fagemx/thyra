/**
 * discord-adapter.ts — Discord webhook adapter。
 *
 * POST content 到 Discord webhook URL。
 * 超過 2000 字元自動截斷並加 [truncated] 標記。
 *
 * ADAPTER-01: 失敗時 throw，由 registry 攔截。
 * ADAPTER-02: 只讀，不寫 world state。
 */
import type { AdapterAction } from '../schemas/adapter';
import type { Adapter } from './interface';

const DISCORD_CONTENT_LIMIT = 2000;
const TRUNCATION_SUFFIX = '... [truncated]';

export class DiscordAdapter implements Adapter {
  readonly platform = 'discord' as const;

  constructor(private webhookUrl: string) {}

  async execute(action: AdapterAction): Promise<void> {
    let content = action.content;
    if (content.length > DISCORD_CONTENT_LIMIT) {
      content = content.slice(0, DISCORD_CONTENT_LIMIT - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
    }

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`Discord webhook failed: ${res.status} ${body}`);
    }
  }
}
