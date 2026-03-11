import { z } from 'zod';

export const StartCycleInput = z.object({
  chief_id: z.string().min(1),
  trigger: z.enum(['scheduled', 'event', 'manual']).default('manual'),
  timeout_ms: z.number().int().min(1000).max(600_000).default(300_000), // 5 min default (THY-08)
  max_iterations: z.number().int().min(1).max(100).default(10),
});

export type StartCycleInputRaw = z.input<typeof StartCycleInput>;
export type StartCycleInput = z.infer<typeof StartCycleInput>;

export const LoopActionStatus = z.enum(['executed', 'pending_approval', 'blocked']);

export interface LoopAction {
  type: string;
  description: string;
  estimated_cost: number;
  risk_level: 'low' | 'medium' | 'high';
  status: z.infer<typeof LoopActionStatus>;
  reason: string;
  result?: unknown;
  blocked_reasons?: string[];
}
