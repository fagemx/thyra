import { z } from 'zod';

export const LayerSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
export type Layer = z.infer<typeof LayerSchema>;

export const SourceRefSchema = z.object({
  layer: LayerSchema,
  kind: z.string(),      // e.g. "decision-session", "spec-file", "world"
  id: z.string(),        // e.g. "ds_abc123", "spec://thyra/..."
  note: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
