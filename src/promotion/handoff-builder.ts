import { z } from 'zod';
import { generateId } from '../cross-layer';
import { PromotionHandoffSchema } from './schemas/handoff';
import type { PromotionHandoff } from './schemas/handoff';

export type BuildHandoffInput = Omit<z.infer<typeof PromotionHandoffSchema>, 'id' | 'createdAt' | 'version'>;

export function buildPromotionHandoff(input: BuildHandoffInput): PromotionHandoff {
  const id = generateId('handoff');
  const createdAt = new Date().toISOString();
  return PromotionHandoffSchema.parse({ id, ...input, createdAt });
}
