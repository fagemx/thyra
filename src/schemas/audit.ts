import { z } from 'zod';

/**
 * 通用 audit_log 查詢參數
 */
export const AuditQueryInput = z.object({
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  action: z.string().optional(),
  actor: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Village 維度 audit 查詢參數（不含 entity_type / entity_id）
 */
export const VillageAuditQueryInput = z.object({
  action: z.string().optional(),
  actor: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AuditQueryInput = z.infer<typeof AuditQueryInput>;
export type VillageAuditQueryInput = z.infer<typeof VillageAuditQueryInput>;
