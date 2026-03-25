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

/** DB row schema — villages table */
export const VillageRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  target_repo: z.string(),
  status: z.enum(['active', 'paused', 'archived']),
  metadata: z.string(), // JSON string, parsed after validation
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

/** DB row schema — board_mappings table */
export const BoardMappingRow = z.object({
  id: z.string(),
  village_id: z.string(),
  board_namespace: z.string(),
  karvi_url: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type CreateVillageInputRaw = z.input<typeof CreateVillageInput>;
export type CreateVillageInput = z.infer<typeof CreateVillageInput>;
export type UpdateVillageInput = z.infer<typeof UpdateVillageInput>;
export type SetBoardMappingInput = z.infer<typeof SetBoardMappingInput>;
