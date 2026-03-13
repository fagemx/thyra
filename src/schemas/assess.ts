import { z } from 'zod';
import { PermissionEnum } from './constitution';

export const AssessActionInput = z.object({
  type: z.string().min(1),
  description: z.string().min(1),
  initiated_by: z.string().min(1),
  village_id: z.string().min(1),
  estimated_cost: z.number().min(0),
  reason: z.string().min(1),
  rollback_plan: z.string().optional(),
  grants_permission: z.array(PermissionEnum).optional(),
  cross_village: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type AssessActionInput = z.infer<typeof AssessActionInput>;
