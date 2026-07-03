import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { pluginDataDir, pluginDbFile } from '../paths';

/**
 * A plugin's own sqlite database (#plugins, db:own). The HOST owns the handle;
 * the plugin child never gets a path or a connection — it can only reach this
 * through RPC (db.exec / db.query / db.migrate). Because it is a SEPARATE FILE,
 * containment is a filesystem fact: the plugin physically cannot read trek.db,
 * and we don't have to police table-name prefixes in its SQL.
 *
 * A thin guard still rejects statements that would let a plugin escape its file
 * (ATTACH another db, VACUUM INTO elsewhere, PRAGMA fiddling) or DoS via
 * oversize SQL.
 */

const MAX_SQL_LENGTH = 100_000;
const FORBIDDEN = /\b(ATTACH|DETACH|VACUUM|PRAGMA)\b/i;

export class PluginDataDb {
  private db: Db;

  constructor(pluginId: string) {
    fs.mkdirSync(pluginDataDir(pluginId), { recursive: true });
    this.db = new Database(pluginDbFile(pluginId));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // Track applied migrations so db.migrate is idempotent per (plugin, id).
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS _plugin_migrations (id TEXT PRIMARY KEY, applied_at INTEGER)`,
    );
  }

  private guard(sql: string): void {
    if (typeof sql !== 'string') throw new Error('sql must be a string');
    if (sql.length > MAX_SQL_LENGTH) throw new Error('sql too long');
    if (FORBIDDEN.test(sql)) throw new Error('statement type not allowed for plugin databases');
  }

  /** Read query — returns all rows. Single statement only (better-sqlite3 prepare). */
  query(sql: string, args: unknown[] = []): unknown[] {
    this.guard(sql);
    return this.db.prepare(sql).all(...(args as never[]));
  }

  /** Write statement(s). exec() allows multiple statements (e.g. a small setup script). */
  exec(sql: string, args: unknown[] = []): { changes: number } {
    this.guard(sql);
    if (args.length > 0) {
      const info = this.db.prepare(sql).run(...(args as never[]));
      return { changes: info.changes };
    }
    this.db.exec(sql);
    return { changes: 0 };
  }

  /** Run a migration once, keyed by id. Re-running with the same id is a no-op. */
  migrate(id: string, sql: string): { applied: boolean } {
    this.guard(sql);
    const seen = this.db.prepare('SELECT 1 FROM _plugin_migrations WHERE id = ?').get(id);
    if (seen) return { applied: false };
    this.db.transaction(() => {
      this.db.exec(sql);
      this.db.prepare('INSERT INTO _plugin_migrations (id, applied_at) VALUES (?, ?)').run(id, Date.now());
    })();
    return { applied: true };
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}

/** Delete a plugin's data directory (uninstall "delete data"). */
export function removePluginData(pluginId: string): void {
  fs.rmSync(pluginDataDir(pluginId), { recursive: true, force: true });
}
