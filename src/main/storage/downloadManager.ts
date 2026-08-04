import { app } from 'electron';
import { rename, rm, mkdir, stat as fsStat, statfs } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { broadcastEvent } from '../ipc/registry';
import { getStorageProvider } from './index';
import { getArchiveProviderForSource, getArchiveProviderForGame } from '../catalog/archiveSources';
import { getMinervaProviderForSource } from '../catalog/minervaSources';
import { sourceNeedsExtract } from '../catalog/sources';
import { extractGameZip } from './extract';
import * as ps3 from './ps3decrypt';
import { detectDiscPlatform } from './ps3serial';
import * as downloadsRepo from '../db/repositories/downloadsRepo';
import * as gameFilesRepo from '../db/repositories/gameFilesRepo';
import * as gamesRepo from '../db/repositories/gamesRepo';
import * as cacheRepo from '../db/repositories/cacheRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getSetting } from '../db/repositories/settingsRepo';
import * as cache from './cache';
import { hashFile, verifyFile } from './hashing';
import type { DownloadDTO } from '@shared/contracts/ipc';
import type { GameFileRow } from '../db/repositories/types';
import type { HashAlgo, StorageProvider } from '@shared/contracts/storage';

const FREE_SPACE_MARGIN = 512 * 1024 * 1024; // keep ~512 MB headroom

// One transfer at a time: each download already saturates the link with up to 32
// parallel connections (aria2 across two mirrors), so a second concurrent transfer
// only splits bandwidth and starves availability checks. Additional enqueues sit in
// 'queued' and start automatically when the current one finishes.
const MAX_CONCURRENT = 1;

interface ActiveJob {
  controller: AbortController;
  gameFileId: number;
}
const active = new Map<number, ActiveJob>();
const pauseRequested = new Set<number>();
const cancelRequested = new Set<number>();
// Automatic retry for THROWN (network/provider) errors only - checksum mismatches,
// disk-space and extraction failures fail immediately (they route through fail()
// before the catch). Cleared on any terminal outcome so a later manual resume gets
// a fresh retry budget.
const MAX_AUTO_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 3000;
const retryCounts = new Map<number, number>();
const waiters = new Map<number, { resolve: () => void; reject: (e: Error) => void }[]>();

function activeFileIds(): Set<number> {
  return new Set(Array.from(active.values()).map((j) => j.gameFileId));
}

function resolveWaiters(gameFileId: number): void {
  waiters.get(gameFileId)?.forEach((w) => w.resolve());
  waiters.delete(gameFileId);
}
function rejectWaiters(gameFileId: number, err: Error): void {
  waiters.get(gameFileId)?.forEach((w) => w.reject(err));
  waiters.delete(gameFileId);
}

function pickExpected(file: GameFileRow): { algo: HashAlgo; value: string } | null {
  if (file.sha1) return { algo: 'sha1', value: file.sha1 };
  if (file.md5) return { algo: 'md5', value: file.md5 };
  if (file.crc32) return { algo: 'crc32', value: file.crc32 };
  return null;
}

/** The configured games library root (falls back to <userData>/games). */
function gamesRoot(): string {
  const row = getSetting('storage.root');
  const v = row && !row.encrypted ? row.value : null;
  return typeof v === 'string' && v.length > 0 ? v : join(app.getPath('userData'), 'games');
}

/**
 * On-disk destination for a completed download. An owned catalog game lands in a
 * browsable per-console games folder under its REAL filename
 * (`<storage.root>/<systemSlug>/<name>`) so the user can find + organize it; a transient
 * local on-demand copy stays in the hashed LRU cache. basename() derives a display
 * filename from the opaque storage_key without mutating the stored key.
 */
export function resolveDownloadDest(file: GameFileRow): string {
  if (file.source === 'local') return cache.cacheFilePath(file.storage_key);
  const game = gamesRepo.getGame(file.game_id);
  const system = game ? getSystem(game.systemId) : null;
  const slug = system?.slug ?? 'other';
  return join(gamesRoot(), slug, basename(file.storage_key));
}

/** Routes a file to the provider that supplies it (local folder vs catalog source). */
function resolveProvider(file: GameFileRow): StorageProvider | null {
  // archive-org:<item> routes to the exact item (multi-item platforms); legacy bare
  // 'archive-org' falls back to the game's platform source.
  if (file.source.startsWith('archive-org')) {
    return getArchiveProviderForSource(file.source) ?? getArchiveProviderForGame(file.game_id);
  }
  // Minerva torrent source - pulls the game out of the collection torrent via aria2.
  if (file.source.startsWith('minerva:')) return getMinervaProviderForSource(file.source);
  return getStorageProvider();
}

/** A downloaded image is confirmed to be a different console's disc than the game it was
 *  acquired for. Carries a complete user-facing message (not a decrypt failure). */
class PlatformMismatchError extends Error {}

/** Failure text for the shared PS3 preparation step, keeping a platform mismatch (which
 *  has its own complete message) from being mislabelled as a decryption failure. */
function ps3FailureMessage(e: unknown): string {
  if (e instanceof PlatformMismatchError) return e.message;
  return e instanceof Error ? `PS3 decrypt failed: ${e.message}` : 'PS3 decrypt failed';
}

/**
 * Prepare a downloaded/extracted PS3 disc image: reject a confirmed wrong-console image,
 * then decrypt a Redump ISO in place so RPCS3 can boot it. No-op for non-ps3 systems,
 * non-.iso files, or an already-decrypted disc (matches no IRD). Throws on a decrypt
 * failure - including one that can't be PROVEN correct against the IRD's file hashes - so
 * the caller fails the download instead of marking an unbootable disc ready.
 * Shared by the direct-ISO and zip-extract completion paths.
 */
async function decryptPs3IfNeeded(gameId: number, isoPath: string, id: number, gameFileId: number): Promise<void> {
  if (!isoPath.toLowerCase().endsWith('.iso')) return;
  const sys = getSystem(gamesRepo.getGame(gameId)?.systemId ?? -1);
  if (sys?.slug !== 'ps3') return;

  // Some archive items mix consoles under one collection (a PSN set can carry PSP UMD
  // dumps), and the title matcher only sees filenames - so a PS3 entry can end up with
  // another console's disc, which RPCS3 will never boot. Reject a CONFIRMED mismatch;
  // detectDiscPlatform reports null for anything it cannot positively identify, so an
  // unusual-but-valid PS3 image still passes through.
  const detected = await detectDiscPlatform(isoPath);
  if (detected && detected !== 'ps3') {
    throw new PlatformMismatchError(
      `This download is a ${detected.toUpperCase()} disc image, not a PlayStation 3 game, so it cannot run in RPCS3. The source listed it under this title, but the file is for another console.`,
    );
  }
  downloadsRepo.updateDownload(id, { state: 'verifying' });
  broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'verifying' });
  // Rewriting a 35 GB disc takes minutes; report it as progress on the existing 'verifying'
  // state so the row advances instead of looking frozen. Throttled like the download itself.
  const total = (await fsStat(isoPath)).size;
  let lastEmit = 0;
  await ps3.maybeDecryptPs3(isoPath, total, undefined, (fraction) => {
    const now = Date.now();
    if (now - lastEmit < 250) return;
    lastEmit = now;
    broadcastEvent('downloads:progress', {
      id,
      gameFileId,
      fraction,
      bytesReceived: Math.round(total * fraction),
      bytesTotal: total,
      bytesPerSecond: 0,
    });
  });
}

async function hasFreeSpace(dir: string, needBytes: number): Promise<boolean> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize) >= needBytes;
  } catch {
    return true; // statfs unavailable -> don't block the download
  }
}

/** Removes a download's .part plus every engine sidecar (.parts segment map, .aria2 control file). */
async function removeTempArtifacts(tempPath: string): Promise<void> {
  await Promise.all(
    [tempPath, `${tempPath}.parts`, `${tempPath}.aria2`].map((p) => rm(p, { force: true }).catch(() => undefined)),
  );
}

/**
 * Is this file genuinely installed right now? True only when a cache_entries row exists
 * (written solely on a verified, completed download) AND the blob is still on disk at the
 * recorded size. `statSync` is deliberate: the callers below are synchronous state
 * transitions and must not interleave.
 */
function isInstalled(gameFileId: number): boolean {
  const entry = cacheRepo.getEntryByFile(gameFileId);
  if (!entry?.local_path || !existsSync(entry.local_path)) return false;
  try {
    return statSync(entry.local_path).size === entry.size_bytes;
  } catch {
    return false;
  }
}

/**
 * Move a file OFF 'cached' after a download ends without completing - unless the file is
 * genuinely installed, in which case the correct state is 'cached' and we repair it.
 *
 * Without this, any stale or duplicate download row (a second enqueue for an already-owned
 * game, a leftover row canceled after the real download finished, a startup reconcile) reset
 * an installed game to 'remote'. The library still showed it as owned - game_files exists, so
 * the card shows no "not downloaded" glyph - while the detail page offered "Install" for bytes
 * already sitting on disk. That is exactly the inconsistency users hit.
 */
function settleCacheState(gameFileId: number, state: 'remote' | 'error'): void {
  gameFilesRepo.setCacheState(gameFileId, isInstalled(gameFileId) ? 'cached' : state);
}

/**
 * Startup repair for libraries already carrying the bad state above: any file that is
 * verifiably on disk but not marked 'cached' is restored. Idempotent and cheap (one stat
 * per cache entry).
 */
export function reconcileCacheStates(): void {
  for (const file of gameFilesRepo.listFilesNotCached()) {
    if (isInstalled(file.id)) {
      gameFilesRepo.setCacheState(file.id, 'cached');
      if (!app.isPackaged) console.log(`[downloads] repaired cache_state for game_file ${file.id} (file is on disk)`);
    }
  }
}

function fail(id: number, gameFileId: number, message: string): void {
  retryCounts.delete(id);
  downloadsRepo.updateDownload(id, { state: 'failed', error: message });
  settleCacheState(gameFileId, 'error');
  broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'failed', error: message });
  rejectWaiters(gameFileId, new Error(message));
}

export function enqueue(gameFileId: number, priority = 0): DownloadDTO {
  const file = gameFilesRepo.getFileRow(gameFileId);
  if (!file) throw new Error('game_file not found');
  const existing = downloadsRepo.getActiveDownloadForFile(gameFileId);
  if (existing) {
    pump();
    return downloadsRepo.getDownload(existing.id)!;
  }
  const dto = downloadsRepo.createDownload(gameFileId, priority, pickExpected(file));
  broadcastEvent('downloads:stateChanged', { id: dto.id, gameFileId, state: 'queued' });
  pump();
  return dto;
}

export function pause(id: number): DownloadDTO | null {
  const dl = downloadsRepo.getDownloadInternal(id);
  if (!dl) return null;
  if (dl.state === 'downloading' && active.has(id)) {
    pauseRequested.add(id);
    active.get(id)!.controller.abort();
  } else if (dl.state === 'queued') {
    downloadsRepo.updateDownload(id, { state: 'paused' });
    broadcastEvent('downloads:stateChanged', { id, gameFileId: dl.game_file_id, state: 'paused' });
  }
  return downloadsRepo.getDownload(id);
}

export function resume(id: number): DownloadDTO | null {
  const dl = downloadsRepo.getDownloadInternal(id);
  if (!dl) return null;
  if (dl.state === 'paused' || dl.state === 'failed') {
    downloadsRepo.updateDownload(id, { state: 'queued', error: null });
    broadcastEvent('downloads:stateChanged', { id, gameFileId: dl.game_file_id, state: 'queued' });
    pump();
  }
  return downloadsRepo.getDownload(id);
}

export function cancel(id: number): DownloadDTO | null {
  const dl = downloadsRepo.getDownloadInternal(id);
  if (!dl) return null;
  cancelRequested.add(id);
  if (active.has(id)) {
    active.get(id)!.controller.abort();
  } else {
    if (dl.temp_path) void removeTempArtifacts(dl.temp_path);
    retryCounts.delete(id);
    downloadsRepo.updateDownload(id, { state: 'canceled', tempPath: null, resumeOffset: 0 });
    settleCacheState(dl.game_file_id, 'remote');
    broadcastEvent('downloads:stateChanged', { id, gameFileId: dl.game_file_id, state: 'canceled' });
    rejectWaiters(dl.game_file_id, new Error('canceled'));
    cancelRequested.delete(id);
  }
  return downloadsRepo.getDownload(id);
}

/** Aborts any in-flight download for the given game_file ids (cleaning up the .part). */
function abortActiveForFiles(fileIds: Set<number>): void {
  for (const [id, job] of active) {
    if (fileIds.has(job.gameFileId)) {
      cancelRequested.add(id); // run()'s aborted path removes the .part
      job.controller.abort();
    }
  }
}

/**
 * Remove a game from the library: stop any in-flight download for its files, delete
 * the DB rows (FK cascade drops game_files/cache_entries/downloads/media/saves) and
 * remove the on-disk blobs and cached art. (.part files for an active download are
 * removed by run()'s abort path; included here for the paused case.)
 */
export async function removeGameFromLibrary(gameId: number): Promise<void> {
  const paths = gamesRepo.collectGameRemovalPaths(gameId);
  abortActiveForFiles(new Set(paths.fileIds));
  for (const fid of paths.fileIds) rejectWaiters(fid, new Error('removed from library'));
  gamesRepo.deleteGame(gameId);
  await Promise.all([
    ...[
      ...paths.blobs,
      ...paths.parts,
      ...paths.parts.map((p) => `${p}.parts`),
      ...paths.parts.map((p) => `${p}.aria2`),
      ...paths.media,
    ]
      .filter(Boolean)
      .map((p) => rm(p, { force: true }).catch(() => undefined)),
    // Zip-extraction folders hold several inner files - remove the whole folder.
    ...paths.dirs.filter(Boolean).map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  ]);
  broadcastEvent('cache:changed', cache.stats());
}

/**
 * Uninstall: remove a game's downloaded files (blobs, .part sidecars, extract folders) and
 * their DB rows (game_files → cascade cache_entries/downloads), but KEEP the games row + its
 * cover art. The title stays in the library as a not-downloaded entry, ready to re-install.
 */
export async function uninstallGame(gameId: number): Promise<void> {
  const paths = gamesRepo.collectGameRemovalPaths(gameId);
  abortActiveForFiles(new Set(paths.fileIds));
  for (const fid of paths.fileIds) rejectWaiters(fid, new Error('uninstalled'));
  gameFilesRepo.deleteFilesForGame(gameId); // cascades cache_entries + downloads; keeps the game
  await Promise.all([
    ...[
      ...paths.blobs,
      ...paths.parts,
      ...paths.parts.map((p) => `${p}.parts`),
      ...paths.parts.map((p) => `${p}.aria2`),
    ]
      .filter(Boolean)
      .map((p) => rm(p, { force: true }).catch(() => undefined)),
    ...paths.dirs.filter(Boolean).map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  ]);
  broadcastEvent('cache:changed', cache.stats());
}

/**
 * Startup reconciliation: a previous run that exited mid-download leaves rows stuck
 * in 'downloading'/'verifying' with no active job. Resume them from the bytes
 * actually on disk (the live offset isn't persisted mid-stream) by re-pointing
 * resume_offset at the .part size and requeueing. The provider's range validation
 * + the checksum verify guard against a changed remote. Intentionally-paused
 * downloads are untouched.
 */
export async function reconcileInterruptedDownloads(): Promise<void> {
  const stuck = downloadsRepo.listInternalByStates(['downloading', 'verifying']);
  for (const dl of stuck) {
    // aria2 preallocates the FULL file (falloc), so the .part size says nothing about
    // progress - when its .aria2 control file exists, the engine self-resumes from it
    // and resume_offset must stay 0 (else the UI claims ~100% and a fallback engine
    // would resume from a bogus offset). The .part-size heuristic is only for the
    // built-in single-stream engine, whose .part grows contiguously.
    const hasControlFile = dl.temp_path
      ? await fsStat(`${dl.temp_path}.aria2`)
          .then(() => true)
          .catch(() => false)
      : false;
    const offset =
      dl.temp_path && !hasControlFile
        ? await fsStat(dl.temp_path)
            .then((s) => s.size)
            .catch(() => 0)
        : 0;
    downloadsRepo.updateDownload(dl.id, { state: 'queued', resumeOffset: offset, error: null });
    settleCacheState(dl.game_file_id, 'remote');
    broadcastEvent('downloads:stateChanged', { id: dl.id, gameFileId: dl.game_file_id, state: 'queued' });
  }
  if (stuck.length > 0) pump();
}

/** Resolves when the file is cached; rejects on failed/canceled. Used by launch. */
export function awaitCompletion(gameFileId: number): Promise<void> {
  const file = gameFilesRepo.getFileRow(gameFileId);
  if (file?.cache_state === 'cached') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const arr = waiters.get(gameFileId) ?? [];
    arr.push({ resolve, reject });
    waiters.set(gameFileId, arr);
  });
}

function pump(): void {
  while (active.size < MAX_CONCURRENT) {
    const next = downloadsRepo.nextQueued();
    if (!next) break;
    // Mark as downloading synchronously so the same row isn't picked twice.
    downloadsRepo.updateDownload(next.id, { state: 'downloading' });
    void run(next.id, next.game_file_id);
  }
}

async function run(id: number, gameFileId: number): Promise<void> {
  const dl = downloadsRepo.getDownloadInternal(id);
  const file = gameFilesRepo.getFileRow(gameFileId);
  if (!dl || !file) {
    fail(id, gameFileId, 'download row or file missing');
    pump();
    return;
  }

  // Already acquired: never re-stream a (potentially multi-GB) file. A second
  // catalog:download / a re-opened detail page must be a no-op. (enqueue only
  // de-dupes NON-terminal rows; a 'completed' row is terminal, so the guard
  // lives here.) Touch LRU and report completed.
  if (file.cache_state === 'cached') {
    const entry = cacheRepo.getEntryByFile(file.id);
    if (entry) {
      cache.touch(entry.cache_key);
      downloadsRepo.updateDownload(id, {
        state: 'completed',
        bytesReceived: entry.size_bytes,
        bytesTotal: entry.size_bytes,
        resumeOffset: entry.size_bytes,
      });
      broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'completed' });
      resolveWaiters(gameFileId);
      broadcastEvent('cache:changed', cache.stats());
      pump();
      return;
    }
  }

  const provider = resolveProvider(file);
  if (!provider) {
    fail(
      id,
      gameFileId,
      file.source === 'archive-org' ? 'No download source for this game.' : 'Storage is not configured.',
    );
    pump();
    return;
  }

  const controller = new AbortController();
  active.set(id, { controller, gameFileId });

  try {
    await cache.ensureCacheDir();
    const finalPath = resolveDownloadDest(file);
    const tempPath = `${finalPath}.part`;
    await mkdir(dirname(finalPath), { recursive: true });

    const caps = provider.getCapabilities();
    let rangeStart = caps.supportsRanged ? dl.resume_offset : 0;
    if (rangeStart > 0) {
      // Never request a range beyond what is physically on disk. A resume_offset
      // can outrun the .part if the process died between a progress tick and the
      // flush, or the .part was evicted/truncated externally; clamp to the actual
      // size so we never open 'r+' past EOF and leave an unwritten gap.
      const partSize = await fsStat(tempPath)
        .then((s) => s.size)
        .catch(() => 0);
      if (partSize < rangeStart) rangeStart = partSize;
    }

    // Pre-download free-disk-space check (these can be multi-GB files).
    if (file.size_bytes && file.size_bytes > 0) {
      const need = file.size_bytes - rangeStart + FREE_SPACE_MARGIN;
      if (!(await hasFreeSpace(dirname(finalPath), need))) {
        active.delete(id);
        fail(id, gameFileId, 'Not enough free disk space for this download.');
        pump();
        return;
      }
    }

    // Seed bytes_total up front so the progress bar is determinate from byte 0
    // (the throttled tick might not fire on a fast failure/tiny file).
    downloadsRepo.updateDownload(id, { tempPath, resumeOffset: rangeStart, bytesTotal: file.size_bytes ?? null });
    gameFilesRepo.setCacheState(file.id, 'downloading');
    broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'downloading' });
    broadcastEvent('downloads:progress', {
      id,
      gameFileId,
      fraction: file.size_bytes ? rangeStart / file.size_bytes : null,
      bytesReceived: rangeStart,
      bytesTotal: file.size_bytes ?? null,
      bytesPerSecond: 0,
    });

    let lastEmit = 0;
    let lastBytes = rangeStart;
    let lastTime = Date.now();
    let smoothedBps = 0; // EMA - the raw per-tick rate jitters too much to display
    const result = await provider.download(file.storage_key, {
      destPath: tempPath,
      rangeStart,
      // On resume, send the validators captured at pause so a changed remote forces
      // a clean full restart (200) instead of a corrupt append.
      ifRange: rangeStart > 0 ? { etag: dl.etag, lastModified: dl.last_modified } : undefined,
      signal: controller.signal,
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastEmit < 250) return;
        const elapsed = (now - lastTime) / 1000;
        const bps = elapsed > 0 ? (p.bytesReceived - lastBytes) / elapsed : 0;
        smoothedBps = smoothedBps > 0 ? smoothedBps * 0.7 + bps * 0.3 : bps;
        lastEmit = now;
        lastBytes = p.bytesReceived;
        lastTime = now;
        // NOTE: do NOT persist resume_offset from the live progress tick - that
        // value is bytes received off the socket, which can outrun bytes flushed
        // to disk. resume_offset is advanced only at the 'paused' transition below
        // (from the provider's disk-derived bytesWritten) and on completion.
        downloadsRepo.updateDownload(id, {
          bytesReceived: p.bytesReceived,
          bytesTotal: p.bytesTotal,
        });
        broadcastEvent('downloads:progress', {
          id,
          gameFileId,
          fraction: p.fraction,
          bytesReceived: p.bytesReceived,
          bytesTotal: p.bytesTotal,
          bytesPerSecond: Math.round(smoothedBps),
        });
      },
    });

    active.delete(id);

    if (result.outcome === 'aborted') {
      if (cancelRequested.has(id)) {
        cancelRequested.delete(id);
        retryCounts.delete(id);
        await removeTempArtifacts(tempPath);
        downloadsRepo.updateDownload(id, { state: 'canceled', tempPath: null, resumeOffset: 0 });
        settleCacheState(file.id, 'remote');
        broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'canceled' });
        rejectWaiters(gameFileId, new Error('canceled'));
      } else {
        pauseRequested.delete(id);
        // Persist the disk-accurate resume offset AND the range validators, so the
        // resume can send If-Range and detect a changed remote.
        downloadsRepo.updateDownload(id, {
          state: 'paused',
          resumeOffset: result.bytesWritten,
          etag: result.etag ?? null,
          lastModified: result.lastModified ?? null,
        });
        settleCacheState(file.id, 'remote');
        broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'paused' });
      }
      pump();
      return;
    }

    // Verify (mandatory when an expected checksum exists) before promoting .part.
    downloadsRepo.updateDownload(id, { state: 'verifying' });
    broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'verifying' });
    let verified = false;
    if (dl.checksum_expected && dl.checksum_algo) {
      const ok = await verifyFile(tempPath, { algo: dl.checksum_algo, value: dl.checksum_expected });
      if (!ok) {
        await removeTempArtifacts(tempPath);
        fail(id, gameFileId, 'checksum mismatch');
        pump();
        return;
      }
      verified = true;
    } else {
      // No expected checksum: hash post-download to populate hashes for scraping.
      const hashes = await hashFile(tempPath);
      gameFilesRepo.setHashes(file.id, hashes, 'post_download');
    }

    await rename(tempPath, finalPath);

    if (sourceNeedsExtract(file.source)) {
      // Per-game .zip wrapping a disc image the emulator can't read: unzip it, launch the
      // extracted file, and delete the zip (extract-on-download, keep-only-image). The
      // extraction phase reuses the 'verifying' state; progress ticks show it advancing.
      let extracted;
      try {
        extracted = await extractGameZip(finalPath, {
          signal: controller.signal,
          onProgress: (done, total) => {
            const now = Date.now();
            if (now - lastEmit < 250) return;
            lastEmit = now;
            broadcastEvent('downloads:progress', {
              id,
              gameFileId,
              fraction: total ? done / total : null,
              bytesReceived: done,
              bytesTotal: total,
              bytesPerSecond: 0,
            });
          },
        });
      } catch (e) {
        await rm(finalPath, { force: true }).catch(() => undefined);
        fail(id, gameFileId, e instanceof Error ? `extraction failed: ${e.message}` : 'extraction failed');
        pump();
        return;
      }
      await rm(finalPath, { force: true }).catch(() => undefined); // the zip is no longer needed
      // A zip-wrapped PS3 Redump disc (e.g. Minerva) unzips to an ENCRYPTED iso - decrypt it.
      try {
        await decryptPs3IfNeeded(file.game_id, extracted.launchPath, id, gameFileId);
      } catch (e) {
        await rm(extracted.launchPath, { force: true }).catch(() => undefined);
        if (extracted.extractDir) await rm(extracted.extractDir, { recursive: true, force: true }).catch(() => undefined);
        fail(id, gameFileId, ps3FailureMessage(e));
        pump();
        return;
      }
      cache.add({
        gameFileId: file.id,
        cacheKey: file.storage_key,
        localPath: extracted.launchPath,
        // For an extracted TREE the launch file is just the boot stub (an EBOOT.BIN is a
        // few MB of a multi-GB title), so the LRU must account for the whole folder it
        // evicts. A flat single file is stat'd directly - it may have been swapped by the
        // PS3 decrypt above, so its on-disk size is the authoritative one.
        sizeBytes: extracted.extractDir ? extracted.totalBytes : (await fsStat(extracted.launchPath)).size,
        verified,
        extractDir: extracted.extractDir,
      });
      gameFilesRepo.setCacheState(file.id, 'cached');
      cache.pin(file.id, true); // owned catalog file - don't let LRU evict it
      downloadsRepo.updateDownload(id, {
        state: 'completed',
        bytesReceived: extracted.totalBytes,
        bytesTotal: extracted.totalBytes,
        resumeOffset: extracted.totalBytes,
      });
    } else {
      // A raw PS3 Redump .iso (e.g. archive.org sony_playstation3_*) arrives ENCRYPTED -
      // decrypt in place so RPCS3 can boot it (no-op for other systems / already-decrypted).
      try {
        await decryptPs3IfNeeded(file.game_id, finalPath, id, gameFileId);
      } catch (e) {
        await rm(finalPath, { force: true }).catch(() => undefined);
        fail(id, gameFileId, ps3FailureMessage(e));
        pump();
        return;
      }
      const size = (await fsStat(finalPath)).size;
      cache.add({ gameFileId: file.id, cacheKey: file.storage_key, localPath: finalPath, sizeBytes: size, verified });
      gameFilesRepo.setCacheState(file.id, 'cached');
      // A catalog-acquired (owned) file is durable, not transient on-demand cache -
      // pin it so a later download can't LRU-evict the game out from under the user.
      if (file.source !== 'local') cache.pin(file.id, true);
      downloadsRepo.updateDownload(id, { state: 'completed', bytesReceived: size, bytesTotal: size, resumeOffset: size });
    }
    broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'completed' });
    retryCounts.delete(id);
    resolveWaiters(gameFileId);

    await cache.enforceLimit(new Set([file.id, ...activeFileIds()]));
    broadcastEvent('cache:changed', cache.stats());
    pump();
  } catch (err) {
    active.delete(id);
    const message = err instanceof Error ? err.message : 'download failed';
    // Transient network errors shouldn't kill a multi-GB transfer: requeue with the
    // resume offset re-derived from what's physically on disk (same rules as the
    // startup reconcile - an aria2 control file means the engine self-resumes, so
    // the offset stays 0) and back off before pumping again.
    const attempt = (retryCounts.get(id) ?? 0) + 1;
    if (attempt <= MAX_AUTO_RETRIES && !cancelRequested.has(id) && !controller.signal.aborted) {
      retryCounts.set(id, attempt);
      const fileRow = gameFilesRepo.getFileRow(gameFileId);
      let offset = 0;
      if (fileRow) {
        const tempPath = `${resolveDownloadDest(fileRow)}.part`;
        const hasControlFile = await fsStat(`${tempPath}.aria2`)
          .then(() => true)
          .catch(() => false);
        offset = hasControlFile
          ? 0
          : await fsStat(tempPath)
              .then((s) => s.size)
              .catch(() => 0);
      }
      if (!app.isPackaged) console.warn(`[downloads] retry ${attempt}/${MAX_AUTO_RETRIES} for #${id}: ${message}`);
      downloadsRepo.updateDownload(id, { state: 'queued', resumeOffset: offset, error: null });
      settleCacheState(gameFileId, 'remote');
      broadcastEvent('downloads:stateChanged', { id, gameFileId, state: 'queued' });
      setTimeout(pump, RETRY_BASE_DELAY_MS * attempt);
      return;
    }
    fail(id, gameFileId, message);
    pump();
  }
}
