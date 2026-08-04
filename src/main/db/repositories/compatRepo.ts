import { getDb } from '../connection';

/** rpcs3.net's own vocabulary, plus 'Unknown' for a serial the list does not cover. */
export type CompatStatus = 'Playable' | 'Ingame' | 'Intro' | 'Loadable' | 'Nothing' | 'Unknown';

export const COMPAT_STATUSES: readonly CompatStatus[] = [
  'Playable',
  'Ingame',
  'Intro',
  'Loadable',
  'Nothing',
  'Unknown',
];

export interface CompatRow {
  provider: string;
  title_id: string;
  status: CompatStatus;
  title: string | null;
  checked_at: number;
}

export function getCompat(provider: string, titleId: string): CompatRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM compat_entries WHERE provider = ? AND title_id = ?')
    .get(provider, titleId) as CompatRow | undefined;
  return row ?? null;
}

export function upsertCompat(entry: Omit<CompatRow, 'checked_at'> & { checked_at?: number }): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO compat_entries (provider, title_id, status, title, checked_at)
     VALUES (@provider, @title_id, @status, @title, @checked_at)
     ON CONFLICT (provider, title_id) DO UPDATE SET
       status = excluded.status,
       title = excluded.title,
       checked_at = excluded.checked_at`,
  ).run({
    provider: entry.provider,
    title_id: entry.title_id,
    status: entry.status,
    title: entry.title ?? null,
    checked_at: entry.checked_at ?? Date.now(),
  });
}
