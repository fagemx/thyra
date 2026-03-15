import { z } from 'zod';
import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { DecideContext, ActionIntent } from './decision-engine';

// ---------------------------------------------------------------------------
// LLM 客戶端介面 — 外部注入的 LLM 呼叫能力
// ---------------------------------------------------------------------------

/** LLM 完成介面 — 使用者實作此介面以連接任意 LLM */
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Zod schemas — 驗證 LLM 回傳的 JSON 結構
// ---------------------------------------------------------------------------

/** LLM 對候選 action 的評分 */
export const AdvisorCandidateScoreSchema = z.object({
  index: z.number().int().min(0),
  score: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type AdvisorCandidateScore = z.infer<typeof AdvisorCandidateScoreSchema>;

/** LLM advisor 的選擇結果 */
export const AdvisorSelectionSchema = z.object({
  selected_index: z.number().int().min(-1),  // -1 表示保持原選擇
  scores: z.array(AdvisorCandidateScoreSchema),
  overall_reasoning: z.string(),
});
export type AdvisorSelection = z.infer<typeof AdvisorSelectionSchema>;

/** LLM 建議的 law proposal */
export const LawProposalSuggestionSchema = z.object({
  category: z.string(),
  description: z.string(),
  strategy: z.record(z.unknown()),
  reasoning: z.string(),
  trigger: z.string(),
});
export type LawProposalSuggestion = z.infer<typeof LawProposalSuggestionSchema>;

/** LLM 建議的 law proposals 列表 */
export const LawProposalSuggestionsSchema = z.object({
  suggestions: z.array(LawProposalSuggestionSchema),
});

/** LLM 推理增強結果 */
export const ReasoningEnrichmentSchema = z.object({
  enriched_summary: z.string(),
  additional_factors: z.array(z.string()),
  confidence_adjustment: z.number().min(-0.5).max(0.5),
});
export type ReasoningEnrichment = z.infer<typeof ReasoningEnrichmentSchema>;

// ---------------------------------------------------------------------------
// AdvisorResult — advise() 的回傳值
// ---------------------------------------------------------------------------

export interface AdvisorResult {
  /** 重新排序後的最佳候選 index（-1 = 保持原選擇） */
  selected_index: number;
  /** 各候選的 LLM 評分 */
  scores: AdvisorCandidateScore[];
  /** LLM 給出的整體推理說明 */
  overall_reasoning: string;
}

// ---------------------------------------------------------------------------
// LlmAdvisor 介面 — 可選的 LLM 顧問
// ---------------------------------------------------------------------------

export interface LlmAdvisor {
  /** 對候選 actions 進行重新評估和排序 */
  advise(context: DecideContext, candidates: ActionIntent[]): Promise<AdvisorResult>;

  /** 為選定的 action（或 null）產生推理增強 */
  generateReasoning(context: DecideContext, selected: ActionIntent | null): Promise<ReasoningEnrichment>;

  /** 根據上下文建議新的 law proposals */
  suggestLawProposals(context: DecideContext): Promise<LawProposalSuggestion[]>;
}

// ---------------------------------------------------------------------------
// 預設實作 — 使用 LlmClient + Zod 驗證
// ---------------------------------------------------------------------------

/**
 * DefaultLlmAdvisor — 使用注入的 LlmClient 呼叫 LLM，
 * 並用 Zod schema 驗證 LLM 回傳的 JSON。
 *
 * 所有 LLM 呼叫都在 try/catch 內，失敗時回傳安全的 fallback 值。
 */
export class DefaultLlmAdvisor implements LlmAdvisor {
  constructor(
    private client: LlmClient,
    private db: Database,
  ) {}

  async advise(context: DecideContext, candidates: ActionIntent[]): Promise<AdvisorResult> {
    if (candidates.length === 0) {
      return { selected_index: -1, scores: [], overall_reasoning: 'No candidates to evaluate' };
    }

    const prompt = this.buildAdvisePrompt(context, candidates);

    try {
      const raw = await this.client.complete(prompt);
      const parsed = this.parseJson(raw);
      const result = AdvisorSelectionSchema.safeParse(parsed);

      if (!result.success) {
        this.logFallback('advise', 'zod_validation_failed', result.error.message);
        return this.fallbackAdvisorResult(candidates);
      }

      return {
        selected_index: result.data.selected_index,
        scores: result.data.scores,
        overall_reasoning: result.data.overall_reasoning,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logFallback('advise', 'llm_error', msg);
      return this.fallbackAdvisorResult(candidates);
    }
  }

  async generateReasoning(context: DecideContext, selected: ActionIntent | null): Promise<ReasoningEnrichment> {
    const prompt = this.buildReasoningPrompt(context, selected);

    try {
      const raw = await this.client.complete(prompt);
      const parsed = this.parseJson(raw);
      const result = ReasoningEnrichmentSchema.safeParse(parsed);

      if (!result.success) {
        this.logFallback('generateReasoning', 'zod_validation_failed', result.error.message);
        return this.fallbackReasoning();
      }

      return result.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logFallback('generateReasoning', 'llm_error', msg);
      return this.fallbackReasoning();
    }
  }

  async suggestLawProposals(context: DecideContext): Promise<LawProposalSuggestion[]> {
    const prompt = this.buildLawProposalPrompt(context);

    try {
      const raw = await this.client.complete(prompt);
      const parsed = this.parseJson(raw);
      const result = LawProposalSuggestionsSchema.safeParse(parsed);

      if (!result.success) {
        this.logFallback('suggestLawProposals', 'zod_validation_failed', result.error.message);
        return [];
      }

      return result.data.suggestions;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logFallback('suggestLawProposals', 'llm_error', msg);
      return [];
    }
  }

  // --- 內部方法 ---

  /** 從 LLM 回傳文字中提取 JSON */
  private parseJson(raw: string): unknown {
    // 嘗試直接 parse
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // 嘗試提取 ```json ... ``` 區塊
      const match = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (match) {
        return JSON.parse(match[1]);
      }
      throw new Error('Cannot parse LLM output as JSON');
    }
  }

  /** 建立 advise prompt */
  private buildAdvisePrompt(context: DecideContext, candidates: ActionIntent[]): string {
    const candidateList = candidates.map((c, i) =>
      `[${i}] kind=${c.kind}, task_key=${c.task_key ?? 'none'}, cost=${c.estimated_cost}, confidence=${c.confidence}, reason="${c.reason}"`,
    ).join('\n');

    return `You are a governance advisor for an AI agent village.

Context:
- Village: ${context.village_id}
- Cycle: ${context.cycle_id}, iteration ${context.iteration}/${context.max_iterations}
- Budget: ${Math.round(context.budget_ratio * 100)}% remaining
- Chief: ${context.chief.name} (${context.chief.role})
- Active laws: ${context.active_laws.length}
- Observations: ${context.observations.length}
- Precedents: ${context.edda_precedents.length}

Candidates:
${candidateList}

Evaluate each candidate and return JSON:
{
  "selected_index": <best candidate index, or -1 to keep rule-based selection>,
  "scores": [{"index": 0, "score": 0.0-1.0, "reasoning": "..."}],
  "overall_reasoning": "..."
}`;
  }

  /** 建立 reasoning enrichment prompt */
  private buildReasoningPrompt(context: DecideContext, selected: ActionIntent | null): string {
    const actionDesc = selected
      ? `${selected.kind}${selected.task_key ? `(${selected.task_key})` : ''}: ${selected.reason}`
      : 'No action selected (cycle idle)';

    return `You are a governance advisor. Enrich the reasoning for this decision.

Context:
- Village: ${context.village_id}
- Budget: ${Math.round(context.budget_ratio * 100)}% remaining
- Chief: ${context.chief.name}
- Active laws: ${context.active_laws.length}
- Precedents: ${context.edda_precedents.map(p => `${p.key}: ${p.value}`).join('; ')}

Selected action: ${actionDesc}

Return JSON:
{
  "enriched_summary": "...",
  "additional_factors": ["..."],
  "confidence_adjustment": <-0.5 to 0.5>
}`;
  }

  /** 建立 law proposal suggestion prompt */
  private buildLawProposalPrompt(context: DecideContext): string {
    return `You are a governance advisor. Suggest law proposals based on current context.

Context:
- Village: ${context.village_id}
- Budget: ${Math.round(context.budget_ratio * 100)}% remaining
- Active laws: ${context.active_laws.map(l => `${l.category}: ${l.content.description}`).join('; ')}
- Recent rollbacks: ${context.recent_rollbacks}
- Blocked count: ${context.blocked_count}
- Observations: ${context.observations.length}

Return JSON:
{
  "suggestions": [
    {
      "category": "...",
      "description": "...",
      "strategy": {},
      "reasoning": "...",
      "trigger": "..."
    }
  ]
}
Return empty suggestions array if no proposals needed.`;
  }

  /** 記錄 fallback 事件到 audit_log */
  private logFallback(method: string, reason: string, detail: string): void {
    appendAudit(this.db, 'llm_advisor', method, 'fallback', {
      reason,
      detail: detail.slice(0, 500),
    }, 'system');
  }

  /** advise fallback — 保持原選擇 */
  private fallbackAdvisorResult(candidates: ActionIntent[]): AdvisorResult {
    return {
      selected_index: -1,
      scores: candidates.map((_, i) => ({
        index: i,
        score: 0.5,
        reasoning: 'LLM unavailable, using rule-based fallback',
      })),
      overall_reasoning: 'LLM advisor unavailable, falling back to rule-based selection',
    };
  }

  /** reasoning fallback — 無額外調整 */
  private fallbackReasoning(): ReasoningEnrichment {
    return {
      enriched_summary: '',
      additional_factors: [],
      confidence_adjustment: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 測試用 mock 工廠
// ---------------------------------------------------------------------------

/**
 * 建立 mock LlmAdvisor 用於測試。
 * 可預設各方法的回應。
 */
export function createMockLlmAdvisor(opts: {
  adviseResult?: AdvisorResult;
  reasoningResult?: ReasoningEnrichment;
  lawSuggestions?: LawProposalSuggestion[];
} = {}): LlmAdvisor {
  return {
    advise: (_context: DecideContext, candidates: ActionIntent[]) => {
      return Promise.resolve(opts.adviseResult ?? {
        selected_index: -1,
        scores: candidates.map((_, i) => ({
          index: i,
          score: 0.5,
          reasoning: 'mock score',
        })),
        overall_reasoning: 'mock reasoning',
      });
    },
    generateReasoning: () => {
      return Promise.resolve(opts.reasoningResult ?? {
        enriched_summary: 'mock enriched summary',
        additional_factors: ['mock factor'],
        confidence_adjustment: 0,
      });
    },
    suggestLawProposals: () => {
      return Promise.resolve(opts.lawSuggestions ?? []);
    },
  };
}

/**
 * 建立 mock LlmClient 用於測試。
 * responses map: method prompt 的子字串 → 回傳的 JSON 字串。
 */
export function createMockLlmClient(responses: Record<string, string>): LlmClient {
  return {
    complete: (prompt: string) => {
      for (const [key, value] of Object.entries(responses)) {
        if (prompt.includes(key)) return Promise.resolve(value);
      }
      return Promise.reject(new Error('No mock response for prompt'));
    },
  };
}
