import type { PulseFrame } from '../schemas/pulse-frame';

/**
 * SSE event types for pulse streaming.
 * Per pulse spec §26: push governance events, not raw metrics.
 */
export type PulseSSEEvent =
  | { type: 'pulse_updated'; data: PulseFrame }
  | { type: 'concern_escalated'; data: { concern: string; severity: string; worldId: string } }
  | { type: 'stability_changed'; data: { from: string; to: string; worldId: string } };

/**
 * Format a PulseFrame as an SSE event string.
 */
export function formatPulseSSE(frame: PulseFrame): string {
  return `event: pulse_updated\ndata: ${JSON.stringify(frame)}\n\n`;
}

/**
 * Detect if stability changed between two frames and emit event.
 */
export function detectStabilityChange(
  previous: PulseFrame | null,
  current: PulseFrame,
): PulseSSEEvent | null {
  if (!previous) return null;
  if (previous.stability !== current.stability) {
    return {
      type: 'stability_changed',
      data: {
        from: previous.stability,
        to: current.stability,
        worldId: current.worldId,
      },
    };
  }
  return null;
}

/**
 * Detect if any concern was escalated to critical.
 */
export function detectConcernEscalation(
  previous: PulseFrame | null,
  current: PulseFrame,
): PulseSSEEvent[] {
  const events: PulseSSEEvent[] = [];
  const prevCritical = new Set(
    (previous?.dominantConcerns ?? [])
      .filter(c => c.severity === 'critical')
      .map(c => c.kind)
  );

  for (const concern of current.dominantConcerns) {
    if (concern.severity === 'critical' && !prevCritical.has(concern.kind)) {
      events.push({
        type: 'concern_escalated',
        data: {
          concern: concern.kind,
          severity: concern.severity,
          worldId: current.worldId,
        },
      });
    }
  }

  return events;
}
