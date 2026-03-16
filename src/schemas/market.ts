import { z } from 'zod';

// --- Zone ---

export const ZoneTypeEnum = z.enum(['main_street', 'side_alley', 'stage', 'entrance']);
export const ZoneStatusEnum = z.enum(['active', 'closed']);

export const CreateZoneInput = z.object({
  name: z.string().min(1).max(200),
  type: ZoneTypeEnum,
  capacity: z.number().int().positive(),
});

export const UpdateZoneInput = z.object({
  name: z.string().min(1).max(200).optional(),
  capacity: z.number().int().positive().optional(),
  status: ZoneStatusEnum.optional(),
});

export type CreateZoneInput = z.infer<typeof CreateZoneInput>;
export type UpdateZoneInput = z.infer<typeof UpdateZoneInput>;

// --- Stall ---

export const StallStatusEnum = z.enum(['active', 'spotlight', 'closed']);

export const CreateStallInput = z.object({
  zone_id: z.string().min(1),
  name: z.string().min(1).max(200),
  owner: z.string().optional(),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateStallInput = z.object({
  name: z.string().min(1).max(200).optional(),
  owner: z.string().optional(),
  category: z.string().optional(),
  rank: z.number().int().optional(),
  status: StallStatusEnum.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateStallInput = z.infer<typeof CreateStallInput>;
export type CreateStallInputRaw = z.input<typeof CreateStallInput>;
export type UpdateStallInput = z.infer<typeof UpdateStallInput>;

// --- Event Slot ---

export const SlotStatusEnum = z.enum(['open', 'full', 'active', 'ended']);

export const CreateSlotInput = z.object({
  zone_id: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  capacity: z.number().int().positive().optional(),
});

export const UpdateSlotInput = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: SlotStatusEnum.optional(),
});

export type CreateSlotInput = z.infer<typeof CreateSlotInput>;
export type CreateSlotInputRaw = z.input<typeof CreateSlotInput>;
export type UpdateSlotInput = z.infer<typeof UpdateSlotInput>;

// --- Order ---

export const OrderTypeEnum = z.enum(['purchase', 'booking', 'commission']);
export const OrderStatusEnum = z.enum(['pending', 'confirmed', 'completed', 'cancelled']);

export const CreateOrderInput = z.object({
  stall_id: z.string().optional(),
  slot_id: z.string().optional(),
  buyer: z.string().min(1),
  type: OrderTypeEnum,
  amount: z.number().nonnegative().default(0),
});

export const UpdateOrderInput = z.object({
  status: OrderStatusEnum.optional(),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;
export type CreateOrderInputRaw = z.input<typeof CreateOrderInput>;
export type UpdateOrderInput = z.infer<typeof UpdateOrderInput>;

// --- Market Metrics ---

export const RecordMetricsInput = z.object({
  total_visitors: z.number().int().nonnegative(),
  active_stalls: z.number().int().nonnegative(),
  active_events: z.number().int().nonnegative(),
  revenue: z.number().nonnegative(),
  incidents: z.number().int().nonnegative(),
  satisfaction: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).default({}),
});

export type RecordMetricsInput = z.infer<typeof RecordMetricsInput>;
export type RecordMetricsInputRaw = z.input<typeof RecordMetricsInput>;
