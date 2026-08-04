import { app } from 'electron';
import { mkdir, rm, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { getSetting } from '../db/repositories/settingsRepo';
import * as cacheRepo from '../db/repositories/cacheRepo';
import { setCacheState } from '../db/repositories/gameFilesRepo';
import type { CacheStats } from '@shared/contracts/ipc';

function cacheDir(): string {
  const row = getSetting('cache.dir');
  const value = row && !row.encrypted ? row.value : null;
  return typeof value === 'string' && value.length > 0 ? value : join(app.getPath('userData'), 'cache');
}

export async function ensureCacheDir(): Promise<string> {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Derives a safe on-disk filename from the opaque cache key (kept verbatim in the DB). */
export function cacheFilePath(cacheKey: string): string {
  const safe = createHash('sha1').update(cacheKey).digest('hex').slice(0, 24);
  return join(cacheDir(), safe + extname(cacheKey));
}

export function stats(): CacheStats {
  return cacheRepo.getCacheStats();
}

export function touch(cacheKey: string): void {
  cacheRepo.touchEntry(cacheKey);
}

/**
 * Confirms a file's cached blob is actually on disk. If the entry exists but the file
 * is gone (moved/deleted, or a stale entry from an older cache location), drops the
 * record and marks the file 'remote' so a re-launch re-downloads instead of handing the
 * emulator a path that doesn't exist. Returns true only when the blob is really present.
 */
export async function verifyPresent(gameFileId: number): Promise<boolean> {
  const entry = cacheRepo.getEntryByFile(gameFileId);
  if (!entry) return false;
  try {
    await access(entry.local_path);
    return true;
  } catch {
    cacheRepo.deleteEntry(entry.id);
    setCacheState(gameFileId, 'remote');
    return false;
  }
}

export function pin(gameFileId: number, pinned: boolean): void {
  cacheRepo.setPinnedByFile(gameFileId, pinned);
}

export function add(entry: {
  gameFileId: number | null;
  cacheKey: string;
  localPath: string;
  sizeBytes: number;
  verified: boolean;
  extractDir?: string | null;
}): void {
  cacheRepo.upsertEntry(entry);
}

async function removeEntry(entry: cacheRepo.CacheEntryRow): Promise<void> {
  // A multi-file zip-extracted game lives in its own folder (extract_dir); remove the
  // whole folder so no inner file (e.g. a PSX .bin next to its .cue) is orphaned.
  if (entry.extract_dir) await rm(entry.extract_dir, { recursive: true, force: true });
  else await rm(entry.local_path, { force: true });
  cacheRepo.deleteEntry(entry.id);
  if (entry.game_file_id != null) setCacheState(entry.game_file_id, 'remote');
}

/** Evicts LRU unpinned entries until within the size limit. Never evicts active files. */
export async function enforceLimit(protect: Set<number> = new Set()): Promise<CacheStats> {
  let current = cacheRepo.getCacheStats();
  if (current.limitBytes <= 0 || current.totalBytes <= current.limitBytes) return current;
  let over = current.totalBytes - current.limitBytes;
  for (const entry of cacheRepo.listEvictable()) {
    if (over <= 0) break;
    if (entry.game_file_id != null && protect.has(entry.game_file_id)) continue;
    await removeEntry(entry);
    over -= entry.size_bytes;
  }
  current = cacheRepo.getCacheStats();
  return current;
}

export async function evict(targetBytes?: number): Promise<CacheStats> {
  if (targetBytes && targetBytes > 0) {
    let freed = 0;
    for (const entry of cacheRepo.listEvictable()) {
      if (freed >= targetBytes) break;
      await removeEntry(entry);
      freed += entry.size_bytes;
    }
    return cacheRepo.getCacheStats();
  }
  return enforceLimit();
}

export async function clear(): Promise<CacheStats> {
  for (const entry of cacheRepo.listAllEntries()) {
    if (entry.pinned === 1) continue;
    await removeEntry(entry);
  }
  return cacheRepo.getCacheStats();
}
