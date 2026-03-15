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

export const SetBoardMappingInput = z.object({
  board_namespace: z.string().min(1).max(200),
  karvi_url: z.string().url().optional(),
});

export type CreateVillageInputRaw = z.input<typeof CreateVillageInput>;
export type CreateVillageInput = z.infer<typeof CreateVillageInput>;
export type UpdateVillageInput = z.infer<typeof UpdateVillageInput>;
export type SetBoardMappingInput = z.infer<typeof SetBoardMappingInput>;
