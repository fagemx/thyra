/**
 * cycle-state-machine.ts — Canonical cycle stage 狀態機
 *
 * 強制 CYCLE-01: stages 按固定順序執行，不可跳過或重排。
 *
 * @see docs/plan/world-cycle/CONTRACT.md CYCLE-01
 */

import type { CycleStage } from '../schemas/cycle-run';

/**
 * Fixed stage order per CYCLE-01.
 * The cycle MUST progress through these stages in order.
 */
const STAGE_ORDER: readonly CycleStage[] = [
  'idle',
  'observe',
  'propose',
  'judge',
  'apply',
  'pulse',
  'outcome',
  'precedent',
  'adjust',
  'complete',
] as const;

/**
 * Advance the cycle to the next stage.
 * Throws if the requested next stage is not the immediate successor.
 */
export function advanceCycleStage(
  current: CycleStage,
  next: CycleStage,
): CycleStage {
  if (current === 'failed') {
    throw new Error('Cannot advance a failed cycle');
  }
  if (current === 'complete') {
    throw new Error('Cycle already complete');
  }

  const currentIdx = STAGE_ORDER.indexOf(current);
  const nextIdx = STAGE_ORDER.indexOf(next);

  if (nextIdx !== currentIdx + 1) {
    throw new Error(
      `Invalid cycle stage transition: ${current} → ${next}. ` +
      `Expected next stage: ${STAGE_ORDER[currentIdx + 1]}`,
    );
  }

  return next;
}

/**
 * Mark a cycle as failed at the current stage.
 */
export function failCycleAtStage(
  current: CycleStage,
  reason: string,
): { stage: 'failed'; failedStage: CycleStage; reason: string } {
  return {
    stage: 'failed',
    failedStage: current,
    reason,
  };
}

/**
 * Get the next expected stage in the cycle.
 * Returns null if the cycle is complete or failed.
 */
export function getNextStage(current: CycleStage): CycleStage | null {
  if (current === 'failed' || current === 'complete') return null;
  const idx = STAGE_ORDER.indexOf(current);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
}

/** Get all stages in canonical order */
export function getStageOrder(): readonly CycleStage[] {
  return STAGE_ORDER;
}
