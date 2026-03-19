import { describe, it, expect } from 'vitest';
import { evaluatePromotionChecklist } from './checklist-evaluator';
import type { ProjectPlanContext, ThyraRuntimeContext } from './checklist-evaluator';

describe('evaluatePromotionChecklist', () => {
  describe('project-plan target', () => {
    const allPassed: ProjectPlanContext = {
      coreTerminologyStable: true,
      canonicalFormExists: true,
      sharedTypesClear: true,
      canonicalSliceExists: true,
      demoPathRunnable: true,
      moduleBoundariesClear: true,
    };

    it('returns ready when all 6 items pass', () => {
      const result = evaluatePromotionChecklist('project-plan', allPassed);
      expect(result.verdict).toBe('ready');
      expect(result.results).toHaveLength(6);
      expect(result.id).toMatch(/^chk_/);
    });

    it('returns partial when 1 item fails', () => {
      const context = { ...allPassed, demoPathRunnable: false };
      const result = evaluatePromotionChecklist('project-plan', context);
      expect(result.verdict).toBe('partial');
    });

    it('returns partial when 2 items fail', () => {
      const context = {
        ...allPassed,
        demoPathRunnable: false,
        canonicalSliceExists: false,
      };
      const result = evaluatePromotionChecklist('project-plan', context);
      expect(result.verdict).toBe('partial');
    });

    it('returns not_ready when 3 items fail', () => {
      const context = {
        ...allPassed,
        demoPathRunnable: false,
        canonicalSliceExists: false,
        moduleBoundariesClear: false,
      };
      const result = evaluatePromotionChecklist('project-plan', context);
      expect(result.verdict).toBe('not_ready');
    });

    it('returns not_ready when all items fail', () => {
      const context: ProjectPlanContext = {
        coreTerminologyStable: false,
        canonicalFormExists: false,
        sharedTypesClear: false,
        canonicalSliceExists: false,
        demoPathRunnable: false,
        moduleBoundariesClear: false,
      };
      const result = evaluatePromotionChecklist('project-plan', context);
      expect(result.verdict).toBe('not_ready');
    });

    it('has correct item labels', () => {
      const result = evaluatePromotionChecklist('project-plan', allPassed);
      const labels = result.results.map(r => r.item);
      expect(labels).toEqual([
        'Core terminology stable',
        'Canonical form exists',
        'Shared types clear',
        'Canonical slice exists',
        'Demo path runnable',
        'Module boundaries clear',
      ]);
    });
  });

  describe('thyra-runtime target', () => {
    const allPassed: ThyraRuntimeContext = {
      worldFormSelected: true,
      minimumWorldHasShape: true,
      closureTargetClear: true,
      changeJudgmentDefined: true,
      runtimeConstraintsExplicit: true,
    };

    it('returns ready when all 5 items pass', () => {
      const result = evaluatePromotionChecklist('thyra-runtime', allPassed);
      expect(result.verdict).toBe('ready');
      expect(result.results).toHaveLength(5);
    });

    it('returns partial when 1 item fails', () => {
      const context = { ...allPassed, closureTargetClear: false };
      const result = evaluatePromotionChecklist('thyra-runtime', context);
      expect(result.verdict).toBe('partial');
    });

    it('returns partial when 2 items fail', () => {
      const context = {
        ...allPassed,
        closureTargetClear: false,
        minimumWorldHasShape: false,
      };
      const result = evaluatePromotionChecklist('thyra-runtime', context);
      expect(result.verdict).toBe('partial');
    });

    it('returns not_ready when 3 items fail', () => {
      const context = {
        ...allPassed,
        worldFormSelected: false,
        minimumWorldHasShape: false,
        changeJudgmentDefined: false,
      };
      const result = evaluatePromotionChecklist('thyra-runtime', context);
      expect(result.verdict).toBe('not_ready');
    });

    it('returns not_ready when all items fail', () => {
      const context: ThyraRuntimeContext = {
        worldFormSelected: false,
        minimumWorldHasShape: false,
        closureTargetClear: false,
        changeJudgmentDefined: false,
        runtimeConstraintsExplicit: false,
      };
      const result = evaluatePromotionChecklist('thyra-runtime', context);
      expect(result.verdict).toBe('not_ready');
    });

    it('has correct item labels', () => {
      const result = evaluatePromotionChecklist('thyra-runtime', allPassed);
      const labels = result.results.map(r => r.item);
      expect(labels).toEqual([
        'World form selected',
        'Minimum world has shape',
        'Closure target clear',
        'Change/judgment/pulse/outcome defined',
        'Runtime constraints explicit',
      ]);
    });
  });

  describe('ID generation', () => {
    it('generates unique IDs with chk_ prefix', () => {
      const context: ProjectPlanContext = {
        coreTerminologyStable: true,
        canonicalFormExists: true,
        sharedTypesClear: true,
        canonicalSliceExists: true,
        demoPathRunnable: true,
        moduleBoundariesClear: true,
      };
      const ids = new Set(
        Array.from({ length: 20 }, () => evaluatePromotionChecklist('project-plan', context).id)
      );
      expect(ids.size).toBe(20);
      for (const id of ids) {
        expect(id).toMatch(/^chk_/);
      }
    });
  });

  describe('createdAt', () => {
    it('sets createdAt to a valid ISO string', () => {
      const context: ProjectPlanContext = {
        coreTerminologyStable: true,
        canonicalFormExists: true,
        sharedTypesClear: true,
        canonicalSliceExists: true,
        demoPathRunnable: true,
        moduleBoundariesClear: true,
      };
      const result = evaluatePromotionChecklist('project-plan', context);
      const parsed = new Date(result.createdAt);
      expect(parsed.toISOString()).toBe(result.createdAt);
    });
  });

  describe('targetLayer', () => {
    it('includes targetLayer in output', () => {
      const projectPlanContext: ProjectPlanContext = {
        coreTerminologyStable: true,
        canonicalFormExists: true,
        sharedTypesClear: true,
        canonicalSliceExists: true,
        demoPathRunnable: true,
        moduleBoundariesClear: true,
      };
      const result1 = evaluatePromotionChecklist('project-plan', projectPlanContext);
      expect(result1.targetLayer).toBe('project-plan');

      const thyraContext: ThyraRuntimeContext = {
        worldFormSelected: true,
        minimumWorldHasShape: true,
        closureTargetClear: true,
        changeJudgmentDefined: true,
        runtimeConstraintsExplicit: true,
      };
      const result2 = evaluatePromotionChecklist('thyra-runtime', thyraContext);
      expect(result2.targetLayer).toBe('thyra-runtime');
    });
  });
});
