/**
 * Village Pack apply endpoint — Volva settlement 整合入口
 *
 * POST /api/villages/pack/apply
 * Body: { yaml: string }
 *
 * 原子建立 village + constitution + skills + chief + laws。
 * 任一步失敗 → 整體 rollback。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import yaml from 'js-yaml';
import type { Database } from 'bun:sqlite';
import { parseVillagePack } from '../schemas/village-pack';
import type { VillagePack as SchemaPack } from '../schemas/village-pack';
import { VillagePackCompiler } from '../pack/compiler';
import type { VillagePack as CompilerPack } from '../pack/compiler';
import type { VillageManager } from '../village-manager';
import type { ConstitutionStore } from '../constitution-store';
import type { ChiefEngine } from '../chief-engine';
import type { LawEngine } from '../law-engine';
import type { SkillRegistry } from '../skill-registry';

// ── Input schema ──────────────────────────────────────────────

const PackApplyInput = z.object({
  yaml: z.string().min(1, 'YAML string must be non-empty'),
});

// ── Transform: schema shape → compiler shape ──────────────────
// 與 cli.ts 相同的映射邏輯

function toCompilerPack(parsed: SchemaPack): CompilerPack {
  return {
    version: parsed.pack_version,
    village: {
      name: parsed.village.name,
      description: parsed.village.description,
      target_repo: parsed.village.target_repo,
    },
    constitution: {
      allowed_permissions: parsed.constitution.allowed_permissions,
      budget: parsed.constitution.budget,
      rules: parsed.constitution.rules.map((r) => ({
        description: r.description,
        enforcement: r.enforcement,
        scope: r.scope,
      })),
    },
    chief: {
      name: parsed.chief.name,
      role: parsed.chief.role,
      permissions: parsed.chief.permissions,
      personality: parsed.chief.personality,
      constraints: parsed.chief.constraints,
      skills: parsed.skills,
    },
    laws: parsed.laws.map((l) => ({
      category: l.category,
      description: l.content.description,
      strategy: l.content.strategy,
      evidence: l.evidence,
    })),
  };
}

// ── Route factory ────────────────────────────────────────────

export interface PackRouteDeps {
  db: Database;
  villageMgr: VillageManager;
  constitutionStore: ConstitutionStore;
  chiefEngine: ChiefEngine;
  lawEngine: LawEngine;
  skillRegistry: SkillRegistry;
}

export function packRoutes(deps: PackRouteDeps): Hono {
  const app = new Hono();
  const { db, villageMgr, constitutionStore, chiefEngine, lawEngine, skillRegistry } = deps;

  const compiler = new VillagePackCompiler(
    villageMgr,
    constitutionStore,
    chiefEngine,
    lawEngine,
    skillRegistry,
  );

  app.post('/api/villages/pack/apply', async (c) => {
    // 1. Validate request body
    const bodyParsed = PackApplyInput.safeParse(await c.req.json());
    if (!bodyParsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: bodyParsed.error.message } },
        400,
      );
    }

    // 2. Parse YAML
    let yamlObj: unknown;
    try {
      yamlObj = yaml.load(bodyParsed.data.yaml);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json(
        { ok: false, error: { code: 'YAML_PARSE_ERROR', message: msg } },
        400,
      );
    }

    // 3. Validate against Village Pack schema
    const packResult = parseVillagePack(yamlObj);
    if (!packResult.success) {
      const msg = packResult.errors
        .map((e) => `[${e.rule}] ${e.path}: ${e.message}`)
        .join('; ');
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: msg } },
        400,
      );
    }

    // 4. Transform to compiler shape
    const compilerPack = toCompilerPack(packResult.data);

    // 5. Compile inside transaction for atomicity
    try {
      const result = db.transaction(() => {
        const r = compiler.compile(compilerPack, {
          dry_run: false,
          source_path: 'api:pack/apply',
          compiled_by: 'village-pack:api',
        });

        // 如果有錯誤，拋出以觸發 rollback
        if (r.errors.length > 0) {
          const errorMsg = r.errors.join('; ');
          throw new PackCompileError(errorMsg, r.completed_phases);
        }

        return r;
      })();

      // 6. 成功 → 201
      return c.json({
        ok: true,
        data: {
          village_id: result.village.entity_id,
          constitution_id: result.constitution.entity_id,
          chief_id: result.chief.entity_id,
          skills: result.skills.resolved.map((s) => ({
            name: s.name,
            skill_id: s.skill_id,
          })),
        },
      }, 201);
    } catch (err) {
      if (err instanceof PackCompileError) {
        return c.json(
          { ok: false, error: { code: 'COMPILE_ERROR', message: err.message } },
          400,
        );
      }
      throw err; // 讓 Hono onError 處理
    }
  });

  return app;
}

// ── Error class ─────────────────────────────────────────────

class PackCompileError extends Error {
  readonly completed_phases: number;

  constructor(message: string, completedPhases: number) {
    super(message);
    this.name = 'PackCompileError';
    this.completed_phases = completedPhases;
  }
}
