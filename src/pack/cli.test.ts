import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { parseArgs, runCli, formatResult } from './cli';
import type { CliOptions } from './cli';
import type { CompileResult } from './compiler';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { SkillRegistry } from '../skill-registry';

// ── Helpers ──────────────────────────────────────────────────

const TMP_DIR = join(tmpdir(), `thyra-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

function tmpFile(name: string): string {
  return join(TMP_DIR, name);
}

/** 建立 valid YAML 內容 */
function validYaml(): Record<string, unknown> {
  return {
    pack_version: '0.1',
    village: {
      name: 'cli-test-village',
      description: 'CLI test',
      target_repo: 'org/repo',
    },
    constitution: {
      rules: [{ description: 'Test rule', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget: {
        max_cost_per_action: 10,
        max_cost_per_day: 100,
        max_cost_per_loop: 50,
      },
    },
    chief: {
      name: 'cli-chief',
      role: 'tester',
      permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      personality: {
        risk_tolerance: 'moderate',
        communication_style: 'concise',
        decision_speed: 'deliberate',
      },
      constraints: [],
    },
    skills: ['test-skill'],
    laws: [
      {
        category: 'testing',
        content: {
          description: 'All PRs need tests',
          strategy: { min_coverage: 80 },
        },
        evidence: { source: 'team', reasoning: 'quality' },
      },
    ],
  };
}

/** 建立一個已驗證 skill 到指定 DB */
function seedSkill(dbPath: string, name: string): void {
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);

  const registry = new SkillRegistry(db);
  const skill = registry.create(
    {
      name,
      village_id: undefined,
      definition: {
        description: `${name} skill`,
        prompt_template: `Do ${name}`,
        tools_required: [],
        constraints: [],
        examples: [],
      },
    },
    'test-seed',
  );
  registry.verify(skill.id, 'test-seed');
  db.close();
}

// ── Cleanup ──────────────────────────────────────────────────

const filesToClean: string[] = [];

function writeYaml(name: string, content: unknown): string {
  ensureTmpDir();
  const path = tmpFile(name);
  writeFileSync(path, yaml.dump(content), 'utf-8');
  filesToClean.push(path);
  return path;
}

function cleanupFiles(): void {
  for (const f of filesToClean) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  filesToClean.length = 0;
}

// ── Tests ────────────────────────────────────────────────────

describe('CLI parseArgs', () => {
  it('parses apply command', () => {
    const opts = parseArgs(['bun', 'cli.ts', 'apply', 'village.yaml']);
    expect(opts.command).toBe('apply');
    expect(opts.filePath).toBe('village.yaml');
  });

  it('parses diff command', () => {
    const opts = parseArgs(['bun', 'cli.ts', 'diff', 'my.yaml']);
    expect(opts.command).toBe('diff');
    expect(opts.filePath).toBe('my.yaml');
  });

  it('parses --db flag', () => {
    const opts = parseArgs(['bun', 'cli.ts', 'apply', 'v.yaml', '--db', '/tmp/test.db']);
    expect(opts.dbPath).toContain('test.db');
  });

  it('throws on missing command', () => {
    expect(() => parseArgs(['bun', 'cli.ts'])).toThrow('Usage');
  });

  it('throws on invalid command', () => {
    expect(() => parseArgs(['bun', 'cli.ts', 'destroy', 'v.yaml'])).toThrow('Usage');
  });

  it('throws on missing file', () => {
    expect(() => parseArgs(['bun', 'cli.ts', 'apply'])).toThrow('Usage');
  });
});

describe('CLI runCli', () => {
  afterEach(() => {
    cleanupFiles();
  });

  it('apply with valid YAML creates village', () => {
    const yamlPath = writeYaml('valid-apply.yaml', validYaml());
    const dbPath = tmpFile('apply-test.db');
    filesToClean.push(dbPath);

    // Seed skill first
    seedSkill(dbPath, 'test-skill');

    const result = runCli({ command: 'apply', filePath: yamlPath, dbPath });

    expect(result.completed_phases).toBe(5);
    expect(result.errors).toHaveLength(0);
    expect(result.session.dry_run).toBe(false);
    expect(result.village.action).toBe('create');
    expect(result.village.entity_id).toBeTruthy();
    expect(result.constitution.action).toBe('create');
    expect(result.chief.action).toBe('create');
    expect(result.laws.entries).toHaveLength(1);
    expect(result.laws.entries[0].action).toBe('propose');
  });

  it('diff shows changes without modifying DB', () => {
    const yamlPath = writeYaml('valid-diff.yaml', validYaml());
    const dbPath = tmpFile('diff-test.db');
    filesToClean.push(dbPath);

    // Seed skill first
    seedSkill(dbPath, 'test-skill');

    const result = runCli({ command: 'diff', filePath: yamlPath, dbPath });

    expect(result.completed_phases).toBe(5);
    expect(result.errors).toHaveLength(0);
    expect(result.session.dry_run).toBe(true);
    expect(result.village.action).toBe('create');
    expect(result.village.detail).toContain('would create');

    // Verify DB has no villages
    const db = new Database(dbPath);
    const rows = db.query('SELECT COUNT(*) as cnt FROM villages').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
    db.close();
  });

  it('throws on invalid YAML content', () => {
    const invalidData = {
      pack_version: '999',  // Invalid version
      village: { name: '' },
    };
    const yamlPath = writeYaml('invalid.yaml', invalidData);
    const dbPath = tmpFile('invalid-test.db');
    filesToClean.push(dbPath);

    expect(() =>
      runCli({ command: 'apply', filePath: yamlPath, dbPath }),
    ).toThrow('Validation failed');
  });

  it('throws on missing file', () => {
    const dbPath = tmpFile('missing-test.db');
    filesToClean.push(dbPath);

    expect(() =>
      runCli({ command: 'apply', filePath: '/nonexistent/village.yaml', dbPath }),
    ).toThrow('File not found');
  });

  it('apply is idempotent on second run', () => {
    const yamlPath = writeYaml('idempotent.yaml', validYaml());
    const dbPath = tmpFile('idempotent-test.db');
    filesToClean.push(dbPath);

    seedSkill(dbPath, 'test-skill');

    // First apply
    const r1 = runCli({ command: 'apply', filePath: yamlPath, dbPath });
    expect(r1.completed_phases).toBe(5);
    expect(r1.errors).toHaveLength(0);
    expect(r1.village.action).toBe('create');

    // Second apply — same YAML
    const r2 = runCli({ command: 'apply', filePath: yamlPath, dbPath });
    expect(r2.completed_phases).toBe(5);
    expect(r2.errors).toHaveLength(0);
    expect(r2.village.action).toBe('skip');
    expect(r2.constitution.action).toBe('skip');
    expect(r2.chief.action).toBe('skip');
    expect(r2.laws.entries[0].action).toBe('skip');
  });
});

describe('formatResult', () => {
  it('formats apply result', () => {
    const result: CompileResult = {
      session: {
        session_id: 'pack-test-123',
        pack_fingerprint: 'abcdef1234567890',
        pack_version: '0.1',
        source_path: '/tmp/test.yaml',
        compiled_at: '2026-01-01T00:00:00.000Z',
        compiled_by: 'village-pack:human',
        dry_run: false,
      },
      village: { action: 'create', entity_id: 'v-1' },
      constitution: { action: 'create', entity_id: 'c-1' },
      skills: { action: 'resolve', resolved: [{ name: 'code-review', skill_id: 's-1' }], detail: 'resolved 1 skill(s)' },
      chief: { action: 'create', entity_id: 'ch-1' },
      laws: { entries: [{ category: 'testing', action: 'propose', law_id: 'l-1' }] },
      errors: [],
      warnings: [],
      completed_phases: 5,
    };

    const output = formatResult(result);

    expect(output).toContain('APPLY');
    expect(output).toContain('pack-test-123');
    expect(output).toContain('5/5');
    expect(output).toContain('Village: create');
    expect(output).toContain('Constitution: create');
    expect(output).toContain('Chief: create');
    expect(output).toContain('code-review');
    expect(output).toContain('testing');
  });

  it('formats dry-run result', () => {
    const result: CompileResult = {
      session: {
        session_id: 'pack-dry-456',
        pack_fingerprint: 'aaaa1111bbbb2222',
        pack_version: '0.1',
        source_path: '/tmp/dry.yaml',
        compiled_at: '2026-01-01T00:00:00.000Z',
        compiled_by: 'village-pack:human',
        dry_run: true,
      },
      village: { action: 'create', detail: 'would create village "test"' },
      constitution: { action: 'create', detail: 'would create constitution' },
      skills: { action: 'resolve', resolved: [], detail: 'resolved 0 skill(s)' },
      chief: { action: 'create', detail: 'would create chief "test"' },
      laws: { entries: [] },
      errors: [],
      warnings: [],
      completed_phases: 5,
    };

    const output = formatResult(result);
    expect(output).toContain('DRY-RUN');
    expect(output).toContain('would create');
  });

  it('formats errors and warnings', () => {
    const result: CompileResult = {
      session: {
        session_id: 'pack-err',
        pack_fingerprint: 'eeee',
        pack_version: '0.1',
        source_path: '/tmp/err.yaml',
        compiled_at: '2026-01-01T00:00:00.000Z',
        compiled_by: 'village-pack:human',
        dry_run: false,
      },
      village: { action: 'create', entity_id: 'v-1' },
      constitution: { action: 'skip' },
      skills: { action: 'resolve', resolved: [] },
      chief: { action: 'skip' },
      laws: { entries: [] },
      errors: ['Something broke'],
      warnings: ['Check this'],
      completed_phases: 2,
    };

    const output = formatResult(result);
    expect(output).toContain('ERRORS:');
    expect(output).toContain('Something broke');
    expect(output).toContain('WARNINGS:');
    expect(output).toContain('Check this');
    expect(output).toContain('2/5');
  });
});
