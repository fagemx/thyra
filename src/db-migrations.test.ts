import { describe, it, expect } from 'vitest';
import { createDb, initSchema } from './db';

/**
 * Migration runner tests (#357).
 *
 * Tests the schema_version table and migration execution logic
 * introduced when consolidating ALTER TABLE blocks into initSchema.
 */
describe('db migrations', () => {
  it('fresh DB sets schema_version to latest after initSchema', () => {
    const db = createDb(':memory:');
    initSchema(db);

    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    expect(row).toBeTruthy();
    // Version should be >= 1 (current latest migration)
    expect(row.version).toBeGreaterThanOrEqual(1);
  });

  it('initSchema is idempotent — calling twice does not error', () => {
    const db = createDb(':memory:');
    initSchema(db);
    // Second call should not throw
    expect(() => initSchema(db)).not.toThrow();

    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    expect(row.version).toBeGreaterThanOrEqual(1);
  });

  it('schema_version table has exactly one row after initSchema', () => {
    const db = createDb(':memory:');
    initSchema(db);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM schema_version').get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it('calling initSchema three times still has one schema_version row', () => {
    const db = createDb(':memory:');
    initSchema(db);
    initSchema(db);
    initSchema(db);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM schema_version').get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it('migration v1 columns exist on villages table after initSchema', () => {
    const db = createDb(':memory:');
    initSchema(db);

    // last_health_score should be a column on villages (added in migration v1 / CREATE TABLE)
    const cols = db.prepare("PRAGMA table_info('villages')").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('last_health_score');
  });

  it('migration v1 columns exist on chiefs table after initSchema', () => {
    const db = createDb(':memory:');
    initSchema(db);

    const cols = db.prepare("PRAGMA table_info('chiefs')").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('pipelines');
    expect(colNames).toContain('adapter_type');
    expect(colNames).toContain('budget_config');
    expect(colNames).toContain('role_type');
    expect(colNames).toContain('use_precedents');
    expect(colNames).toContain('last_heartbeat_at');
    expect(colNames).toContain('timeout_count');
  });

  it('migration v1 columns exist on skills table after initSchema', () => {
    const db = createDb(':memory:');
    initSchema(db);

    const cols = db.prepare("PRAGMA table_info('skills')").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('content');
    expect(colNames).toContain('source_type');
    expect(colNames).toContain('scope_type');
    expect(colNames).toContain('tags');
    expect(colNames).toContain('used_count');
  });

  it('migration v1 intent column exists on loop_cycles after initSchema', () => {
    const db = createDb(':memory:');
    initSchema(db);

    const cols = db.prepare("PRAGMA table_info('loop_cycles')").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('intent');
  });

  it('old DB without added columns gets upgraded by migration', () => {
    const db = createDb(':memory:');

    // Simulate an "old" database: create tables without the new columns
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
      INSERT INTO schema_version (version) VALUES (0);
    `);

    // Create a minimal villages table WITHOUT last_health_score
    db.run(`
      CREATE TABLE IF NOT EXISTS villages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        target_repo TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Create a minimal chiefs table WITHOUT the new columns
    db.run(`
      CREATE TABLE IF NOT EXISTS chiefs (
        id TEXT PRIMARY KEY,
        village_id TEXT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        model TEXT NOT NULL DEFAULT 'gpt-4',
        system_prompt TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '{}',
        constraints TEXT NOT NULL DEFAULT '[]',
        profile TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Create a minimal skills table WITHOUT the new columns
    db.run(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        village_id TEXT,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        verified_at TEXT,
        version INTEGER NOT NULL DEFAULT 1
      );
    `);

    // Create a minimal loop_cycles table WITHOUT intent
    db.run(`
      CREATE TABLE IF NOT EXISTS loop_cycles (
        id TEXT PRIMARY KEY,
        chief_id TEXT NOT NULL,
        village_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        observations TEXT NOT NULL DEFAULT '[]',
        proposals TEXT NOT NULL DEFAULT '[]',
        laws_proposed TEXT NOT NULL DEFAULT '[]',
        laws_enacted TEXT NOT NULL DEFAULT '[]',
        abort_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Verify columns don't exist yet
    const villageColsBefore = db.prepare("PRAGMA table_info('villages')").all() as Array<{ name: string }>;
    expect(villageColsBefore.map((c) => c.name)).not.toContain('last_health_score');

    // Now run initSchema — migration should add the missing columns
    initSchema(db);

    // Verify columns were added
    const villageCols = db.prepare("PRAGMA table_info('villages')").all() as Array<{ name: string }>;
    expect(villageCols.map((c) => c.name)).toContain('last_health_score');

    const chiefCols = db.prepare("PRAGMA table_info('chiefs')").all() as Array<{ name: string }>;
    const chiefColNames = chiefCols.map((c) => c.name);
    expect(chiefColNames).toContain('pipelines');
    expect(chiefColNames).toContain('adapter_type');
    expect(chiefColNames).toContain('role_type');
    expect(chiefColNames).toContain('timeout_count');

    const skillCols = db.prepare("PRAGMA table_info('skills')").all() as Array<{ name: string }>;
    expect(skillCols.map((c) => c.name)).toContain('content');
    expect(skillCols.map((c) => c.name)).toContain('source_type');

    const cycleCols = db.prepare("PRAGMA table_info('loop_cycles')").all() as Array<{ name: string }>;
    expect(cycleCols.map((c) => c.name)).toContain('intent');

    // Verify schema_version updated
    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    expect(row.version).toBe(1);
  });

  it('already-migrated DB skips migration on re-run', () => {
    const db = createDb(':memory:');
    initSchema(db);

    // Verify version is 1
    const rowBefore = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    expect(rowBefore.version).toBe(1);

    // Run again — should not error and version stays same
    initSchema(db);
    const rowAfter = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    expect(rowAfter.version).toBe(1);
  });
});
