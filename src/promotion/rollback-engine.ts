import { generateId } from '../cross-layer';
import { PromotionRollbackMemoSchema } from './schemas/rollback';
import type { PromotionRollbackMemo } from './schemas/rollback';

export interface RollbackInput {
  originalHandoffId: string;
  fromLayer: 'project-plan' | 'thyra-runtime';
  reason: string;
  discoveredProblems: string[];
  specsNeedingReview: string[];
  whatStillValid: string[];
  whatInvalidated: string[];
}

export function createRollbackMemo(input: RollbackInput): PromotionRollbackMemo {
  const id = generateId('rollback');
  return PromotionRollbackMemoSchema.parse({
    id,
    ...input,
    toLayer: 'arch-spec',
    createdAt: new Date().toISOString(),
  });
}

// Mark downstream artifacts as suspended — NOT deleted (CONTRACT PROMO-02)
export type SuspendableType = 'planning-pack' | 'runtime-world';

export interface SuspendResult {
  type: SuspendableType;
  targetId: string;
  previousStatus: string;
  newStatus: 'suspended';
}

export interface SuspendableDb {
  get(targetId: string): { status: string } | undefined;
  setStatus(targetId: string, status: string): void;
}

export function markSuspended(
  type: SuspendableType,
  targetId: string,
  db: SuspendableDb,
): SuspendResult {
  const record = db.get(targetId);
  if (!record) {
    throw new Error(`${type} with id "${targetId}" not found`);
  }
  const previousStatus = record.status;
  // 設定為 suspended，永遠不刪除（CONTRACT PROMO-02）
  db.setStatus(targetId, 'suspended');
  return {
    type,
    targetId,
    previousStatus,
    newStatus: 'suspended',
  };
}
