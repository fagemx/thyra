import { randomUUID } from 'crypto';

/**
 * 產生 evt_ 前綴的唯一事件 ID，使用 crypto.randomUUID() 確保唯一性。
 * 所有 governance schema 統一使用此函式。
 */
export function generateEventId(): string {
  return `evt_${randomUUID()}`;
}
