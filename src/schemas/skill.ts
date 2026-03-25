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

export const SourceTypeEnum = z.enum([
  'system', 'user', 'marketplace', 'team', 'upload', 'fork', 'platform',
]);
export type SourceType = z.infer<typeof SourceTypeEnum>;

export const ScopeTypeEnum = z.enum(['global', 'village', 'personal', 'team']);
export type ScopeType = z.infer<typeof ScopeTypeEnum>;

export const CreateSkillInput = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  village_id: z.string().optional(),
  definition: SkillDefinitionInput,
  content: z.string().optional(),
  source_type: SourceTypeEnum.default('user'),
  source_origin: z.string().optional(),
  forked_from: z.string().optional(),
  scope_type: ScopeTypeEnum.default('global'),
  team_id: z.string().optional(),
  tags: z.array(z.string()).default([]),
}).superRefine((data, ctx) => {
  if (data.scope_type === 'village' && !data.village_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'village_id required when scope_type is village',
      path: ['village_id'],
    });
  }
  if (data.scope_type === 'team' && !data.team_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'team_id required when scope_type is team',
      path: ['team_id'],
    });
  }
});

export const UpdateSkillInput = z.object({
  definition: SkillDefinitionInput.partial().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  scope_type: ScopeTypeEnum.optional(),
  team_id: z.string().nullable().optional(),
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

/** Zod schema for POST /api/skills/upload */
export const UploadSkillInput = z.object({
  content: z.string().min(1, 'content is required'),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
  scope_type: ScopeTypeEnum.default('global'),
  village_id: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type UploadSkillInput = z.infer<typeof UploadSkillInput>;

/** Zod schema for POST /api/skills/import-directory */
export const ImportDirectoryInput = z.object({
  directory: z.string().min(1, 'directory is required'),
  scope_type: ScopeTypeEnum.default('global'),
  source_type: SourceTypeEnum.default('system'),
  village_id: z.string().optional(),
  dry_run: z.boolean().default(false),
});
