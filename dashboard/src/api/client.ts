/**
 * Thyra API client for the dashboard.
 * All requests go through the Vite dev proxy (/api -> localhost:3462).
 * DASH-01: no imports from src/ — types are local.
 */

import type {
  ApiResponse,
  ApplyResult,
  AuditEntry,
  JudgeVerdict,
  Village,
  WorldChange,
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
): Promise<JudgeVerdict> {
  return request<JudgeVerdict>('POST', `/villages/${villageId}/world/judge`, change)
}

export async function applyChange(
  villageId: string,
  change: WorldChange,
  reason?: string,
): Promise<ApplyResult> {
  return request<ApplyResult>('POST', `/villages/${villageId}/world/apply`, {
    ...change,
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

export { ApiError }
