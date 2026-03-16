/**
 * alert.ts -- Alert system Zod schemas (#236)
 *
 * 6 alert types: budget_warning, chief_timeout, consecutive_rollbacks,
 * high_risk_proposal, health_drop, anomaly.
 *
 * Severity escalation: info < warning < critical < emergency.
 * Status lifecycle: active -> acknowledged -> resolved / auto_resolved / expired.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const AlertTypeEnum = z.enum([
  'budget_warning',
  'chief_timeout',
  'consecutive_rollbacks',
  'high_risk_proposal',
  'health_drop',
  'anomaly',
]);
export type AlertType = z.infer<typeof AlertTypeEnum>;

export const AlertSeverityEnum = z.enum(['info', 'warning', 'critical', 'emergency']);
export type AlertSeverity = z.infer<typeof AlertSeverityEnum>;

export const AlertStatusEnum = z.enum([
  'active',
  'acknowledged',
  'resolved',
  'auto_resolved',
  'expired',
]);
export type AlertStatus = z.infer<typeof AlertStatusEnum>;

// ---------------------------------------------------------------------------
// Alert schema
// ---------------------------------------------------------------------------

export const AlertSchema = z.object({
  id: z.string(),
  village_id: z.string(),
  type: AlertTypeEnum,
  severity: AlertSeverityEnum,
  status: AlertStatusEnum,
  title: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).default({}),
  occurrence_count: z.number().int().min(1).default(1),
  acknowledged_by: z.string().nullable().default(null),
  acknowledged_at: z.string().nullable().default(null),
  resolved_at: z.string().nullable().default(null),
  auto_action_taken: z.string().nullable().default(null),
  version: z.number().int().default(1),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Alert = z.infer<typeof AlertSchema>;

// ---------------------------------------------------------------------------
// Input schemas (for routes)
// ---------------------------------------------------------------------------

export const AcknowledgeAlertInput = z.object({
  actor: z.string().min(1),
});
export type AcknowledgeAlertInput = z.infer<typeof AcknowledgeAlertInput>;

export const ResolveAlertInput = z.object({
  actor: z.string().min(1),
  resolution_note: z.string().optional(),
});
export type ResolveAlertInput = z.infer<typeof ResolveAlertInput>;

export const ListAlertsQuery = z.object({
  status: AlertStatusEnum.optional(),
  type: AlertTypeEnum.optional(),
  severity: AlertSeverityEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAlertsQuery = z.infer<typeof ListAlertsQuery>;

// ---------------------------------------------------------------------------
// Webhook schemas
// ---------------------------------------------------------------------------

export const CreateWebhookInput = z.object({
  url: z.string().url(),
  events: z.array(AlertTypeEnum).default([]),
  secret: z.string().optional(),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInput>;

export const AlertWebhookSchema = z.object({
  id: z.string(),
  village_id: z.string(),
  url: z.string().url(),
  events: z.array(AlertTypeEnum).default([]),
  status: z.enum(['active', 'disabled']).default('active'),
  last_delivery_at: z.string().nullable().default(null),
  last_delivery_status: z.string().nullable().default(null),
  version: z.number().int().default(1),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AlertWebhook = z.infer<typeof AlertWebhookSchema>;
