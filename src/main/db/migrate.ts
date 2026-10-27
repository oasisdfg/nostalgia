import type Database from 'better-sqlite3';
import init0001 from './migrations/0001_init.sql?raw';
import amend0002 from './migrations/0002_schema_amendments.sql?raw';
import igdb0003 from './migrations/0003_igdb_cache.sql?raw';
import source0004 from './migrations/0004_game_file_source.sql?raw';
import extract0005 from './migrations/0005_cache_extract_dir.sql?raw';
import homeFav0006 from './migrations/0006_home_favorites.sql?raw';
import launchbox0007 from './migrations/0007_launchbox.sql?raw';
import rpcs3Compat0008 from './migrations/0008_rpcs3_compat.sql?raw';
import recomps0009 from './migrations/0009_recomps.sql?raw';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Ordered, forward-only. Add a new entry for each new migration file.
const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: init0001 },
  { version: 2, name: 'schema_amendments', sql: amend0002 },
  { version: 3, name: 'igdb_cache', sql: igdb0003 },
  { version: 4, name: 'game_file_source', sql: source0004 },
  { version: 5, name: 'cache_extract_dir', sql: extract0005 },
  { version: 6, name: 'home_favorites', sql: homeFav0006 },
  { version: 7, name: 'launchbox', sql: launchbox0007 },
  { version: 8, name: 'rpcs3_compat', sql: rpcs3Compat0008 },
  { version: 9, name: 'recomps', sql: recomps0009 },
];

/** Applies pending migrations in version order; each runs in its own transaction. */
export function migrate(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     );`,
  );

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  const applied = new Set<number>(appliedRows.map((r) => r.version));

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const mig of MIGRATIONS.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version)) {
    const run = db.transaction(() => {
      db.exec(mig.sql);
      insert.run(mig.version, mig.name, Date.now());
    });
    run();
  }
}

/** The highest applied migration version (0 if none). */
export function currentSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}
