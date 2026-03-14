import { z } from 'zod';
import { PermissionEnum } from './constitution';

const SkillBindingInput = z.object({
  skill_id: z.string(),
  skill_version: z.number().int().positive(),
  config: z.record(z.unknown()).optional(),
});

export const ChiefPersonalityInput = z.object({
  risk_tolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  communication_style: z.enum(['concise', 'detailed', 'minimal']).default('concise'),
  decision_speed: z.enum(['fast', 'deliberate', 'cautious']).default('deliberate'),
});

const ChiefConstraintInput = z.object({
  type: z.enum(['must', 'must_not', 'prefer', 'avoid']),
  description: z.string().min(1),
});

export const CreateChiefInput = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(500),
  skills: z.array(SkillBindingInput).default([]),
  permissions: z.array(PermissionEnum).default([]),
  personality: ChiefPersonalityInput.default({}),
  constraints: z.array(ChiefConstraintInput).default([]),
});

export const UpdateChiefInput = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().min(1).max(500).optional(),
  skills: z.array(SkillBindingInput).optional(),
  permissions: z.array(PermissionEnum).optional(),
  personality: ChiefPersonalityInput.optional(),
  constraints: z.array(ChiefConstraintInput).optional(),
});

export type ChiefPersonality = z.infer<typeof ChiefPersonalityInput>;
export type CreateChiefInputRaw = z.input<typeof CreateChiefInput>;
export type CreateChiefInput = z.infer<typeof CreateChiefInput>;
export type UpdateChiefInput = z.infer<typeof UpdateChiefInput>;
