import { app } from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { getDb } from '../db/connection';
import type { MediaRef, MetadataProviderId } from '@shared/contracts/metadata';

function extForContentType(ct: string | null): string {
  if (!ct) return '.jpg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.jpg';
}

/**
 * Downloads each MediaRef into the assets folder and indexes it in media_assets,
 * deduping by (game_id, type, checksum) via the unique index. local_path is
 * stored relative to the assets root and surfaced to the renderer as asset://.
 */
export async function cacheMedia(gameId: number, provider: MetadataProviderId, refs: MediaRef[]): Promise<number> {
  let added = 0;
  for (const ref of refs) {
    try {
      const res = await fetch(ref.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const checksum = createHash('sha1').update(buf).digest('hex');
      const ext = extForContentType(res.headers.get('content-type'));
      const rel = `games/${gameId}/${ref.type}_${checksum.slice(0, 12)}${ext}`;
      const dest = join(app.getPath('userData'), 'assets', rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      const info = getDb()
        .prepare(
          `INSERT INTO media_assets (game_id, type, local_path, source_url, provider, checksum, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_id, type, checksum) DO NOTHING`,
        )
        .run(gameId, ref.type, rel, ref.url, provider, checksum, Date.now());
      if (info.changes > 0) added++;
    } catch {
      /* skip media that fails to download */
    }
  }
  return added;
}

/**
 * Registers an already-cached image (an `asset://assets/...` URL whose bytes are
 * on disk, e.g. an IGDB cover fetched during catalog browsing) as a `box2d`
 * media asset for an owned game - so an acquired catalog game shows art without
 * waiting on a scrape. Stores local_path relative to the assets root (verbatim
 * segments) and dedupes by (game_id, type, checksum). Best-effort; no-ops on any
 * failure (missing file, malformed URL).
 */
export async function registerLocalCover(gameId: number, assetUrl: string): Promise<void> {
  await upsertLocalCover(gameId, assetUrl, false);
}

/**
 * Like registerLocalCover, but REPLACES any existing box2d rows for the game first -
 * used when upgrading a game's cover to the LaunchBox retail case front, which must
 * win over a previously-registered IGDB cover (list queries take the first box2d row).
 */
export async function replaceCover(gameId: number, assetUrl: string): Promise<void> {
  await upsertLocalCover(gameId, assetUrl, true);
}

/** Whether the game's cover already is a LaunchBox asset (box-front upgrade done). */
export function hasLaunchboxCover(gameId: number): boolean {
  return (
    getDb()
      .prepare(`SELECT 1 FROM media_assets WHERE game_id = ? AND type = 'box2d' AND local_path LIKE 'launchbox/%'`)
      .get(gameId) != null
  );
}

async function upsertLocalCover(gameId: number, assetUrl: string, replace: boolean): Promise<void> {
  try {
    const m = /^asset:\/\/assets\/(.+)$/.exec(assetUrl);
    if (!m) return;
    const rel = m[1]
      .split('/')
      .map((s) => decodeURIComponent(s))
      .join('/');
    const abs = join(app.getPath('userData'), 'assets', ...rel.split('/'));
    const buf = await readFile(abs);
    const checksum = createHash('sha1').update(buf).digest('hex');
    const db = getDb();
    if (replace) db.prepare(`DELETE FROM media_assets WHERE game_id = ? AND type = 'box2d'`).run(gameId);
    db.prepare(
      `INSERT INTO media_assets (game_id, type, local_path, source_url, provider, checksum, downloaded_at)
       VALUES (?, 'box2d', ?, NULL, NULL, ?, ?)
       ON CONFLICT(game_id, type, checksum) DO NOTHING`,
    ).run(gameId, rel, checksum, Date.now());
  } catch {
    /* cover registration is best-effort */
  }
}
