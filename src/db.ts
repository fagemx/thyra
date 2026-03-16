import { Database } from 'bun:sqlite';
import path from 'path';

export type { Database } from 'bun:sqlite';

export function createDb(dbPath?: string): Database {
  const db = new Database(dbPath ?? path.join(process.cwd(), 'thyra.db'));
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

export function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS villages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_repo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','paused','archived')),
      metadata TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      event_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_entity
      ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_time
      ON audit_log(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_id
      ON audit_log(event_id) WHERE event_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','verified','deprecated')),
      village_id TEXT REFERENCES villages(id),
      definition TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      verified_at TEXT,
      verified_by TEXT,
      UNIQUE(name, version, village_id)
    );

    CREATE INDEX IF NOT EXISTS idx_skill_village ON skills(village_id, status);
    CREATE INDEX IF NOT EXISTS idx_skill_name ON skills(name, version);

    CREATE TABLE IF NOT EXISTS constitutions (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','revoked','superseded')),
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      rules TEXT NOT NULL DEFAULT '[]',
      allowed_permissions TEXT NOT NULL DEFAULT '[]',
      budget_limits TEXT NOT NULL DEFAULT '{}',
      superseded_by TEXT,
      UNIQUE(village_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_const_village
      ON constitutions(village_id, status);

    CREATE TABLE IF NOT EXISTS chiefs (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','inactive')),
      skills TEXT NOT NULL DEFAULT '[]',
      permissions TEXT NOT NULL DEFAULT '[]',
      personality TEXT NOT NULL DEFAULT '{}',
      constraints TEXT NOT NULL DEFAULT '[]',
      profile TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chief_village ON chiefs(village_id, status);

    CREATE TABLE IF NOT EXISTS laws (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      proposed_by TEXT NOT NULL,
      approved_by TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK(status IN ('proposed','active','revoked','rolled_back','rejected')),
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('low','medium','high')),
      evidence TEXT NOT NULL DEFAULT '{}',
      effectiveness TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_law_village ON laws(village_id, status);
    CREATE INDEX IF NOT EXISTS idx_law_category ON laws(village_id, category);

    CREATE TABLE IF NOT EXISTS loop_cycles (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      chief_id TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK(trigger IN ('scheduled','event','manual')),
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running','completed','timeout','aborted')),
      version INTEGER NOT NULL DEFAULT 1,
      budget_remaining REAL NOT NULL DEFAULT 0,
      cost_incurred REAL NOT NULL DEFAULT 0,
      iterations INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 10,
      timeout_ms INTEGER NOT NULL DEFAULT 300000,
      actions TEXT NOT NULL DEFAULT '[]',
      laws_proposed TEXT NOT NULL DEFAULT '[]',
      laws_enacted TEXT NOT NULL DEFAULT '[]',
      abort_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cycle_village ON loop_cycles(village_id, status);

    CREATE TABLE IF NOT EXISTS territories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      village_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','dissolved')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agreements (
      id TEXT PRIMARY KEY,
      territory_id TEXT NOT NULL REFERENCES territories(id),
      type TEXT NOT NULL CHECK(type IN ('resource_sharing','law_template','chief_lending','budget_pool')),
      parties TEXT NOT NULL DEFAULT '[]',
      terms TEXT NOT NULL DEFAULT '{}',
      approved_by TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','active','revoked')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agreement_territory ON agreements(territory_id, status);

    CREATE TABLE IF NOT EXISTS skill_shares (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id),
      from_village_id TEXT NOT NULL REFERENCES villages(id),
      to_village_id TEXT NOT NULL REFERENCES villages(id),
      territory_id TEXT NOT NULL REFERENCES territories(id),
      agreement_id TEXT NOT NULL REFERENCES agreements(id),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','revoked')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_skill_shares_to_village
      ON skill_shares(to_village_id, status);
    CREATE INDEX IF NOT EXISTS idx_skill_shares_territory
      ON skill_shares(territory_id, status);

    CREATE TABLE IF NOT EXISTS board_mappings (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL UNIQUE REFERENCES villages(id),
      board_namespace TEXT NOT NULL,
      karvi_url TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_board_mapping_village
      ON board_mappings(village_id);

    CREATE TABLE IF NOT EXISTS territory_policies (
      id TEXT PRIMARY KEY,
      territory_id TEXT NOT NULL REFERENCES territories(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enforcement TEXT NOT NULL DEFAULT 'soft'
        CHECK(enforcement IN ('hard','soft')),
      scope TEXT NOT NULL DEFAULT '["*"]',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','revoked')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_territory_policy
      ON territory_policies(territory_id, status);

    CREATE TABLE IF NOT EXISTS world_snapshots (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      trigger TEXT NOT NULL CHECK(trigger IN ('manual','cycle_end','pre_change')),
      snapshot TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshot_village
      ON world_snapshots(village_id, created_at);
  `);

  // ALTER TABLE 新增 intent 欄位（冪等：column 已存在就忽略）
  try {
    db.run('ALTER TABLE loop_cycles ADD COLUMN intent TEXT DEFAULT NULL');
  } catch {
    // "duplicate column name: intent" — 安全忽略
  }

  // Skill extension columns (#219)
  const skillAlters = [
    "ALTER TABLE skills ADD COLUMN content TEXT DEFAULT NULL",
    "ALTER TABLE skills ADD COLUMN source_type TEXT NOT NULL DEFAULT 'system'",
    "ALTER TABLE skills ADD COLUMN source_origin TEXT DEFAULT NULL",
    "ALTER TABLE skills ADD COLUMN source_author TEXT DEFAULT NULL",
    "ALTER TABLE skills ADD COLUMN forked_from TEXT DEFAULT NULL",
    "ALTER TABLE skills ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'global'",
    "ALTER TABLE skills ADD COLUMN team_id TEXT DEFAULT NULL",
    "ALTER TABLE skills ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE skills ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE skills ADD COLUMN last_used_at TEXT DEFAULT NULL",
  ];
  for (const sql of skillAlters) {
    try { db.run(sql); } catch { /* column already exists */ }
  }
}

/**
 * Append-only audit log（THY-07）
 */
export function appendAudit(
  db: Database,
  entityType: string,
  entityId: string,
  action: string,
  payload: unknown,
  actor: string,
): void {
  db.prepare(`
    INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entityType, entityId, action, JSON.stringify(payload), actor, new Date().toISOString());
}
