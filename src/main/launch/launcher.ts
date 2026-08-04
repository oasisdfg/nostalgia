import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { stat as fsStat } from 'node:fs/promises';
import { broadcastEvent } from '../ipc/registry';
import { resolveArgs } from './tokens';
import { configureEmulator } from '../emulators/configure';
import { resolveLaunch } from '../db/repositories/launchResolverRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getActiveSystemEmulator } from '../db/repositories/systemEmulatorRepo';
import { getEmulator } from '../db/repositories/emulatorsRepo';
import * as playSessions from '../db/repositories/playSessionsRepo';
import { discoverSavesForGame } from '../saves/discovery';
import * as downloadManager from '../storage/downloadManager';
import * as cache from '../storage/cache';
import { getFileRow, setCacheState } from '../db/repositories/gameFilesRepo';
import type { GameFileRow } from '../db/repositories/types';
import { getEntryByFile } from '../db/repositories/cacheRepo';

/**
 * Before re-downloading gigabytes, try to reclaim a file the user relocated - e.g. they
 * changed storage.root (or cache.dir) in Settings and moved their library folder. The
 * cache_entries.local_path recorded at download time is now stale, so verifyPresent fails
 * and the launcher would otherwise re-download. This recomputes the file's canonical
 * on-disk destination from the CURRENT settings; if the bytes are sitting there and the
 * size matches, it re-links the cache_entry (marks the file cached, re-pins if owned) and
 * returns the path. Returns null when nothing usable is found, so the caller downloads.
 *
 * Scoped to single-file games: a zip-extracted multi-file game (extract_dir) can't be
 * re-derived from the download destination, so those still fall through to re-download.
 */
async function reclaimRelocatedFile(file: GameFileRow): Promise<string | null> {
  const existing = getEntryByFile(file.id);
  if (existing?.extract_dir) return null;
  const candidate = downloadManager.resolveDownloadDest(file);
  try {
    const st = await fsStat(candidate);
    // Size is the cheap integrity gate; a full re-hash on every launch would be too slow.
    // The original download was checksum-verified, so a byte-exact size is a safe adopt.
    if (file.size_bytes != null && st.size !== file.size_bytes) return null;
    cache.add({
      gameFileId: file.id,
      cacheKey: file.storage_key,
      localPath: candidate,
      sizeBytes: st.size,
      verified: false,
    });
    setCacheState(file.id, 'cached');
    if (file.source !== 'local') cache.pin(file.id, true); // owned - exempt from LRU eviction
    return candidate;
  } catch {
    return null; // not at the current location - fall back to download
  }
}

/**
 * Guarantees the file's bytes are local and returns the on-disk path. The rom
 * path is ALWAYS cache_entries.local_path for the launched file - there is no
 * game_files.local_path column. Triggers/awaits the download on a cache miss.
 */
export async function ensureCached(gameFileId: number): Promise<string> {
  const file = getFileRow(gameFileId);
  if (!file) throw new Error('File not found.');
  // Re-download when the file isn't cached OR its 'cached' blob is missing on disk (a
  // stale entry / moved-or-deleted file) - never launch the emulator with a bad path.
  const present = file.cache_state === 'cached' && (await cache.verifyPresent(gameFileId));
  if (!present) {
    // The user may have simply moved their library (changed storage.root). Adopt the
    // file in place before spending bandwidth re-downloading it.
    const reclaimed = await reclaimRelocatedFile(file);
    if (!reclaimed) {
      downloadManager.enqueue(gameFileId, 100); // elevated priority for launch
      await downloadManager.awaitCompletion(gameFileId);
    }
  }
  const entry = getEntryByFile(gameFileId);
  if (!entry) throw new Error('Cached file path is missing after download.');
  cache.touch(entry.cache_key);
  return entry.local_path;
}

/**
 * Opens the emulator bound to a system with NO game - the user wants its own UI (BIOS setup,
 * controller config, save-state manager). Deliberately spawns with an EMPTY argv rather than
 * the launch template: every template centres on {romPath}, and passing a template with an
 * unsubstituted token would hand the emulator a bogus argument. No play_sessions row either,
 * since nothing is being played. exe_path is main-resolved as always - the renderer only
 * supplies a systemId, never a path.
 */
export async function launchEmulatorForSystem(systemId: number): Promise<{ pid: number }> {
  const system = getSystem(systemId);
  if (!system) throw new Error('System not found.');
  const binding = getActiveSystemEmulator(systemId);
  if (!binding) throw new Error(`No emulator is configured for ${system.name}. Set one in Settings.`);
  const emulator = getEmulator(binding.emulatorId);
  if (!emulator) throw new Error('The configured emulator no longer exists.');

  await configureEmulator(emulator.exePath).catch(() => undefined);

  const child = spawn(emulator.exePath, [], {
    cwd: emulator.workingDir ?? dirname(emulator.exePath),
    windowsHide: false,
    stdio: 'ignore',
  });
  try {
    await once(child, 'spawn');
  } catch {
    throw new Error("Couldn't start the emulator - check its path in Settings.");
  }
  child.on('error', (err) => console.error('[launch] failed to spawn emulator', err));
  return { pid: child.pid ?? -1 };
}

export async function launch(gameId: number, gameFileId?: number): Promise<{ sessionId: number; pid: number }> {
  const ctx = resolveLaunch(gameId, gameFileId);
  const romPath = await ensureCached(ctx.gameFileId);

  // Best-effort: apply the config-file fullscreen/controller patch for emulators without a
  // CLI flag (idempotent, backs up once, existing-config only - see configure.ts). Never
  // blocks or fails a launch.
  await configureEmulator(ctx.exePath).catch(() => undefined);

  // Element-wise token substitution -> argv array. Never a concatenated command
  // string, never shell:true. Paths are passed verbatim (opaque).
  const argv = resolveArgs(ctx.template, {
    romPath,
    systemSlug: ctx.systemSlug,
    emulatorDir: dirname(ctx.exePath),
  });

  const child = spawn(ctx.exePath, argv, {
    cwd: ctx.workingDir ?? dirname(ctx.exePath),
    windowsHide: false,
    stdio: 'ignore',
  });

  // Wait for the process to actually start. events.once rejects if 'error' fires
  // first (bad/moved/non-executable exe path), so a spawn failure rejects
  // launch:start with a clear message instead of silently doing nothing.
  try {
    await once(child, 'spawn');
  } catch {
    throw new Error("Couldn't start the emulator - check its path in Settings.");
  }

  const sessionId = playSessions.open({ gameId, gameFileId: ctx.gameFileId, emulatorId: ctx.emulatorId });

  child.on('exit', (code) => {
    playSessions.close(sessionId, code);
    playSessions.rollupPlay(gameId);
    broadcastEvent('launch:exited', { sessionId, gameId, exitCode: code });
    // Re-discover saves the emulator may have written this session.
    void discoverSavesForGame(gameId);
  });
  child.on('error', (err) => {
    playSessions.close(sessionId, -1);
    broadcastEvent('launch:exited', { sessionId, gameId, exitCode: -1 });
    console.error('[launch] failed to spawn emulator', err);
  });

  return { sessionId, pid: child.pid ?? -1 };
}
