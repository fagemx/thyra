/**
 * Village Pack Export — 從 DB 讀取 village 的所有 active 狀態，組裝成 VillagePack 結構。
 * 用途：apply → export → apply = idempotent 循環。
 */
import type { VillageManager } from '../village-manager';
import type { ConstitutionStore } from '../constitution-store';
import type { ChiefEngine, Chief } from '../chief-engine';
import type { LawEngine } from '../law-engine';
import type { SkillRegistry } from '../skill-registry';

// ── Types ────────────────────────────────────────────────────

/** 與 compiler.ts 的 VillagePack 相容的匯出結構 */
export interface ExportedVillagePack {
  pack_version: '0.1';
  village: {
    name: string;
    description: string;
    target_repo: string;
  };
  constitution: {
    rules: Array<{
      description: string;
      enforcement: 'hard' | 'soft';
      scope: string[];
    }>;
    allowed_permissions: string[];
    budget: {
      max_cost_per_action: number;
      max_cost_per_day: number;
      max_cost_per_loop: number;
    };
  };
  chief: {
    name: string;
    role: string;
    personality: {
      risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
      communication_style: 'concise' | 'detailed' | 'minimal';
      decision_speed: 'fast' | 'deliberate' | 'cautious';
    };
    constraints: Array<{
      type: 'must' | 'must_not' | 'prefer' | 'avoid';
      description: string;
    }>;
    permissions: string[];
  };
  laws: Array<{
    category: string;
    content: {
      description: string;
      strategy: Record<string, unknown>;
    };
    evidence: {
      source: string;
      reasoning: string;
    };
  }>;
  skills: string[];
}

export interface ExportDeps {
  villageMgr: VillageManager;
  constitutionStore: ConstitutionStore;
  chiefEngine: ChiefEngine;
  lawEngine: LawEngine;
  skillRegistry: SkillRegistry;
}

export interface ExportWarning {
  section: string;
  message: string;
}

export type ExportResult =
  | { ok: true; data: ExportedVillagePack; warnings: ExportWarning[] }
  | { ok: false; error: { code: string; message: string } };

// ── Export function ──────────────────────────────────────────

/**
 * 從 DB 匯出指定 village 的所有 active 狀態。
 * 產出結構可直接用 js-yaml dump 成 YAML，也可再餵回 compiler 做 round-trip 驗證。
 */
export function exportVillage(villageId: string, deps: ExportDeps): ExportResult {
  const warnings: ExportWarning[] = [];

  // 1. Village
  const village = deps.villageMgr.get(villageId);
  if (!village) {
    return {
      ok: false,
      error: { code: 'VILLAGE_NOT_FOUND', message: `Village "${villageId}" not found` },
    };
  }

  // 2. Constitution (optional — village 可能還沒建 constitution)
  const constitution = deps.constitutionStore.getActive(villageId);
  if (!constitution) {
    warnings.push({ section: 'constitution', message: 'No active constitution found' });
  }

  // 3. Chief (optional)
  const chiefs = deps.chiefEngine.list(villageId, { status: 'active' });
  const chief = (chiefs[0] as Chief | undefined) ?? null;
  if (!chief) {
    warnings.push({ section: 'chief', message: 'No active chief found' });
  }

  // 4. Laws
  const laws = deps.lawEngine.getActiveLaws(villageId);

  // 5. Skills — 從 chief 的 skill bindings 反查 skill name
  const skillNames: string[] = [];
  if (chief) {
    for (const binding of chief.skills) {
      const skill = deps.skillRegistry.get(binding.skill_id);
      if (skill) {
        skillNames.push(skill.name);
      } else {
        warnings.push({
          section: 'skills',
          message: `Skill binding "${binding.skill_id}" not found in registry`,
        });
      }
    }
  }

  // 6. Assemble
  const pack: ExportedVillagePack = {
    pack_version: '0.1',
    village: {
      name: village.name,
      description: village.description,
      target_repo: village.target_repo,
    },
    constitution: constitution
      ? {
          rules: constitution.rules.map((r) => ({
            description: r.description,
            enforcement: r.enforcement,
            scope: r.scope,
          })),
          allowed_permissions: [...constitution.allowed_permissions],
          budget: {
            max_cost_per_action: constitution.budget_limits.max_cost_per_action,
            max_cost_per_day: constitution.budget_limits.max_cost_per_day,
            max_cost_per_loop: constitution.budget_limits.max_cost_per_loop,
          },
        }
      : {
          rules: [],
          allowed_permissions: [],
          budget: { max_cost_per_action: 0, max_cost_per_day: 0, max_cost_per_loop: 0 },
        },
    chief: chief
      ? {
          name: chief.name,
          role: chief.role,
          personality: { ...chief.personality },
          constraints: chief.constraints.map((c) => ({ type: c.type, description: c.description })),
          permissions: [...chief.permissions],
        }
      : {
          name: '',
          role: '',
          personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
          constraints: [],
          permissions: [],
        },
    laws: laws.map((l) => ({
      category: l.category,
      content: {
        description: l.content.description,
        strategy: l.content.strategy,
      },
      evidence: {
        source: l.evidence.source,
        reasoning: l.evidence.reasoning,
      },
    })),
    skills: skillNames,
  };

  return { ok: true, data: pack, warnings };
}
