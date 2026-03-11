import { z } from 'zod';

export const SkillDefinitionInput = z.object({
  description: z.string().min(1),
  prompt_template: z.string().min(1),
  tools_required: z.array(z.string()).default([]),
  input_schema: z.record(z.unknown()).optional(),
  output_schema: z.record(z.unknown()).optional(),
  constraints: z.array(z.string()).default([]),
  examples: z.array(z.object({
    input: z.string(),
    expected_output: z.string(),
    explanation: z.string().optional(),
  })).default([]),
});

export const CreateSkillInput = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  village_id: z.string().optional(),
  definition: SkillDefinitionInput,
});

export const UpdateSkillInput = z.object({
  definition: SkillDefinitionInput.partial().optional(),
});

export type SkillDefinition = z.infer<typeof SkillDefinitionInput>;
export type CreateSkillInputRaw = z.input<typeof CreateSkillInput>;
export type CreateSkillInput = z.infer<typeof CreateSkillInput>;
export type UpdateSkillInput = z.infer<typeof UpdateSkillInput>;

export interface SkillBinding {
  skill_id: string;
  skill_version: number;
  config?: Record<string, unknown>;
}
