/**
 * LLM Provider Configuration — preset-based model resolution
 *
 * Phase 1: 3 presets (economy/balanced/performance), Anthropic only.
 * Preset 定義寫死在 code，YAML 只選 preset 名稱。
 * API key 在環境變數，不存 DB。
 */
import { z } from 'zod';

// ── Constants ─────────────────────────────────────────────────

export const LLM_USAGE_SLOTS = ['chief_decision', 'pipeline_execute', 'conversation'] as const;
export type LlmUsageSlot = typeof LLM_USAGE_SLOTS[number];

export const LLM_PRESETS = {
  economy: {
    chief_decision: 'claude-haiku-4-5',
    pipeline_execute: 'claude-haiku-4-5',
    conversation: 'claude-haiku-4-5',
  },
  balanced: {
    chief_decision: 'claude-haiku-4-5',
    pipeline_execute: 'claude-sonnet-4-5',
    conversation: 'claude-sonnet-4-5',
  },
  performance: {
    chief_decision: 'claude-sonnet-4-5',
    pipeline_execute: 'claude-sonnet-4-5',
    conversation: 'claude-sonnet-4-5',
  },
} as const;

// ── Schemas ───────────────────────────────────────────────────

export const LlmProviderEnum = z.enum(['anthropic']);
export const LlmPresetEnum = z.enum(['economy', 'balanced', 'performance']);

/** YAML 中的 llm section（declared 形式） */
export const VillagePackLlmSchema = z.object({
  provider: LlmProviderEnum,
  preset: LlmPresetEnum.default('balanced'),
});

/** 儲存在 village metadata 的 resolved 形式 */
export const ResolvedLlmConfigSchema = z.object({
  provider: LlmProviderEnum,
  preset: LlmPresetEnum,
  models: z.object({
    chief_decision: z.string(),
    pipeline_execute: z.string(),
    conversation: z.string(),
  }),
  resolved_at: z.string(),
});

// ── Types ─────────────────────────────────────────────────────

export type LlmProvider = z.infer<typeof LlmProviderEnum>;
export type LlmPreset = z.infer<typeof LlmPresetEnum>;
export type VillagePackLlm = z.infer<typeof VillagePackLlmSchema>;
export type ResolvedLlmConfig = z.infer<typeof ResolvedLlmConfigSchema>;

// ── Resolver ──────────────────────────────────────────────────

/**
 * 將 declared config (provider + preset) 展開為 resolved config (含具體 model IDs)。
 */
export function resolvePreset(provider: LlmProvider, preset: LlmPreset): ResolvedLlmConfig {
  const models = LLM_PRESETS[preset];
  return {
    provider,
    preset,
    models: { ...models },
    resolved_at: new Date().toISOString(),
  };
}
