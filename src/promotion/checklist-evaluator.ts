import { generateId } from '../cross-layer';
import {
  PromotionChecklistSchema,
  type PromotionChecklist,
  type ChecklistItem,
} from './schemas/checklist';

const PROJECT_PLAN_ITEMS = [
  { key: 'coreTerminologyStable', label: 'Core terminology stable' },
  { key: 'canonicalFormExists', label: 'Canonical form exists' },
  { key: 'sharedTypesClear', label: 'Shared types clear' },
  { key: 'canonicalSliceExists', label: 'Canonical slice exists' },
  { key: 'demoPathRunnable', label: 'Demo path runnable' },
  { key: 'moduleBoundariesClear', label: 'Module boundaries clear' },
] as const;

const THYRA_RUNTIME_ITEMS = [
  { key: 'worldFormSelected', label: 'World form selected' },
  { key: 'minimumWorldHasShape', label: 'Minimum world has shape' },
  { key: 'closureTargetClear', label: 'Closure target clear' },
  { key: 'changeJudgmentDefined', label: 'Change/judgment/pulse/outcome defined' },
  { key: 'runtimeConstraintsExplicit', label: 'Runtime constraints explicit' },
] as const;

export interface ProjectPlanContext {
  coreTerminologyStable: boolean;
  canonicalFormExists: boolean;
  sharedTypesClear: boolean;
  canonicalSliceExists: boolean;
  demoPathRunnable: boolean;
  moduleBoundariesClear: boolean;
}

export interface ThyraRuntimeContext {
  worldFormSelected: boolean;
  minimumWorldHasShape: boolean;
  closureTargetClear: boolean;
  changeJudgmentDefined: boolean;
  runtimeConstraintsExplicit: boolean;
}

export type ChecklistContext = ProjectPlanContext | ThyraRuntimeContext;

function computeVerdict(results: ChecklistItem[]): 'ready' | 'partial' | 'not_ready' {
  const failedCount = results.filter(r => !r.passed).length;
  if (failedCount === 0) return 'ready';
  if (failedCount <= 2) return 'partial';
  return 'not_ready';
}

export function evaluatePromotionChecklist(
  targetLayer: 'project-plan',
  context: ProjectPlanContext
): PromotionChecklist;
export function evaluatePromotionChecklist(
  targetLayer: 'thyra-runtime',
  context: ThyraRuntimeContext
): PromotionChecklist;
export function evaluatePromotionChecklist(
  targetLayer: 'project-plan' | 'thyra-runtime',
  context: ChecklistContext
): PromotionChecklist {
  const items = targetLayer === 'project-plan' ? PROJECT_PLAN_ITEMS : THYRA_RUNTIME_ITEMS;

  const results: ChecklistItem[] = items.map(({ key, label }) => ({
    item: label,
    passed: Boolean((context as unknown as Record<string, unknown>)[key]),
  }));

  const verdict = computeVerdict(results);
  const id = generateId('chk');
  const createdAt = new Date().toISOString();

  return PromotionChecklistSchema.parse({ id, targetLayer, results, verdict, createdAt });
}
