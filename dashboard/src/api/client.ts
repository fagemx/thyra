/**
 * Thyra API client for the dashboard.
 * All requests go through the Vite dev proxy (/api -> localhost:3462).
 * DASH-01: no imports from src/ — types are local.
 */

import type {
  ApiResponse,
  ApplyResult,
  AuditEntry,
  BudgetStatus,
  Chief,
  JudgeResult,
  TelemetryEntry,
  TelemetrySummary,
  Village,
  WorldChange,
  WorldHealth,
  WorldState,
} from './types'

const BASE = '/api'

class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  const json = (await res.json()) as ApiResponse<T>

  if (!json.ok) {
    throw new ApiError(json.error.code, json.error.message)
  }

  return json.data
}

// --- Village ---

export async function listVillages(): Promise<Village[]> {
  return request<Village[]>('GET', '/villages')
}

// --- World ---

export async function getWorldState(villageId: string): Promise<WorldState> {
  return request<WorldState>('GET', `/villages/${villageId}/world/state`)
}

export async function judgeChange(
  villageId: string,
  change: WorldChange,
): Promise<JudgeResult> {
  return request<JudgeResult>('POST', `/villages/${villageId}/world/judge`, { change })
}

export async function applyChange(
  villageId: string,
  change: WorldChange,
  reason?: string,
): Promise<ApplyResult> {
  return request<ApplyResult>('POST', `/villages/${villageId}/world/apply`, {
    change,
    reason,
  })
}

// --- Audit ---

export async function getVillageAudit(
  villageId: string,
  limit = 10,
): Promise<AuditEntry[]> {
  return request<AuditEntry[]>('GET', `/villages/${villageId}/audit?limit=${limit}`)
}

// --- Health ---

export async function getHealth(): Promise<{ status: string }> {
  return request<{ status: string }>('GET', '/health')
}

// --- Operator: Chiefs ---

export async function listChiefs(villageId: string): Promise<Chief[]> {
  return request<Chief[]>('GET', `/villages/${villageId}/chiefs`)
}

export async function resumeChief(chiefId: string): Promise<Chief> {
  return request<Chief>('POST', `/chiefs/${chiefId}/resume`)
}

// --- Operator: Audit ---

export async function listAudit(villageId: string, limit = 30): Promise<AuditEntry[]> {
  return request<AuditEntry[]>('GET', `/villages/${villageId}/audit?limit=${limit}`)
}

// --- Operator: Telemetry ---

export async function listTelemetry(villageId: string, limit = 20): Promise<TelemetryEntry[]> {
  return request<TelemetryEntry[]>('GET', `/villages/${villageId}/telemetry?limit=${limit}`)
}

export async function getTelemetrySummary(villageId: string): Promise<TelemetrySummary> {
  return request<TelemetrySummary>('GET', `/villages/${villageId}/telemetry/summary`)
}

// --- Operator: Budget ---

export async function getBudget(villageId: string): Promise<BudgetStatus> {
  return request<BudgetStatus>('GET', `/villages/${villageId}/budget`)
}

// --- Operator: SSE Pulse ---

export function subscribePulse(
  villageId: string,
  onPulse: (health: WorldHealth) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = `${BASE}/villages/${villageId}/world/pulse?interval=5000`
  const source = new EventSource(url)

  source.addEventListener('pulse', (event) => {
    const data = JSON.parse(event.data) as WorldHealth
    onPulse(data)
  })

  // Also handle generic message events (some SSE implementations use default)
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as WorldHealth
      onPulse(data)
    } catch {
      // Ignore non-JSON messages (e.g., heartbeats)
    }
  }

  source.onerror = (event) => {
    onError?.(event)
  }

  return () => source.close()
}

export { ApiError }
