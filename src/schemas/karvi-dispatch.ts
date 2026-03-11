import { z } from 'zod';

// === Karvi POST /api/projects 對齊 ===

const KarviTaskInput = z.object({
  id: z.string().optional(),
  issue: z.number().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  assignee: z.string().optional(),
  depends: z.array(z.string()).optional(),
  spec: z.string().optional(),
  skill: z.string().optional(),
  target_repo: z.string().optional(),
  scope: z.string().optional(),
  runtimeHint: z.string().optional(),
  modelHint: z.string().optional(),
});

export const DispatchProjectInput = z.object({
  title: z.string().min(1),
  repo: z.string().optional(),
  tasks: z.array(KarviTaskInput).min(1),
  concurrency: z.number().min(1).max(10).optional(),
  completionTrigger: z.enum(['pr_merged', 'approved']).optional(),
  autoStart: z.boolean().optional(),
  goal: z.string().optional(),
});

export type DispatchProjectInputRaw = z.input<typeof DispatchProjectInput>;

// === Karvi Response Types ===

export interface KarviProjectResponse {
  ok: boolean;
  title: string;
  taskCount: number;
  project?: {
    id: string;
    title: string;
    repo: string;
    status: string;
    concurrency: number;
    completionTrigger: string;
    taskIds: string[];
    createdAt: string;
  };
  progress?: {
    total: number;
    done: number;
    in_progress: number;
    pending: number;
    blocked: number;
    pct: number;
  };
  autoStarted?: string;
  planId?: string;
}

export interface KarviSingleDispatchResponse {
  ok: boolean;
  taskId: string;
  dispatched: boolean;
  planId?: string;
}

export interface KarviBudgetExceededError {
  error: string;
  code: 'BUDGET_EXCEEDED';
  taskId?: string;
  remaining?: {
    llm_calls: number;
    tokens: number;
    wall_clock_ms: number;
    steps: number;
  };
}
