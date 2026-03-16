import { describe, it, expect } from 'vitest';
import {
  OperationTimingSchema,
  CycleTelemetrySchema,
  OperationMetadataSchema,
  TelemetrySummarySchema,
} from './cycle-telemetry';

describe('cycle-telemetry schemas', () => {
  // -------------------------------------------------------------------------
  // OperationTiming
  // -------------------------------------------------------------------------
  it('parses valid OperationTiming', () => {
    const result = OperationTimingSchema.safeParse({
      name: 'decide',
      duration_ms: 123,
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('parses OperationTiming with metadata', () => {
    const result = OperationTimingSchema.safeParse({
      name: 'invoke_adapter',
      duration_ms: 3500,
      status: 'ok',
      metadata: { tokens_used: 1200, cost_cents: 0.3, model: 'claude-haiku' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid operation name', () => {
    const result = OperationTimingSchema.safeParse({
      name: 'invalid_op',
      duration_ms: 10,
      status: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative duration_ms', () => {
    const result = OperationTimingSchema.safeParse({
      name: 'decide',
      duration_ms: -1,
      status: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = OperationTimingSchema.safeParse({
      name: 'decide',
      duration_ms: 10,
      status: 'timeout',
    });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // OperationMetadata
  // -------------------------------------------------------------------------
  it('metadata is optional', () => {
    const result = OperationTimingSchema.safeParse({
      name: 'get_state',
      duration_ms: 5,
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('parses error metadata', () => {
    const result = OperationMetadataSchema.safeParse({
      error: 'timeout after 30s',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown metadata fields', () => {
    const result = OperationMetadataSchema.safeParse({
      unknown_field: 'bad',
    });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // CycleTelemetry
  // -------------------------------------------------------------------------
  it('parses valid CycleTelemetry', () => {
    const result = CycleTelemetrySchema.safeParse({
      id: 'tel-001',
      cycle_id: 'cycle-abc',
      chief_id: 'chief-001',
      village_id: 'village-001',
      total_duration_ms: 7400,
      operations: [
        { name: 'get_state', duration_ms: 300, status: 'ok' },
        { name: 'decide', duration_ms: 3500, status: 'ok', metadata: { model: 'rule-based' } },
        { name: 'apply', duration_ms: 200, status: 'ok' },
      ],
      created_at: '2026-03-16T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('allows empty operations array', () => {
    const result = CycleTelemetrySchema.safeParse({
      id: 'tel-002',
      cycle_id: 'cycle-xyz',
      chief_id: 'chief-002',
      village_id: 'village-002',
      total_duration_ms: 0,
      operations: [],
      created_at: '2026-03-16T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing cycle_id', () => {
    const result = CycleTelemetrySchema.safeParse({
      id: 'tel-003',
      chief_id: 'chief-003',
      village_id: 'village-003',
      total_duration_ms: 100,
      operations: [],
      created_at: '2026-03-16T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // TelemetrySummary
  // -------------------------------------------------------------------------
  it('parses valid TelemetrySummary', () => {
    const result = TelemetrySummarySchema.safeParse({
      cycle_count: 42,
      avg_duration_ms: 7400,
      max_duration_ms: 15000,
      total_cost_cents: 1.5,
      slowest_operation: { name: 'decide', avg_ms: 3500 },
      operation_breakdown: [
        { name: 'get_state', avg_ms: 300, error_rate: 0 },
        { name: 'decide', avg_ms: 3500, error_rate: 0.02 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('allows null slowest_operation', () => {
    const result = TelemetrySummarySchema.safeParse({
      cycle_count: 0,
      avg_duration_ms: 0,
      max_duration_ms: 0,
      total_cost_cents: 0,
      slowest_operation: null,
      operation_breakdown: [],
    });
    expect(result.success).toBe(true);
  });
});
