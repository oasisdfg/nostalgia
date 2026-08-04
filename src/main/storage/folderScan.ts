// Scans a console's own games folder (`<storage.root>/<systemSlug>/`) and reconciles what is
// actually on disk with what the library thinks it has. Three jobs, in order:
//
//   1. MATCH    - a file whose name still matches its row: refresh the recorded size.
//   2. RELINK   - a row whose file has vanished, paired with a new unclaimed file of the
//                 IDENTICAL byte size. Renaming a game used to orphan its row and prompt a
//                 re-download of a file sitting right there; this keeps the game, its art,
//                 favourites and play history and just swaps the opaque key.
//   3. ADOPT    - a file nothing claims: a game the user dropped in themselves. It becomes a
//                 real library entry, already 'cached' (the bytes are here) and PINNED so the
//                 LRU can never delete a file the app didn't download.
//
// Size is the relink key because it is free; a disc image's size is a strong discriminator
// and an exact byte match is never a coincidence. Hashing is used ONLY to break a tie
// between several same-size candidates - reading tens of GB to confirm what size already
// settled would make a scan unusable. A tie the hashes can't resolve is left alone rather
// than guessed at. MAIN PROCESS ONLY.
import { readdir, stat, access } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { app } from 'electron';
import { getSetting } from '../db/repositories/settingsRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import * as gameFilesRepo from '../db/repositories/gameFilesRepo';
import { findFilelessGameByTitle } from '../db/repositories/gamesRepo';
import * as cacheRepo from '../db/repositories/cacheRepo';
import { hashFile } from './hashing';
import type { GameFileRow } from '../db/repositories/types';

export interface FolderScanResult {
  /** New library entries created from files the user added. */
  added: number;
  /** Existing entries re-pointed at a renamed file. */
  relinked: number;
  /** Entries whose file is still present (size refreshed if it changed). */
  matched: number;
  /** Entries whose file is gone and that nothing on disk could be matched to. */
  missing: number;
}

/** Disc/ROM containers we treat as a game. Deliberately conservative. */
const GAME_EXTENSIONS = new Set([
  'iso', 'bin', 'cue', 'chd', 'cso', 'pbp', 'wbfs', 'rvz', 'gcm', 'nkit', 'img', 'nrg', 'gdi',
  'nes', 'sfc', 'smc', 'gb', 'gbc', 'gba', 'n64', 'z64', 'v64', 'nds', '3ds', 'cia', 'xex',
  'md', 'gen', 'smd', 'pce', 'a26', 'gg', 'sms', 'ws', 'wsc', 'zip', '7z',
  // Switch (nsp/xci and their nsz/xcz compressed forms) and Wii U (wud/wux/wua).
  'nsp', 'xci', 'nsz', 'xcz', 'wud', 'wux', 'wua',
]);

/** The configured games library root (mirrors downloadManager.gamesRoot). */
function gamesRoot(): string {
  const row = getSetting('storage.root');
  const v = row && !row.encrypted ? row.value : null;
  return typeof v === 'string' && v.length > 0 ? v : join(app.getPath('userData'), 'games');
}

function isGameFile(name: string): boolean {
  if (name.startsWith('.')) return false;
  const ext = extname(name).slice(1).toLowerCase();
  return GAME_EXTENSIONS.has(ext);
}

/** A title from a filename: strip the extension, keep everything else verbatim. */
function titleFromFilename(name: string): string {
  const ext = extname(name);
  const title = ext ? name.slice(0, -ext.length) : name;
  return title.length > 0 ? title : name;
}

interface DiskFile {
  name: string;
  path: string;
  size: number;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * Resolves which of several same-size candidates is really this row's file, by hashing.
 * Only usable when the row carries a hash to compare against (`hash_source != 'none'`);
 * otherwise there is nothing to compare and the caller must leave the tie unresolved.
 */
async function breakTieByHash(row: GameFileRow, candidates: DiskFile[]): Promise<DiskFile | null> {
  const expected = row.sha1 ?? row.md5 ?? row.crc32;
  if (!expected) return null;
  const algo = row.sha1 ? 'sha1' : row.md5 ? 'md5' : 'crc32';
  for (const c of candidates) {
    const hashes = await hashFile(c.path).catch(() => null);
    if (hashes && hashes[algo] === expected) return c;
  }
  return null;
}

/**
 * Reconciles one system's games folder with the library. Idempotent: a second run over an
 * unchanged folder reports everything as `matched` and writes nothing.
 */
export async function scanSystemFolder(systemId: number): Promise<FolderScanResult> {
  const system = getSystem(systemId);
  if (!system) throw new Error('System not found.');
  const dir = join(gamesRoot(), system.slug);

  let entries: string[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && isGameFile(e.name)).map((e) => e.name);
  } catch {
    return { added: 0, relinked: 0, matched: 0, missing: 0 }; // no folder for this console yet
  }

  const disk: DiskFile[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    const size = await stat(path).then((s) => s.size).catch(() => null);
    if (size != null) disk.push({ name, path, size });
  }

  const rows = gameFilesRepo.listFilesForSystem(systemId);
  const claimed = new Set<string>();
  const result: FolderScanResult = { added: 0, relinked: 0, matched: 0, missing: 0 };

  // (1) MATCH - a row whose file is still there under the same name. Compared as exact
  // bytes: two names differing only by an invisible character are different files.
  const orphans: (GameFileRow & { local_path: string | null })[] = [];
  for (const row of rows) {
    // A row this scan has no business touching:
    //  - never localized (no cache entry and not marked cached) - it's a catalog title the
    //    user hasn't downloaded, not a file that went missing;
    //  - or its bytes live somewhere else entirely. A `source: 'local'` on-demand copy sits
    //    in the hashed LRU cache dir, NOT in this per-console folder, so judging it by
    //    what's in this directory would wrongly mark a perfectly good file missing.
    if (!row.local_path && row.cache_state !== 'cached') continue;
    if (row.local_path && !(await exists(row.local_path))) {
      // recorded path is gone - fall through and try to re-link it below
    } else if (row.local_path && !row.local_path.startsWith(dir)) {
      continue; // present, just not in this folder (cache dir) - leave it alone
    }

    const key = basename(row.storage_key);
    const hit = disk.find((d) => !claimed.has(d.name) && (d.path === row.local_path || d.name === key));
    if (!hit) {
      orphans.push(row);
      continue;
    }
    claimed.add(hit.name);
    result.matched++;
    if (row.size_bytes !== hit.size) {
      cacheRepo.upsertEntry({
        gameFileId: row.id,
        cacheKey: row.storage_key,
        localPath: hit.path,
        sizeBytes: hit.size,
        verified: false,
      });
    }
  }

  // (2) RELINK - pair each orphan with an unclaimed file of exactly the same size.
  for (const row of orphans) {
    const candidates = disk.filter((d) => !claimed.has(d.name) && d.size === row.size_bytes);
    let pick: DiskFile | null = null;
    if (candidates.length === 1) pick = candidates[0];
    else if (candidates.length > 1) pick = await breakTieByHash(row, candidates);

    if (!pick) {
      result.missing++;
      // The bytes really are gone: drop the stale cache row and mark it re-downloadable,
      // rather than leaving a path that resolves to nothing at launch.
      if (row.local_path) {
        const entry = cacheRepo.getEntryByFile(row.id);
        if (entry) cacheRepo.deleteEntry(entry.id);
      }
      if (row.cache_state === 'cached') gameFilesRepo.setCacheState(row.id, 'remote');
      continue;
    }

    claimed.add(pick.name);
    result.relinked++;
    gameFilesRepo.relinkFile(row.id, pick.name, titleFromFilename(pick.name));
    const stale = cacheRepo.getEntryByFile(row.id);
    if (stale) cacheRepo.deleteEntry(stale.id); // cache_key follows the storage_key
    cacheRepo.upsertEntry({
      gameFileId: row.id,
      cacheKey: pick.name,
      localPath: pick.path,
      sizeBytes: pick.size,
      verified: false,
    });
    cacheRepo.setPinnedByFile(row.id, true);
    gameFilesRepo.setCacheState(row.id, 'cached');
  }

  // (3) ADOPT - everything still unclaimed is a game the user put there themselves.
  for (const d of disk) {
    if (claimed.has(d.name)) continue;
    const title = titleFromFilename(d.name);
    // A file-less catalog / My List row for this title already exists when the user
    // favourited the game and then supplied the file themselves. Attach to it rather than
    // creating a second entry that would sit next to it on the shelf as a duplicate.
    const existingGameId = findFilelessGameByTitle(systemId, title) ?? undefined;
    gameFilesRepo.upsertIngestedFile({
      systemId,
      title,
      gameId: existingGameId,
      storageKey: d.name,
      sizeBytes: d.size,
      crc32: null,
      md5: null,
      sha1: null,
      hashSource: 'none',
    });
    const row = gameFilesRepo.getFileByStorageKey(d.name);
    if (!row) continue;
    cacheRepo.upsertEntry({
      gameFileId: row.id,
      cacheKey: d.name,
      localPath: d.path,
      sizeBytes: d.size,
      verified: false,
    });
    // The bytes are already here, so it's playable immediately - and PINNED, because LRU
    // eviction deletes from disk and must never throw away a file the user supplied.
    gameFilesRepo.setCacheState(row.id, 'cached');
    cacheRepo.setPinnedByFile(row.id, true);
    result.added++;
  }

  return result;
}
