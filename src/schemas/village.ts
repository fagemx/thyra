import { z } from 'zod';

export const CreateVillageInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  target_repo: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateVillageInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  target_repo: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateVillageInputRaw = z.input<typeof CreateVillageInput>;
export type CreateVillageInput = z.infer<typeof CreateVillageInput>;
export type UpdateVillageInput = z.infer<typeof UpdateVillageInput>;
