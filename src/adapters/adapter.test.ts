import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { AdapterActionSchema } from '../schemas/adapter';
import type { AdapterAction } from '../schemas/adapter';
import { DefaultAdapterRegistry } from './registry';
import { chiefResultToActions } from './interface';
import type { Adapter, ChiefCycleResult } from './interface';
import { XAdapter } from './x-adapter';
import { DiscordAdapter } from './discord-adapter';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockAdapter(platform: string, fn?: (action: AdapterAction) => Promise<void>): Adapter {
  return {
    platform,
    execute: fn ?? (async () => {}),
  };
}

function createFailingAdapter(platform: string, error: string): Adapter {
  return {
    platform,
    execute: async () => { throw new Error(error); },
  };
}

function setupDb() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);
  return db;
}

// ---------------------------------------------------------------------------
// Schema Tests
// ---------------------------------------------------------------------------

describe('AdapterActionSchema', () => {
  it('validates correct input', () => {
    const result = AdapterActionSchema.safeParse({
      type: 'post',
      platform: 'x',
      content: 'Hello world',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = AdapterActionSchema.safeParse({
      type: 'post',
      platform: 'x',
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = AdapterActionSchema.safeParse({
      type: 'invalid',
      platform: 'x',
      content: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional metadata', () => {
    const result = AdapterActionSchema.safeParse({
      type: 'notify',
      platform: 'discord',
      content: 'notification',
      metadata: { channel: '#general', priority: 1 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({ channel: '#general', priority: 1 });
    }
  });

  it('rejects empty platform', () => {
    const result = AdapterActionSchema.safeParse({
      type: 'post',
      platform: '',
      content: 'test',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registry Tests
// ---------------------------------------------------------------------------

describe('DefaultAdapterRegistry', () => {
  let registry: DefaultAdapterRegistry;

  beforeEach(() => {
    registry = new DefaultAdapterRegistry();
  });

  it('register() adds adapter, has() returns true', () => {
    const adapter = createMockAdapter('x');
    registry.register(adapter);
    expect(registry.has('x')).toBe(true);
    expect(registry.has('discord')).toBe(false);
  });

  it('getRegisteredPlatforms() lists all registered', () => {
    registry.register(createMockAdapter('x'));
    registry.register(createMockAdapter('discord'));
    const platforms = registry.getRegisteredPlatforms();
    expect(platforms).toContain('x');
    expect(platforms).toContain('discord');
    expect(platforms).toHaveLength(2);
  });

  it('executeAll() dispatches to correct adapter by platform', async () => {
    const calls: string[] = [];
    registry.register(createMockAdapter('x', async (action) => {
      calls.push(`x:${action.content}`);
    }));
    registry.register(createMockAdapter('discord', async (action) => {
      calls.push(`discord:${action.content}`);
    }));

    const actions: AdapterAction[] = [
      { type: 'post', platform: 'x', content: 'tweet' },
      { type: 'notify', platform: 'discord', content: 'alert' },
    ];

    await registry.executeAll(actions);
    expect(calls).toEqual(['x:tweet', 'discord:alert']);
  });

  it('executeAll() skips actions for unregistered platforms', async () => {
    registry.register(createMockAdapter('x'));
    const report = await registry.executeAll([
      { type: 'post', platform: 'x', content: 'ok' },
      { type: 'notify', platform: 'slack', content: 'no adapter' },
    ]);
    expect(report.dispatched).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it('executeAll() catches adapter failure, continues to next (ADAPTER-01)', async () => {
    registry.register(createFailingAdapter('x', 'API down'));
    registry.register(createMockAdapter('discord'));

    // Suppress expected console.error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = await registry.executeAll([
      { type: 'post', platform: 'x', content: 'fail' },
      { type: 'notify', platform: 'discord', content: 'ok' },
    ]);

    expect(report.failed).toEqual(['x']);
    expect(report.dispatched).toBe(1);
    spy.mockRestore();
  });

  it('executeAll() returns correct report counts', async () => {
    registry.register(createMockAdapter('x'));
    registry.register(createFailingAdapter('discord', 'fail'));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = await registry.executeAll([
      { type: 'post', platform: 'x', content: 'ok' },
      { type: 'notify', platform: 'discord', content: 'fail' },
      { type: 'alert', platform: 'slack', content: 'skip' },
    ]);

    expect(report.total).toBe(3);
    expect(report.dispatched).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.failed).toEqual(['discord']);
    spy.mockRestore();
  });

  it('executeAll() with empty actions returns zero report', async () => {
    const report = await registry.executeAll([]);
    expect(report.total).toBe(0);
    expect(report.dispatched).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.failed).toEqual([]);
  });

  it('register() warns on duplicate platform override', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.register(createMockAdapter('x'));
    registry.register(createMockAdapter('x'));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// chiefResultToActions Tests
// ---------------------------------------------------------------------------

describe('chiefResultToActions', () => {
  it('returns empty array when result.applied is false', () => {
    const result: ChiefCycleResult = {
      applied: false,
      change_type: 'price_adjustment',
      village_id: 'v-1',
      diff: null,
    };
    expect(chiefResultToActions(result)).toEqual([]);
  });

  it('returns notify action when result.applied is true', () => {
    const result: ChiefCycleResult = {
      applied: true,
      change_type: 'spotlight',
      village_id: 'v-1',
      diff: { stall: 'upgraded' },
    };
    const actions = chiefResultToActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('notify');
    expect(actions[0].platform).toBe('discord');
  });

  it('includes change_type in action content', () => {
    const result: ChiefCycleResult = {
      applied: true,
      change_type: 'event_trigger',
      village_id: 'v-2',
      diff: null,
    };
    const actions = chiefResultToActions(result);
    expect(actions[0].content).toContain('event_trigger');
    expect(actions[0].content).toContain('v-2');
  });

  it('includes diff in metadata', () => {
    const diff = { price: 100, item: 'potion' };
    const result: ChiefCycleResult = {
      applied: true,
      change_type: 'update',
      village_id: 'v-1',
      diff,
    };
    const actions = chiefResultToActions(result);
    expect(actions[0].metadata).toEqual({ change_type: 'update', diff });
  });
});

// ---------------------------------------------------------------------------
// Audit Logging Tests
// ---------------------------------------------------------------------------

describe('DefaultAdapterRegistry (with db)', () => {
  it('adapter failure logged to audit_log when db provided', async () => {
    const db = setupDb();
    const registry = new DefaultAdapterRegistry(db);
    registry.register(createFailingAdapter('x', 'rate limited'));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await registry.executeAll([
      { type: 'post', platform: 'x', content: 'test' },
    ]);

    const rows = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'adapter' AND action = 'execute_failed'"
    ).all() as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(rows[0].entity_id).toBe('x');
    const payload = JSON.parse(rows[0].payload as string) as Record<string, unknown>;
    expect(payload.error).toBe('rate limited');
    expect(payload.action_type).toBe('post');

    spy.mockRestore();
  });

  it('no crash when db not provided and adapter fails', async () => {
    const registry = new DefaultAdapterRegistry();
    registry.register(createFailingAdapter('x', 'error'));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = await registry.executeAll([
      { type: 'post', platform: 'x', content: 'test' },
    ]);

    expect(report.failed).toEqual(['x']);
    expect(report.total).toBe(1);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// XAdapter Tests
// ---------------------------------------------------------------------------

describe('XAdapter', () => {
  it('platform is "x"', () => {
    const adapter = new XAdapter();
    expect(adapter.platform).toBe('x');
  });

  it('works without config', () => {
    const adapter = new XAdapter();
    expect(adapter).toBeDefined();
  });

  it('execute() logs content with console.info', async () => {
    const adapter = new XAdapter();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const action: AdapterAction = {
      type: 'post',
      platform: 'x',
      content: "Tonight's spotlight: Dragon's Breath Elixir",
    };
    await adapter.execute(action);

    expect(spy).toHaveBeenCalledTimes(1);
    const logMessage = spy.mock.calls[0][0] as string;
    expect(logMessage).toContain('[XAdapter]');
    expect(logMessage).toContain('post');
    expect(logMessage).toContain("Dragon's Breath Elixir");
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// DiscordAdapter Tests
// ---------------------------------------------------------------------------

describe('DiscordAdapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('platform is "discord"', () => {
    const adapter = new DiscordAdapter('https://discord.com/api/webhooks/test');
    expect(adapter.platform).toBe('discord');
  });

  it('execute() calls fetch with correct URL and payload', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/abc';
    const adapter = new DiscordAdapter(webhookUrl);

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const action: AdapterAction = {
      type: 'notify',
      platform: 'discord',
      content: 'Market opens at midnight!',
    };
    await adapter.execute(action);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Market opens at midnight!' }),
    });
  });

  it('throws on non-ok response (ADAPTER-01)', async () => {
    const adapter = new DiscordAdapter('https://discord.com/api/webhooks/test');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(adapter.execute({
      type: 'notify',
      platform: 'discord',
      content: 'test',
    })).rejects.toThrow('Discord webhook failed: 400 Bad Request');
  });

  it('truncates content over 2000 chars', async () => {
    const adapter = new DiscordAdapter('https://discord.com/api/webhooks/test');
    const longContent = 'A'.repeat(2500);

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await adapter.execute({
      type: 'post',
      platform: 'discord',
      content: longContent,
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { content: string };
    expect(sentBody.content.length).toBeLessThanOrEqual(2000);
    expect(sentBody.content).toContain('... [truncated]');
  });

  it('registry catches DiscordAdapter failure (ADAPTER-01 integration)', async () => {
    const adapter = new DiscordAdapter('https://discord.com/api/webhooks/test');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const registry = new DefaultAdapterRegistry();
    registry.register(adapter);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = await registry.executeAll([
      { type: 'notify', platform: 'discord', content: 'test' },
    ]);

    expect(report.failed).toEqual(['discord']);
    expect(report.dispatched).toBe(0);

    spy.mockRestore();
  });
});
