import { z } from 'zod';
import { randomUUID } from 'crypto';

// governance.patch.v1 -- Thyra 下發 constitution/law 變更給 Karvi

export const PatchTypeEnum = z.enum([
  'constitution_created',
  'constitution_superseded',
  'constitution_revoked',
  'law_proposed',
  'law_enacted',
  'law_repealed',
]);

export const GovernancePatchSchema = z.object({
  version: z.literal('governance.patch.v1'),
  event_id: z.string().regex(/^evt_/, 'event_id must start with evt_'),
  occurred_at: z.string().datetime(),
  source_village_id: z.string().min(1),
  patch_type: PatchTypeEnum,
  payload: z.record(z.unknown()),
});

export type PatchType = z.infer<typeof PatchTypeEnum>;
export type GovernancePatch = z.infer<typeof GovernancePatchSchema>;

/**
 * 建立一個合法的 governance patch event，自動產生 event_id 和 timestamp
 */
export function createGovernancePatch(
  source_village_id: string,
  patch_type: PatchType,
  payload: Record<string, unknown> = {},
): GovernancePatch {
  return {
    version: 'governance.patch.v1',
    event_id: `evt_${randomUUID()}`,
    occurred_at: new Date().toISOString(),
    source_village_id,
    patch_type,
    payload,
  };
}
