import type { Database } from 'bun:sqlite';
import type { Zone } from './zones';
import type { Stall } from './stalls';
import type { EventSlot } from './slots';

export interface Order {
  id: string;
  village_id: string;
  stall_id: string | null;
  slot_id: string | null;
  buyer: string;
  type: 'purchase' | 'booking' | 'commission';
  amount: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MarketMetrics {
  id: string;
  village_id: string;
  timestamp: string;
  total_visitors: number;
  active_stalls: number;
  active_events: number;
  revenue: number;
  incidents: number;
  satisfaction: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MarketState {
  zones: Zone[];
  stalls: Stall[];
  event_slots: EventSlot[];
  orders: Order[];
  metrics: MarketMetrics | null;
  assembled_at: string;
}

/**
 * 從 DB 組裝某個 village 的完整 market 狀態快照。
 * 純讀取函數，不寫 audit_log。
 * Pattern 與 assembleWorldState 一致。
 */
export function assembleMarketState(db: Database, villageId: string): MarketState {
  // 驗證 village 存在
  const villageRow = db.prepare(
    'SELECT id FROM villages WHERE id = ?',
  ).get(villageId);
  if (!villageRow) throw new Error(`Village not found: ${villageId}`);

  // zones
  const zoneRows = db.prepare(
    'SELECT * FROM zones WHERE village_id = ? ORDER BY created_at DESC',
  ).all(villageId) as Record<string, unknown>[];
  const zones = zoneRows.map(deserializeZone);

  // stalls
  const stallRows = db.prepare(
    'SELECT * FROM stalls WHERE village_id = ? ORDER BY rank DESC, created_at DESC',
  ).all(villageId) as Record<string, unknown>[];
  const stalls = stallRows.map(deserializeStall);

  // event_slots
  const slotRows = db.prepare(
    'SELECT * FROM event_slots WHERE village_id = ? ORDER BY start_time ASC',
  ).all(villageId) as Record<string, unknown>[];
  const event_slots = slotRows.map(deserializeSlot);

  // orders — 只取 active orders（pending + confirmed）
  const orderRows = db.prepare(
    "SELECT * FROM orders WHERE village_id = ? AND status IN ('pending','confirmed') ORDER BY created_at DESC",
  ).all(villageId) as Record<string, unknown>[];
  const orders = orderRows.map(deserializeOrder);

  // metrics — 只取最新一筆
  const metricRow = db.prepare(
    'SELECT * FROM market_metrics WHERE village_id = ? ORDER BY timestamp DESC LIMIT 1',
  ).get(villageId) as Record<string, unknown> | null;
  const metrics = metricRow ? deserializeMetrics(metricRow) : null;

  return {
    zones,
    stalls,
    event_slots,
    orders,
    metrics,
    assembled_at: new Date().toISOString(),
  };
}

// --- Deserialize 函數 ---

function deserializeZone(row: Record<string, unknown>): Zone {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    name: row.name as string,
    type: row.type as Zone['type'],
    capacity: row.capacity as number,
    current_load: row.current_load as number,
    status: row.status as Zone['status'],
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function deserializeStall(row: Record<string, unknown>): Stall {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    zone_id: row.zone_id as string,
    name: row.name as string,
    owner: (row.owner as string) || null,
    category: (row.category as string) || null,
    rank: row.rank as number,
    status: row.status as Stall['status'],
    metadata: JSON.parse((row.metadata as string) || '{}') as Record<string, unknown>,
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function deserializeSlot(row: Record<string, unknown>): EventSlot {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    zone_id: (row.zone_id as string) || null,
    title: row.title as string,
    description: row.description as string,
    start_time: row.start_time as string,
    end_time: row.end_time as string,
    capacity: row.capacity !== null ? (row.capacity as number) : null,
    booked: row.booked as number,
    status: row.status as EventSlot['status'],
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function deserializeOrder(row: Record<string, unknown>): Order {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    stall_id: (row.stall_id as string) || null,
    slot_id: (row.slot_id as string) || null,
    buyer: row.buyer as string,
    type: row.type as Order['type'],
    amount: row.amount as number,
    status: row.status as Order['status'],
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function deserializeMetrics(row: Record<string, unknown>): MarketMetrics {
  return {
    id: row.id as string,
    village_id: row.village_id as string,
    timestamp: row.timestamp as string,
    total_visitors: row.total_visitors as number,
    active_stalls: row.active_stalls as number,
    active_events: row.active_events as number,
    revenue: row.revenue as number,
    incidents: row.incidents as number,
    satisfaction: row.satisfaction as number,
    metadata: JSON.parse((row.metadata as string) || '{}') as Record<string, unknown>,
    created_at: row.created_at as string,
  };
}
