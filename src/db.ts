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
        CHECK(status IN ('active','inactive','paused')),
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

    -- Market domain tables (B1)

    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('main_street','side_alley','stage','entrance')),
      capacity INTEGER NOT NULL,
      current_load INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_zone_village ON zones(village_id, status);

    CREATE TABLE IF NOT EXISTS stalls (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      zone_id TEXT NOT NULL REFERENCES zones(id),
      name TEXT NOT NULL,
      owner TEXT,
      category TEXT,
      rank INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','spotlight','closed')),
      metadata TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stall_village ON stalls(village_id, status);
    CREATE INDEX IF NOT EXISTS idx_stall_zone ON stalls(zone_id);

    CREATE TABLE IF NOT EXISTS event_slots (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      zone_id TEXT REFERENCES zones(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      capacity INTEGER,
      booked INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','full','active','ended')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slot_village ON event_slots(village_id, status);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      stall_id TEXT REFERENCES stalls(id),
      slot_id TEXT REFERENCES event_slots(id),
      buyer TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('purchase','booking','commission')),
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_village ON orders(village_id, status);

    CREATE TABLE IF NOT EXISTS market_metrics (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      timestamp TEXT NOT NULL,
      total_visitors INTEGER NOT NULL DEFAULT 0,
      active_stalls INTEGER NOT NULL DEFAULT 0,
      active_events INTEGER NOT NULL DEFAULT 0,
      revenue REAL NOT NULL DEFAULT 0,
      incidents INTEGER NOT NULL DEFAULT 0,
      satisfaction REAL NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_village ON market_metrics(village_id, timestamp);

    -- Goal hierarchy (issue #225)
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      level TEXT NOT NULL CHECK(level IN ('world','team','chief','task')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','achieved','cancelled')),
      parent_id TEXT REFERENCES goals(id),
      owner_chief_id TEXT REFERENCES chiefs(id),
      metrics TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goal_village ON goals(village_id, status);
    CREATE INDEX IF NOT EXISTS idx_goal_parent ON goals(parent_id);
    CREATE INDEX IF NOT EXISTS idx_goal_chief ON goals(owner_chief_id);

    -- Cycle telemetry (#232: per-operation timing for governance cycles)
    CREATE TABLE IF NOT EXISTS cycle_telemetry (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      chief_id TEXT NOT NULL,
      village_id TEXT NOT NULL,
      total_duration_ms INTEGER NOT NULL,
      operations TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_village
      ON cycle_telemetry(village_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_telemetry_chief
      ON cycle_telemetry(chief_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_telemetry_cycle
      ON cycle_telemetry(cycle_id);
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

  // ALTER TABLE 新增 pipelines 欄位（冪等：column 已存在就忽略）
  try {
    db.run("ALTER TABLE chiefs ADD COLUMN pipelines TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // "duplicate column name: pipelines" — 安全忽略
  }

  // Heartbeat protocol columns (#228)
  const chiefHeartbeatAlters = [
    "ALTER TABLE chiefs ADD COLUMN adapter_type TEXT NOT NULL DEFAULT 'local'",
    "ALTER TABLE chiefs ADD COLUMN context_mode TEXT NOT NULL DEFAULT 'fat'",
    "ALTER TABLE chiefs ADD COLUMN adapter_config TEXT NOT NULL DEFAULT '{}'",
  ];
  for (const sql of chiefHeartbeatAlters) {
    try { db.run(sql); } catch { /* column already exists */ }
  }

  // Chief budget columns (#226: monthly budget accumulation with auto-pause)
  const chiefBudgetAlters = [
    "ALTER TABLE chiefs ADD COLUMN budget_config TEXT DEFAULT NULL",
    "ALTER TABLE chiefs ADD COLUMN pause_reason TEXT DEFAULT NULL",
    "ALTER TABLE chiefs ADD COLUMN paused_at TEXT DEFAULT NULL",
  ];
  for (const sql of chiefBudgetAlters) {
    try { db.run(sql); } catch { /* column already exists */ }
  }

  // Stale heartbeat detection columns (#231)
  const chiefStaleAlters = [
    "ALTER TABLE chiefs ADD COLUMN last_heartbeat_at TEXT DEFAULT NULL",
    "ALTER TABLE chiefs ADD COLUMN current_run_id TEXT DEFAULT NULL",
    "ALTER TABLE chiefs ADD COLUMN current_run_status TEXT NOT NULL DEFAULT 'idle'",
    "ALTER TABLE chiefs ADD COLUMN timeout_count INTEGER NOT NULL DEFAULT 0",
  ];
  for (const sql of chiefStaleAlters) {
    try { db.run(sql); } catch { /* column already exists */ }
  }

  // Alert system tables (#236)
  db.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      type TEXT NOT NULL CHECK(type IN (
        'budget_warning','chief_timeout','consecutive_rollbacks',
        'high_risk_proposal','health_drop','anomaly'
      )),
      severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical','emergency')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN (
        'active','acknowledged','resolved','auto_resolved','expired'
      )),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      resolved_at TEXT,
      auto_action_taken TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_village ON alerts(village_id, status);
    CREATE INDEX IF NOT EXISTS idx_alert_type ON alerts(village_id, type, status);
    CREATE INDEX IF NOT EXISTS idx_alert_severity ON alerts(village_id, severity);

    CREATE TABLE IF NOT EXISTS alert_webhooks (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL REFERENCES villages(id),
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      secret TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      last_delivery_at TEXT,
      last_delivery_status TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_village ON alert_webhooks(village_id, status);
  `);

  // Health delta tracking column (#236)
  try {
    db.run('ALTER TABLE villages ADD COLUMN last_health_score INTEGER DEFAULT NULL');
  } catch {
    // column already exists
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
