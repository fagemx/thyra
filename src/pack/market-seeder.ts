/**
 * Market Template Seeder — 將 MarketTemplate 播種為完整 Market 世界
 *
 * 使用 db.transaction() 確保原子性：任一步驟失敗則全部回滾。
 * 依賴注入所有 manager/store/engine，不自行建立。
 */
import type { Database } from 'bun:sqlite';
import type { MarketTemplate } from '../schemas/market-template';
import type { VillageManager } from '../village-manager';
import type { ConstitutionStore } from '../constitution-store';
import type { ChiefEngine } from '../chief-engine';
import type { SkillRegistry } from '../skill-registry';
import type { ZoneManager } from '../market/zones';

// ── Types ────────────────────────────────────────────────────

export interface MarketSeedDeps {
  villageMgr: VillageManager;
  constitutionStore: ConstitutionStore;
  chiefEngine: ChiefEngine;
  skillRegistry: SkillRegistry;
  zoneManager: ZoneManager;
}

export interface MarketSeedResult {
  village_id: string;
  constitution_id: string;
  chief_ids: string[];
  skill_ids: string[];
  zone_ids: string[];
}

// ── Seeder ───────────────────────────────────────────────────

/**
 * 從 MarketTemplate 播種完整 Market 世界。
 *
 * 執行順序：Village → Constitution → Skills（resolve） → Chiefs → Zones
 * 整個過程在 SQLite transaction 內執行，失敗自動回滾。
 */
export function seedMarketWorld(
  db: Database,
  template: MarketTemplate,
  deps: MarketSeedDeps,
  actor: string,
): MarketSeedResult {
  return db.transaction(() => {
    // Phase 1: 建立 village
    const village = deps.villageMgr.create(
      {
        name: template.village.name,
        description: template.village.description,
        target_repo: template.village.target_repo,
      },
      actor,
    );

    // Phase 2: 建立 constitution
    const constitution = deps.constitutionStore.create(
      village.id,
      {
        rules: template.constitution.rules.map((r) => ({
          id: r.id,
          description: r.description,
          enforcement: r.enforcement,
          scope: r.scope,
        })),
        allowed_permissions: template.constitution.allowed_permissions,
        budget_limits: template.constitution.budget,
      },
      actor,
    );

    // Phase 3+4: 對每個 chief 解析 skills 並建立 chief
    const chiefIds: string[] = [];
    const skillIds: string[] = [];
    const seenSkillIds = new Set<string>();

    for (const chiefDef of template.chiefs) {
      // 解析該 chief 的 skills
      const bindings: Array<{ skill_id: string; skill_version: number }> = [];
      for (const skillName of chiefDef.skills) {
        const skill = deps.skillRegistry.resolveForIntent(skillName, village.id);
        if (!skill) {
          throw new Error(`Skill "${skillName}" not found or not verified`);
        }
        bindings.push({ skill_id: skill.id, skill_version: skill.version });
        if (!seenSkillIds.has(skill.id)) {
          seenSkillIds.add(skill.id);
          skillIds.push(skill.id);
        }
      }

      // 建立 chief
      const chief = deps.chiefEngine.create(
        village.id,
        {
          name: chiefDef.name,
          role: chiefDef.role,
          permissions: chiefDef.permissions,
          pipelines: [],
          personality: chiefDef.personality,
          constraints: chiefDef.constraints,
          skills: bindings,
        },
        actor,
      );
      chiefIds.push(chief.id);
    }

    // Phase 5: 建立 market zones
    const zoneIds: string[] = [];
    for (const zoneDef of template.market.zones) {
      const zone = deps.zoneManager.create(
        village.id,
        { name: zoneDef.name, type: zoneDef.type, capacity: zoneDef.capacity },
        actor,
      );
      zoneIds.push(zone.id);
    }

    return {
      village_id: village.id,
      constitution_id: constitution.id,
      chief_ids: chiefIds,
      skill_ids: skillIds,
      zone_ids: zoneIds,
    };
  })();
}
