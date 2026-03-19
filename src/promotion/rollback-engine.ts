import { generateId } from '../cross-layer';
import { PromotionRollbackMemoSchema } from './schemas/rollback';
import type { PromotionRollbackMemo } from './schemas/rollback';

// --- Input types ---

export interface RollbackInput {
  originalHandoffId: string;
  fromLayer: 'project-plan' | 'thyra-runtime';
  reason: string;
  discoveredProblems: string[];
  specsNeedingReview: string[];
  whatStillValid: string[];
  whatInvalidated: string[];
}

// --- Suspendable store interface ---
// CONTRACT PROMO-02: no delete method — only suspend
export type SuspendableType = 'planning-pack' | 'runtime-world';

export interface SuspendableStore {
  getStatus(type: SuspendableType, targetId: string): string | null;
  setStatus(type: SuspendableType, targetId: string, status: string): void;
}

export interface SuspendResult {
  type: SuspendableType;
  targetId: string;
  previousStatus: string;
  newStatus: 'suspended';
}

// --- Engine functions ---

/**
 * 建立 rollback memo — 記錄回滾原因與影響範圍。
 * CONTRACT PROMO-03: originalHandoffId 必填，由 schema 驗證。
 */
export function createRollbackMemo(input: RollbackInput): PromotionRollbackMemo {
  const id = generateId('rollback');
  const createdAt = new Date().toISOString();
  return PromotionRollbackMemoSchema.parse({
    id,
    ...input,
    toLayer: 'arch-spec',
    createdAt,
  });
}

/**
 * 將下游產物標記為 suspended。
 * CONTRACT PROMO-02: 只設 suspended，永不刪除。
 * 冪等：已 suspended 的目標不報錯，直接回傳。
 */
export function markSuspended(
  type: SuspendableType,
  targetId: string,
  store: SuspendableStore,
): SuspendResult {
  const currentStatus = store.getStatus(type, targetId);
  if (currentStatus === null) {
    throw new Error(`Target not found: ${type}/${targetId}`);
  }
  store.setStatus(type, targetId, 'suspended');
  return {
    type,
    targetId,
    previousStatus: currentStatus,
    newStatus: 'suspended',
  };
}

/**
 * 建立 in-memory SuspendableStore，用於測試與初期使用。
 */
export function createInMemoryStore(): SuspendableStore {
  const data = new Map<string, string>();
  return {
    getStatus(type: SuspendableType, targetId: string): string | null {
      return data.get(`${type}:${targetId}`) ?? null;
    },
    setStatus(type: SuspendableType, targetId: string, status: string): void {
      data.set(`${type}:${targetId}`, status);
    },
  };
}
