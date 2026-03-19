/**
 * cycle-cadence.ts — Cycle 節奏配置與計時器
 *
 * 管理治理循環的執行間隔、摘要排程、outcome 觀察窗口。
 * CYCLE-03: 節奏可配置（預設 15 分鐘），但 intervalMinutes 不可為 0 或負數。
 *
 * @see docs/plan/world-cycle/TRACK_C_CYCLE_RUNNER.md Step 3
 * @see docs/plan/world-cycle/CONTRACT.md CYCLE-03
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// CycleCadence schema
// ---------------------------------------------------------------------------

export const CycleCadenceSchema = z.object({
  /** Minutes between cycle starts. Must be > 0 (CYCLE-03) */
  intervalMinutes: z.number().int().positive(),

  /** Morning summary schedule (cron-like) */
  summarySchedule: z.string().optional(),

  /** Minutes an outcome window stays open after apply */
  outcomeWindowMinutes: z.number().int().positive().default(60),
});
export type CycleCadence = z.infer<typeof CycleCadenceSchema>;

// ---------------------------------------------------------------------------
// Default cadence
// ---------------------------------------------------------------------------

/** Default cadence: every 15 minutes, 60-minute outcome windows */
export const DEFAULT_CADENCE: CycleCadence = {
  intervalMinutes: 15,
  summarySchedule: '0 6 * * *', // 6am daily
  outcomeWindowMinutes: 60,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate cadence config. Rejects intervalMinutes <= 0 (CYCLE-03: never skippable).
 */
export function validateCadence(cadence: unknown): CycleCadence {
  const result = CycleCadenceSchema.safeParse(cadence);
  if (!result.success) {
    throw new Error(`Invalid cadence config: ${result.error.message}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Timer utilities
// ---------------------------------------------------------------------------

/**
 * Calculate when the next cycle should start.
 */
export function getNextCycleTime(
  lastCycleStartedAt: string,
  cadence: CycleCadence,
): Date {
  const last = new Date(lastCycleStartedAt);
  return new Date(last.getTime() + cadence.intervalMinutes * 60_000);
}

/**
 * Create a timer that triggers cycle execution at the configured cadence.
 * Returns a cleanup function to stop the timer.
 */
export function startCycleTimer(
  cadence: CycleCadence,
  onTick: () => Promise<void>,
): { stop: () => void } {
  const intervalMs = cadence.intervalMinutes * 60_000;
  const handle = setInterval(() => {
    void onTick().catch(console.error);
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
  };
}
