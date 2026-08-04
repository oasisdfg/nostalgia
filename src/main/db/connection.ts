import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';

let db: Database.Database | null = null;

/** Opens (once) the app's SQLite database in the main process and applies pragmas. */
export function getDb(): Database.Database {
  if (db) return db;
  // Smoke tests run against a disposable in-memory DB so they never touch real data.
  const file =
    process.env.NOSTALGIA_SMOKE === '1' ? ':memory:' : join(app.getPath('userData'), 'nostalgia.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
