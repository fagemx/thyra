/**
 * bun:sqlite compatibility shim for vitest on Node.js
 *
 * Wraps better-sqlite3 to expose the bun:sqlite API surface used by Thyra.
 * Only needed when running tests via `npx vitest run` (Node runtime).
 * When Bun's Windows crash bug is fixed, this shim becomes unnecessary.
 *
 * API differences bridged:
 * - bun:sqlite `db.run(sql)` → better-sqlite3 `db.exec(sql)`
 * - bun:sqlite `db.query(sql)` → better-sqlite3 `db.prepare(sql)`
 * - Some test files call `db.exec()` directly (better-sqlite3 native API)
 */

import BetterSqlite3 from 'better-sqlite3';

export class Database {
  private _db: BetterSqlite3.Database;

  constructor(pathOrMemory?: string) {
    this._db = new BetterSqlite3(pathOrMemory ?? ':memory:');
  }

  /** bun:sqlite `run()` executes raw SQL — maps to better-sqlite3 `exec()` */
  run(sql: string): void {
    this._db.exec(sql);
  }

  /** better-sqlite3 native `exec()` — some test files call this directly */
  exec(sql: string): this {
    this._db.exec(sql);
    return this;
  }

  /** bun:sqlite `query()` is an alias for `prepare()` */
  query(sql: string): BetterSqlite3.Statement {
    return this._db.prepare(sql);
  }

  /** Delegate to better-sqlite3 prepare */
  prepare(sql: string): BetterSqlite3.Statement {
    return this._db.prepare(sql);
  }

  /** Delegate to better-sqlite3 transaction */
  transaction<T>(fn: (...args: unknown[]) => T): BetterSqlite3.Transaction<(...args: unknown[]) => T> {
    return this._db.transaction(fn);
  }

  /** Delegate to better-sqlite3 close */
  close(): void {
    this._db.close();
  }

  /** Delegate to better-sqlite3 pragma */
  pragma(source: string, options?: BetterSqlite3.PragmaOptions): unknown {
    return this._db.pragma(source, options);
  }

  /** Expose inTransaction property */
  get inTransaction(): boolean {
    return this._db.inTransaction;
  }

  /** Expose open property */
  get open(): boolean {
    return this._db.open;
  }
}

/** Default export for `import Database from 'bun:sqlite'` pattern */
export default Database;
