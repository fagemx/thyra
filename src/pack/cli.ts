/**
 * Village Pack CLI — apply / diff 指令入口
 *
 * Usage:
 *   bun run src/pack/cli.ts apply <village.yaml>
 *   bun run src/pack/cli.ts diff  <village.yaml>
 *
 * apply: 解析 YAML，執行 compiler，寫入 DB。
 * diff:  dry-run 模式，只顯示 diff 不寫入。
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { parseVillagePack } from '../schemas/village-pack';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { SkillRegistry } from '../skill-registry';
import { VillagePackCompiler } from './compiler';
import type { VillagePack as CompilerPack } from './compiler';
import type { CompileResult, PhaseResult, LawPhaseEntry } from './compiler';
import type { VillagePack as SchemaPack } from '../schemas/village-pack';

// ── Transform: schema shape → compiler shape ─────────────────

/**
 * parseVillagePack 產出的型別和 compiler 的 VillagePack 不同。
 * 這裡做映射：pack_version→version, skills 移入 chief, laws.content 攤平。
 */
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

// ── DB + DI bootstrap ────────────────────────────────────────

interface BootstrapResult {
  compiler: VillagePackCompiler;
  db: Database;
}

function bootstrap(dbPath: string): BootstrapResult {
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);

  const villageMgr = new VillageManager(db);
  const constitutionStore = new ConstitutionStore(db);
  const skillRegistry = new SkillRegistry(db);
  const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
  const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);

  const compiler = new VillagePackCompiler(
    villageMgr,
    constitutionStore,
    chiefEngine,
    lawEngine,
    skillRegistry,
  );

  return { compiler, db };
}

// ── Output formatting ────────────────────────────────────────

function formatPhase(label: string, result: PhaseResult): string {
  const parts = [`  ${label}: ${result.action}`];
  if (result.entity_id) parts.push(`(${result.entity_id})`);
  if (result.detail) parts.push(`— ${result.detail}`);
  return parts.join(' ');
}

function formatLawEntry(entry: LawPhaseEntry): string {
  const parts = [`    [${entry.category}] ${entry.action}`];
  if (entry.law_id) parts.push(`(${entry.law_id})`);
  if (entry.detail) parts.push(`— ${entry.detail}`);
  if (entry.error) parts.push(`ERROR: ${entry.error}`);
  return parts.join(' ');
}

export function formatResult(result: CompileResult): string {
  const lines: string[] = [];

  // Header
  const mode = result.session.dry_run ? 'DRY-RUN' : 'APPLY';
  lines.push(`\n=== Village Pack ${mode} ===`);
  lines.push(`Session:     ${result.session.session_id}`);
  lines.push(`Fingerprint: ${result.session.pack_fingerprint}`);
  lines.push(`Version:     ${result.session.pack_version}`);
  lines.push(`Source:      ${result.session.source_path}`);
  lines.push(`Compiled by: ${result.session.compiled_by}`);
  lines.push(`Compiled at: ${result.session.compiled_at}`);
  lines.push('');

  // Phases
  lines.push(`Phases completed: ${result.completed_phases}/5`);
  lines.push(formatPhase('Village', result.village));
  lines.push(formatPhase('Constitution', result.constitution));

  // Skills
  const skillParts = [`  Skills: ${result.skills.action}`];
  if (result.skills.detail) skillParts.push(`— ${result.skills.detail}`);
  lines.push(skillParts.join(' '));
  if (result.skills.resolved.length > 0) {
    for (const s of result.skills.resolved) {
      lines.push(`    ${s.name} → ${s.skill_id}`);
    }
  }

  lines.push(formatPhase('Chief', result.chief));

  // Laws
  lines.push('  Laws:');
  if (result.laws.entries.length === 0) {
    lines.push('    (none)');
  } else {
    for (const entry of result.laws.entries) {
      lines.push(formatLawEntry(entry));
    }
  }

  // Errors & warnings
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('ERRORS:');
    for (const e of result.errors) {
      lines.push(`  - ${e}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const w of result.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────

export interface CliOptions {
  command: 'apply' | 'diff';
  filePath: string;
  dbPath: string;
}

export function parseArgs(args: string[]): CliOptions {
  // args = process.argv: [bun, script, command, file, ...flags]
  const command = args[2];
  const filePath = args[3];

  if (!command || !['apply', 'diff'].includes(command)) {
    throw new Error(
      'Usage: bun run src/pack/cli.ts <apply|diff> <village.yaml> [--db <path>]',
    );
  }
  if (!filePath) {
    throw new Error(
      'Usage: bun run src/pack/cli.ts <apply|diff> <village.yaml> [--db <path>]',
    );
  }

  // Optional --db flag
  let dbPath = resolve(process.cwd(), 'thyra.db');
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && args[dbIdx + 1]) {
    dbPath = resolve(args[dbIdx + 1]);
  }

  return { command: command as 'apply' | 'diff', filePath, dbPath };
}

export function runCli(opts: CliOptions): CompileResult {
  const absPath = resolve(opts.filePath);

  // 1. Check file exists
  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  // 2. Read & parse YAML
  const raw = readFileSync(absPath, 'utf-8');
  const yamlObj = yaml.load(raw);

  // 3. Validate with Zod schema
  const parseResult = parseVillagePack(yamlObj);
  if (!parseResult.success) {
    const msg = parseResult.errors
      .map((e) => `  [${e.rule}] ${e.path}: ${e.message}`)
      .join('\n');
    throw new Error(`Validation failed:\n${msg}`);
  }

  // 4. Transform to compiler shape
  const compilerPack = toCompilerPack(parseResult.data);

  // 5. Bootstrap DB + stores
  const { compiler } = bootstrap(opts.dbPath);

  // 6. Compile
  const dryRun = opts.command === 'diff';
  const result = compiler.compile(compilerPack, {
    dry_run: dryRun,
    source_path: absPath,
    compiled_by: 'village-pack:human',
  });

  return result;
}

// ── Entry point ──────────────────────────────────────────────

if (import.meta.main) {
  try {
    const opts = parseArgs(process.argv);
    const result = runCli(opts);
    console.log(formatResult(result));
    process.exit(result.errors.length > 0 ? 1 : 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}
