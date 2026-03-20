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
  // 建立 schema 版本追蹤表
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS villages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_repo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','paused','archived')),
      metadata TEXT NOT NULL DEFAULT '{}',
      last_health_score INTEGER DEFAULT NULL,
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
      content TEXT DEFAULT NULL,
      source_type TEXT NOT NULL DEFAULT 'system',
      source_origin TEXT DEFAULT NULL,
      source_author TEXT DEFAULT NULL,
      forked_from TEXT DEFAULT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      team_id TEXT DEFAULT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      used_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT DEFAULT NULL,
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
      pipelines TEXT NOT NULL DEFAULT '[]',
      adapter_type TEXT NOT NULL DEFAULT 'local',
      context_mode TEXT NOT NULL DEFAULT 'fat',
      adapter_config TEXT NOT NULL DEFAULT '{}',
      budget_config TEXT DEFAULT NULL,
      pause_reason TEXT DEFAULT NULL,
      paused_at TEXT DEFAULT NULL,
      role_type TEXT NOT NULL DEFAULT 'chief',
      parent_chief_id TEXT DEFAULT NULL,
      use_precedents INTEGER NOT NULL DEFAULT 0,
      precedent_config TEXT DEFAULT NULL,
      last_heartbeat_at TEXT DEFAULT NULL,
      current_run_id TEXT DEFAULT NULL,
      current_run_status TEXT NOT NULL DEFAULT 'idle',
      timeout_count INTEGER NOT NULL DEFAULT 0,
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
      intent TEXT DEFAULT NULL,
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

    -- Canonical cycle runs (Track C: CYCLE-01, CYCLE-02)
    CREATE TABLE IF NOT EXISTS cycle_runs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      cycle_number INTEGER NOT NULL,
      current_stage TEXT NOT NULL DEFAULT 'idle',
      observe_started_at TEXT,
      observe_completed_at TEXT,
      propose_started_at TEXT,
      propose_completed_at TEXT,
      judge_started_at TEXT,
      judge_completed_at TEXT,
      apply_started_at TEXT,
      apply_completed_at TEXT,
      pulse_started_at TEXT,
      pulse_completed_at TEXT,
      outcome_started_at TEXT,
      outcome_completed_at TEXT,
      precedent_started_at TEXT,
      precedent_completed_at TEXT,
      adjust_started_at TEXT,
      adjust_completed_at TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      failed_at TEXT,
      failed_stage TEXT,
      failure_reason TEXT,
      observation_batch_id TEXT,
      proposal_ids TEXT NOT NULL DEFAULT '[]',
      judgment_report_ids TEXT NOT NULL DEFAULT '[]',
      applied_change_ids TEXT NOT NULL DEFAULT '[]',
      pulse_frame_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_cycle_run_world
      ON cycle_runs(world_id, current_stage);

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

    -- Chief config revisions (#227: config versioning with rollback)
    CREATE TABLE IF NOT EXISTS chief_config_revisions (
      id TEXT PRIMARY KEY,
      chief_id TEXT NOT NULL REFERENCES chiefs(id),
      version INTEGER NOT NULL,
      config_snapshot TEXT NOT NULL,
      changed_by TEXT,
      change_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_revision_chief
      ON chief_config_revisions(chief_id, version);

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

  // Chief reputation table (#216: reputation & reward system)
  db.run(`
    CREATE TABLE IF NOT EXISTS chief_reputation (
      chief_id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 100,
      proposals_applied INTEGER NOT NULL DEFAULT 0,
      proposals_rejected INTEGER NOT NULL DEFAULT 0,
      rollbacks_triggered INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (chief_id) REFERENCES chiefs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_reputation_village
      ON chief_reputation(village_id);
  `);

  // Outcome windows (Track E: OUTCOME-01)
  db.run(`
    CREATE TABLE IF NOT EXISTS outcome_windows (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      applied_change_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'evaluating', 'closed')),
      baseline_snapshot TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      evaluated_at TEXT,
      closed_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outcome_window_world
      ON outcome_windows(world_id, status);
    CREATE INDEX IF NOT EXISTS idx_outcome_window_cycle
      ON outcome_windows(cycle_id);
  `);

  // Precedent records (Track F: PREC-01, PREC-02 — append-only)
  db.run(`
    CREATE TABLE IF NOT EXISTS precedent_records (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      world_type TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      outcome_report_id TEXT NOT NULL,
      change_kind TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      context TEXT NOT NULL,
      decision TEXT NOT NULL,
      outcome TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      lessons_learned TEXT NOT NULL,
      context_tags TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_precedent_world
      ON precedent_records(world_id);
    CREATE INDEX IF NOT EXISTS idx_precedent_cycle
      ON precedent_records(cycle_id);

    -- Governance adjustments (Track G: ADJ-01, ADJ-02)
    CREATE TABLE IF NOT EXISTS governance_adjustments (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      adjustment_type TEXT NOT NULL
        CHECK(adjustment_type IN ('law_threshold','chief_permission','chief_style','risk_policy','simulation_policy')),
      target TEXT NOT NULL,
      before_val TEXT NOT NULL,
      after_val TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK(status IN ('proposed','approved','applied','rejected')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_adjustment_world
      ON governance_adjustments(world_id, status);
  `);

  // Observation batches (Track H Step 2: §10)
  db.run(`
    CREATE TABLE IF NOT EXISTS observation_batches (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      observations TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_obs_batch_cycle
      ON observation_batches(cycle_id);
  `);

  // Canonical proposals (Track H Step 2: §11-§13)
  db.run(`
    CREATE TABLE IF NOT EXISTS canonical_proposals (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK(status IN (
          'draft','proposed','judged','approved','approved_with_constraints',
          'rejected','simulation_required','escalated','deferred',
          'applied','cancelled','rolled_back',
          'outcome_window_open','outcome_closed','archived'
        )),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      judgment_report TEXT,
      applied_change_id TEXT,
      snapshot_before_id TEXT,
      snapshot_after_id TEXT,
      created_by TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      judged_at TEXT,
      applied_at TEXT,
      rolled_back_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_canonical_proposal_cycle
      ON canonical_proposals(cycle_id, status);
    CREATE INDEX IF NOT EXISTS idx_canonical_proposal_world
      ON canonical_proposals(world_id);
  `);

  // Applied changes (Track H Step 2: §13)
  db.run(`
    CREATE TABLE IF NOT EXISTS applied_changes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      snapshot_before_id TEXT,
      snapshot_after_id TEXT,
      status TEXT NOT NULL DEFAULT 'applied'
        CHECK(status IN ('applied','rolled_back')),
      applied_at TEXT NOT NULL,
      rolled_back_at TEXT,
      rollback_reason TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_applied_change_cycle
      ON applied_changes(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_applied_change_proposal
      ON applied_changes(proposal_id);
  `);

  // Promotion handoffs (#341: SQLite persistence)
  db.run(`
    CREATE TABLE IF NOT EXISTS promotion_handoffs (
      id TEXT PRIMARY KEY,
      handoff_json TEXT NOT NULL,
      checklist_json TEXT,
      links_markdown TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promotion_rollbacks (
      id TEXT PRIMARY KEY,
      memo_json TEXT NOT NULL,
      suspend_result_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // Outcome reports (Track H Step 3: §15)
  db.run(`
    CREATE TABLE IF NOT EXISTS outcome_reports (
      id TEXT PRIMARY KEY,
      outcome_window_id TEXT NOT NULL,
      applied_change_id TEXT NOT NULL,
      primary_objective_met INTEGER NOT NULL DEFAULT 0,
      expected_effects TEXT NOT NULL DEFAULT '[]',
      side_effects TEXT NOT NULL DEFAULT '[]',
      verdict TEXT NOT NULL
        CHECK(verdict IN ('beneficial','neutral','harmful','inconclusive')),
      recommendation TEXT NOT NULL
        CHECK(recommendation IN ('reinforce','retune','watch','rollback','do_not_repeat')),
      notes TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outcome_report_window
      ON outcome_reports(outcome_window_id);
    CREATE INDEX IF NOT EXISTS idx_outcome_report_change
      ON outcome_reports(applied_change_id);
  `);

  // Pulse frames (Track H Step 3: §14)
  db.run(`
    CREATE TABLE IF NOT EXISTS pulse_frames (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      cycle_id TEXT,
      health_score REAL NOT NULL,
      mode TEXT NOT NULL,
      stability TEXT NOT NULL,
      sub_scores TEXT NOT NULL DEFAULT '{}',
      dominant_concerns TEXT NOT NULL DEFAULT '[]',
      metrics TEXT NOT NULL DEFAULT '{}',
      latest_applied_change_id TEXT,
      open_outcome_window_count INTEGER NOT NULL DEFAULT 0,
      pending_proposal_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pulse_frame_world
      ON pulse_frames(world_id, created_at);
  `);

  // 執行待處理的資料庫遷移（處理既有資料庫的 schema 升級）
  runMigrations(db);
}

/**
 * 遷移定義：每個遷移包含版本號和升級函數。
 * 新 :memory: 資料庫已在 CREATE TABLE 包含所有欄位，遷移用於升級既有資料庫。
 * SQLite 不支援 ALTER TABLE ADD COLUMN IF NOT EXISTS，
 * 故以 try/catch 處理 "duplicate column" 的情況。
 */
interface Migration {
  readonly version: number;
  readonly description: string;
  readonly up: (db: Database) => void;
}

/** 嘗試新增欄位，若欄位已存在則安全忽略 */
function addColumnIfNotExists(db: Database, sql: string): void {
  try {
    db.run(sql);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('duplicate column name')) {
      throw err;
    }
    // "duplicate column name" — 欄位已存在，安全忽略
  }
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'consolidate ALTER TABLE columns from ad-hoc blocks into schema versioning',
    up(db: Database): void {
      // loop_cycles: intent
      addColumnIfNotExists(db, 'ALTER TABLE loop_cycles ADD COLUMN intent TEXT DEFAULT NULL');

      // skills: extension columns (#219)
      const skillColumns = [
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
      for (const sql of skillColumns) {
        addColumnIfNotExists(db, sql);
      }

      // chiefs: pipelines, heartbeat, budget, worker role, precedent, stale detection
      const chiefColumns = [
        "ALTER TABLE chiefs ADD COLUMN pipelines TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE chiefs ADD COLUMN adapter_type TEXT NOT NULL DEFAULT 'local'",
        "ALTER TABLE chiefs ADD COLUMN context_mode TEXT NOT NULL DEFAULT 'fat'",
        "ALTER TABLE chiefs ADD COLUMN adapter_config TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE chiefs ADD COLUMN budget_config TEXT DEFAULT NULL",
        "ALTER TABLE chiefs ADD COLUMN pause_reason TEXT DEFAULT NULL",
        "ALTER TABLE chiefs ADD COLUMN paused_at TEXT DEFAULT NULL",
        "ALTER TABLE chiefs ADD COLUMN role_type TEXT NOT NULL DEFAULT 'chief'",
        "ALTER TABLE chiefs ADD COLUMN parent_chief_id TEXT DEFAULT NULL",
        "ALTER TABLE chiefs ADD COLUMN use_precedents INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE chiefs ADD COLUMN precedent_config TEXT DEFAULT NULL",
        "ALTER TABLE chiefs ADD COLUMN last_heartbeat_at TEXT DEFAULT NULL",
        "ALTER TABLE chiefs ADD COLUMN current_run_id TEXT DEFAULT NULL",
        "ALTER TABLE chiefs ADD COLUMN current_run_status TEXT NOT NULL DEFAULT 'idle'",
        "ALTER TABLE chiefs ADD COLUMN timeout_count INTEGER NOT NULL DEFAULT 0",
      ];
      for (const sql of chiefColumns) {
        addColumnIfNotExists(db, sql);
      }

      // villages: health delta tracking (#236)
      addColumnIfNotExists(db, 'ALTER TABLE villages ADD COLUMN last_health_score INTEGER DEFAULT NULL');
    },
  },
];

/**
 * 遷移執行器：檢查當前版本，執行待處理遷移，更新版本號。
 * 每次 initSchema 呼叫時執行，但已完成的遷移會被跳過。
 */
function runMigrations(db: Database): void {
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | null;
  let currentVersion = row ? row.version : 0;

  // 首次執行：插入初始版本記錄
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(0);
  }

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      migration.up(db);
      db.prepare('UPDATE schema_version SET version = ?').run(migration.version);
      currentVersion = migration.version;
    }
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
