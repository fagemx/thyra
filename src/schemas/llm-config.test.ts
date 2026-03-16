import { describe, it, expect } from 'vitest';
import {
  VillagePackLlmSchema,
  ResolvedLlmConfigSchema,
  LlmPresetEnum,
  LlmProviderEnum,
  LLM_PRESETS,
  resolvePreset,
} from './llm-config';

describe('LLM Config Schema', () => {
  // ── VillagePackLlmSchema (declared form) ──────────────────

  it('accepts valid provider + preset', () => {
    const result = VillagePackLlmSchema.safeParse({ provider: 'anthropic', preset: 'balanced' });
    expect(result.success).toBe(true);
  });

  it('accepts economy preset', () => {
    const result = VillagePackLlmSchema.safeParse({ provider: 'anthropic', preset: 'economy' });
    expect(result.success).toBe(true);
  });

  it('accepts performance preset', () => {
    const result = VillagePackLlmSchema.safeParse({ provider: 'anthropic', preset: 'performance' });
    expect(result.success).toBe(true);
  });

  it('defaults preset to balanced when omitted', () => {
    const result = VillagePackLlmSchema.safeParse({ provider: 'anthropic' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preset).toBe('balanced');
    }
  });

  it('rejects invalid provider', () => {
    const result = VillagePackLlmSchema.safeParse({ provider: 'openai', preset: 'balanced' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid preset', () => {
    const result = VillagePackLlmSchema.safeParse({ provider: 'anthropic', preset: 'turbo' });
    expect(result.success).toBe(false);
  });

  it('rejects missing provider', () => {
    const result = VillagePackLlmSchema.safeParse({ preset: 'balanced' });
    expect(result.success).toBe(false);
  });

  // ── LlmPresetEnum / LlmProviderEnum ──────────────────────

  it('LlmPresetEnum accepts all 3 presets', () => {
    for (const preset of ['economy', 'balanced', 'performance']) {
      expect(LlmPresetEnum.safeParse(preset).success).toBe(true);
    }
  });

  it('LlmProviderEnum accepts anthropic only', () => {
    expect(LlmProviderEnum.safeParse('anthropic').success).toBe(true);
    expect(LlmProviderEnum.safeParse('openai').success).toBe(false);
  });

  // ── resolvePreset ─────────────────────────────────────────

  it('resolves economy preset to all haiku', () => {
    const resolved = resolvePreset('anthropic', 'economy');
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.preset).toBe('economy');
    expect(resolved.models.chief_decision).toBe('claude-haiku-4-5');
    expect(resolved.models.pipeline_execute).toBe('claude-haiku-4-5');
    expect(resolved.models.conversation).toBe('claude-haiku-4-5');
    expect(resolved.resolved_at).toBeTruthy();
  });

  it('resolves balanced preset to haiku + sonnet mix', () => {
    const resolved = resolvePreset('anthropic', 'balanced');
    expect(resolved.models.chief_decision).toBe('claude-haiku-4-5');
    expect(resolved.models.pipeline_execute).toBe('claude-sonnet-4-5');
    expect(resolved.models.conversation).toBe('claude-sonnet-4-5');
  });

  it('resolves performance preset to all sonnet', () => {
    const resolved = resolvePreset('anthropic', 'performance');
    expect(resolved.models.chief_decision).toBe('claude-sonnet-4-5');
    expect(resolved.models.pipeline_execute).toBe('claude-sonnet-4-5');
    expect(resolved.models.conversation).toBe('claude-sonnet-4-5');
  });

  it('resolvePreset result passes ResolvedLlmConfigSchema validation', () => {
    for (const preset of ['economy', 'balanced', 'performance'] as const) {
      const resolved = resolvePreset('anthropic', preset);
      const result = ResolvedLlmConfigSchema.safeParse(resolved);
      expect(result.success).toBe(true);
    }
  });

  // ── LLM_PRESETS constant ──────────────────────────────────

  it('LLM_PRESETS covers all 3 presets with all 3 slots', () => {
    const presets = Object.keys(LLM_PRESETS);
    expect(presets).toEqual(['economy', 'balanced', 'performance']);
    for (const preset of presets) {
      const models = LLM_PRESETS[preset as keyof typeof LLM_PRESETS];
      expect(models).toHaveProperty('chief_decision');
      expect(models).toHaveProperty('pipeline_execute');
      expect(models).toHaveProperty('conversation');
    }
  });

  // ── ResolvedLlmConfigSchema ───────────────────────────────

  it('ResolvedLlmConfigSchema rejects missing models', () => {
    const result = ResolvedLlmConfigSchema.safeParse({
      provider: 'anthropic',
      preset: 'balanced',
      resolved_at: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('ResolvedLlmConfigSchema rejects missing resolved_at', () => {
    const result = ResolvedLlmConfigSchema.safeParse({
      provider: 'anthropic',
      preset: 'balanced',
      models: { chief_decision: 'a', pipeline_execute: 'b', conversation: 'c' },
    });
    expect(result.success).toBe(false);
  });
});
