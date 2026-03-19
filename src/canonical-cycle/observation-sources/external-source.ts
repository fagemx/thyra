/**
 * observation-sources/external-source.ts — 從外部事件產生觀察
 *
 * 將外部事件（Karvi webhooks、人類操作、定時器等）轉換為結構化觀察。
 * Pure function，無 DB 依賴。
 *
 * @see TRACK_A_OBSERVATION_BUILDER.md Step 2
 */

import type { Observation } from '../../schemas/observation';
import type { ExternalEvent } from '../observation-builder';

/**
 * 將外部事件列表轉換為觀察。
 * 每個 ExternalEvent 映射為一個 Observation。
 */
export function observeFromExternal(events: ExternalEvent[]): Observation[] {
  return events.map(event => ({
    id: `obs_ext_${event.id}`,
    source: 'external' as const,
    timestamp: event.timestamp,
    scope: 'world' as const,
    importance: 'medium' as const,
    summary: `External: ${event.type}`,
    details: event.data,
  }));
}
