import { SourceRefSchema, LayerSchema } from './source-ref';
import type { SourceRef } from './source-ref';
import { ID_PREFIXES, extractPrefix } from './id-generator';

export function validateSourceRef(ref: unknown): { ok: true; data: SourceRef } | { ok: false; error: string } {
  const result = SourceRefSchema.safeParse(ref);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0].message };
  }
  return { ok: true, data: result.data };
}

export function validateIdPrefix(id: string): boolean {
  const prefix = extractPrefix(id);
  if (!prefix) return false;
  const knownPrefixes = Object.values(ID_PREFIXES);
  return (knownPrefixes as readonly string[]).includes(prefix);
}

export function isValidLayer(layer: string): boolean {
  return LayerSchema.safeParse(layer).success;
}
