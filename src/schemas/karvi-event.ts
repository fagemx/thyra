import { z } from 'zod';

// --- Receive layer: match Karvi step-worker.js actual output ---
export const KarviWebhookPayloadSchema = z.object({
  version: z.literal('karvi.event.v1'),
  event_id: z.string().startsWith('evt_'),
  event_type: z.string(),
  occurred_at: z.string(),
  // backward compat fields from Karvi
  event: z.string().optional(),
  ts: z.string().optional(),
  // spread payload fields (camelCase from Karvi)
  taskId: z.string(),
  stepId: z.string(),
  stepType: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

export type KarviWebhookPayload = z.infer<typeof KarviWebhookPayloadSchema>;

// --- Internal normalized format ---
export interface KarviEventNormalized {
  event_id: string;
  event_type: string;
  task_id: string;
  step_id: string;
  occurred_at: string;
  step_type?: string;
  state?: string;
  error?: string;
  raw: Record<string, unknown>;
}

// --- Transform raw Karvi webhook payload to normalized internal format ---
export function normalizeKarviEvent(raw: KarviWebhookPayload): KarviEventNormalized {
  return {
    event_id: raw.event_id,
    event_type: raw.event_type,
    task_id: raw.taskId,
    step_id: raw.stepId,
    occurred_at: raw.occurred_at,
    step_type: raw.stepType,
    state: raw.state,
    error: raw.error,
    raw: raw as unknown as Record<string, unknown>,
  };
}
