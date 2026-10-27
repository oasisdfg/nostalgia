import { net } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { RecompInstallState, RecompManifest } from '@shared/contracts/recomps';
import { broadcastEvent } from '../ipc/registry';
import { getInstall, upsertInstall, type RecompInstallRow } from '../db/repositories/recompsRepo';
import { extractGameZip } from '../storage/extract';
import { fetchLatestRelease, assetFor, isSafeTag, GithubError } from './github';
import { getManifest } from './registry';
import { portDir, joinInside, expandSaveDir, isInside } from './paths';

/**
 * Port install/update pipeline: download the release asset → verify SHA-256 (when the
 * release publishes sums) → extract into <recomps.dir>/<id>/<tag>/. Separate from the
 * game DownloadManager, which is keyed by game_file_id. Never touches game files.
 */

const PROGRESS_INTERVAL_MS = 250; // ~4 Hz, like downloads:progress
const jobs = new Map<string, AbortController>();

/** True while any port is downloading/verifying/extracting (the self-update install gate). */
export function isInstalling(): boolean {
  return jobs.size > 0;
}

export function isInstallingPort(id: string): boolean {
  return jobs.has(id);
}

class InstallError extends Error {}

function setState(id: string, state: RecompInstallState, error: string | null = null): void {
  upsertInstall(id, { state, last_error: error });
  broadcastEvent('recomps:stateChanged', { id, state, error });
}

function progress(id: string, bytesReceived: number, bytesTotal: number | null): void {
  broadcastEvent('recomps:progress', {
    id,
    fraction: bytesTotal ? Math.min(1, bytesReceived / bytesTotal) : 0,
    bytesReceived,
    bytesTotal,
  });
}

/** Locates the exe inside a fresh install, allowing for one wrapping top-level folder. */
async function resolveExe(tagDir: string, manifest: RecompManifest): Promise<{ installDir: string; exePath: string }> {
  const direct = joinInside(tagDir, manifest.exe);
  if (existsSync(direct)) return { installDir: tagDir, exePath: direct };
  const entries = await readdir(tagDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = join(tagDir, entries[0].name);
    const nested = joinInside(inner, manifest.exe);
    if (existsSync(nested)) return { installDir: inner, exePath: nested };
  }
  throw new InstallError(`The download didn't contain ${basename(manifest.exe)}.`);
}

/** The version folder an install lives in (<portDir>/<tag>), for removal. */
function tagDirOf(id: string, tag: string | null): string | null {
  return tag && isSafeTag(tag) ? join(portDir(id), tag) : null;
}

/**
 * Copies every existing save folder to <portDir>/save-backups/<timestamp>/<n>/. Run before
 * anything replaces or removes an install, so a port's saves can't be lost to an update,
 * rollback or uninstall.
 */
async function backupSaves(manifest: RecompManifest, installDir: string | null): Promise<void> {
  const stamp = String(Date.now());
  let n = 0;
  for (const tpl of manifest.saveDirs) {
    const dir = expandSaveDir(tpl, installDir);
    n++;
    if (!dir || !existsSync(dir)) continue;
    await cp(dir, join(portDir(manifest.id), 'save-backups', stamp, String(n)), { recursive: true });
  }
}

/** Saves kept INSIDE the install (e.g. SoH's Save/) follow the user to the new version. */
async function carrySaves(manifest: RecompManifest, fromDir: string, toDir: string): Promise<void> {
  for (const tpl of manifest.saveDirs) {
    if (!tpl.includes('{installDir}')) continue;
    const from = expandSaveDir(tpl, fromDir);
    const to = expandSaveDir(tpl, toDir);
    if (!from || !to || !existsSync(from) || existsSync(to)) continue;
    await cp(from, to, { recursive: true });
  }
}

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

/** The expected hash for `assetName` from a SHA256SUMS / *.sha256 body, or null. */
function expectedSha256(body: string, assetName: string): string | null {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(l);
    if (m && basename(m[2].trim()) === assetName) return m[1].toLowerCase();
  }
  // A single-hash .sha256 file for this one asset.
  if (lines.length === 1 && /^[0-9a-fA-F]{64}$/.test(lines[0])) return lines[0].toLowerCase();
  return null;
}

async function download(id: string, url: string, dest: string, signal: AbortSignal, sizeHint: number): Promise<void> {
  const res = await net.fetch(url, { signal, headers: { 'User-Agent': 'Nostalgia' } });
  if (!res.ok || !res.body) throw new InstallError("Couldn't download the port.");
  const total = Number(res.headers.get('content-length')) || sizeHint || null;
  let received = 0;
  let last = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (now - last >= PROGRESS_INTERVAL_MS) {
        last = now;
        progress(id, received, total);
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), counter, createWriteStream(dest), { signal });
  progress(id, received, total);
}

/**
 * Starts installing (or updating to) the port's latest release in the background and
 * returns immediately; progress and the outcome arrive as recomps:* events.
 */
export function startInstall(id: string): void {
  if (jobs.has(id)) return;
  const manifest = getManifest(id);
  if (!manifest) throw new Error('Unknown port.');
  const controller = new AbortController();
  jobs.set(id, controller);
  setState(id, 'downloading');
  void runInstall(manifest, controller.signal).finally(() => jobs.delete(id));
}

async function runInstall(manifest: RecompManifest, signal: AbortSignal): Promise<void> {
  const id = manifest.id;
  const before = getInstall(id);
  const dir = portDir(id);
  let partPath: string | null = null;
  let zipPath: string | null = null;
  let tagDir: string | null = null;
  try {
    const release = await fetchLatestRelease(manifest.repo).catch((e: unknown) => {
      throw new InstallError(e instanceof GithubError ? e.message : "Couldn't reach GitHub.");
    });
    if (!release) throw new InstallError("Couldn't read the port's latest release.");
    if (!isSafeTag(release.tag)) throw new InstallError("This port's release has an unusual version name.");
    upsertInstall(id, { latest_tag: release.tag, etag: release.etag, latest_checked_at: Date.now() });
    if (before?.state === 'installed' && before.installed_tag === release.tag && before.exe_path && existsSync(before.exe_path)) {
      setState(id, 'installed'); // already on the latest version
      return;
    }
    const asset = assetFor(release, manifest);
    if (!asset) throw new InstallError("The latest release has no Windows download.");
    if (!asset.name.toLowerCase().endsWith('.zip')) {
      throw new InstallError("This port's download format isn't supported yet.");
    }

    await mkdir(dir, { recursive: true });
    partPath = join(dir, `.${release.tag}.part`);
    await download(id, asset.url, partPath, signal, asset.size);

    // Verify before anything from the download is unpacked, let alone run.
    if (release.checksumAsset) {
      setState(id, 'verifying');
      const sums = await net.fetch(release.checksumAsset.url, { signal, headers: { 'User-Agent': 'Nostalgia' } });
      const expected = sums.ok ? expectedSha256(await sums.text(), asset.name) : null;
      if (expected && (await sha256(partPath)) !== expected) {
        throw new InstallError("The download didn't match its published checksum, so it wasn't installed.");
      }
    }

    setState(id, 'extracting');
    tagDir = join(dir, release.tag);
    if (before?.installed_tag === release.tag || before?.previous_tag === release.tag) {
      // Re-installing a version that's on disk: back up its saves before replacing it.
      await backupSaves(manifest, before?.install_dir ?? null);
    }
    await rm(tagDir, { recursive: true, force: true });
    zipPath = join(dir, `${release.tag}.zip`);
    await rename(partPath, zipPath);
    partPath = null;
    const extracted = await extractGameZip(zipPath, {
      signal,
      onProgress: (done, total) => progress(id, done, total),
    });
    // A single-file zip extracts flat beside the zip - move it into its version folder.
    if (!extracted.extractDir) {
      await mkdir(tagDir, { recursive: true });
      await rename(extracted.launchPath, join(tagDir, basename(extracted.launchPath)));
    }
    await rm(zipPath, { force: true });
    zipPath = null;
    const { installDir, exePath } = await resolveExe(tagDir, manifest);

    // Updating: back up saves, carry in-install saves forward, and keep exactly one
    // previous version on disk for rollback.
    const patch: Parameters<typeof upsertInstall>[1] = {};
    if (before?.installed_tag && before.install_dir && before.installed_tag !== release.tag) {
      await backupSaves(manifest, before.install_dir);
      await carrySaves(manifest, before.install_dir, installDir);
      const oldPrevious = tagDirOf(id, before.previous_tag);
      if (oldPrevious && before.previous_tag !== release.tag) await rm(oldPrevious, { recursive: true, force: true });
      patch.previous_tag = before.installed_tag;
      patch.previous_dir = before.install_dir;
    }
    upsertInstall(id, {
      ...patch,
      installed_tag: release.tag,
      install_dir: installDir,
      exe_path: exePath,
      // A copied game file has to be placed into the new install again.
      file_delivered: manifest.gameFile.delivery === 'copy' ? 0 : (before?.file_delivered ?? 0),
    });
    setState(id, 'installed');
  } catch (e) {
    if (partPath) await rm(partPath, { force: true }).catch(() => undefined);
    if (zipPath) await rm(zipPath, { force: true }).catch(() => undefined);
    const stillInstalled = before?.installed_tag && before.exe_path && existsSync(before.exe_path);
    // A half-extracted new version is useless; never delete the version still in use.
    if (tagDir && !(stillInstalled && before?.install_dir && isInside(tagDir, before.install_dir))) {
      await rm(tagDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (signal.aborted) {
      setState(id, stillInstalled ? 'installed' : 'not_installed');
      return;
    }
    const message = e instanceof InstallError ? e.message : "The port couldn't be installed.";
    // A failed UPDATE leaves the current version playable; only report the error.
    setState(id, stillInstalled ? 'installed' : 'failed', message);
  }
}

export function cancelInstall(id: string): void {
  jobs.get(id)?.abort();
}

/** Swaps the current and previous versions (saves backed up first). */
export async function rollback(id: string): Promise<void> {
  const manifest = getManifest(id);
  const row = getInstall(id);
  if (!manifest || !row) throw new Error('Unknown port.');
  if (jobs.has(id)) throw new Error('Wait for the install to finish.');
  if (!row.previous_tag || !row.previous_dir || !existsSync(row.previous_dir)) {
    throw new Error('There is no previous version to roll back to.');
  }
  await backupSaves(manifest, row.install_dir);
  if (row.install_dir) await carrySaves(manifest, row.install_dir, row.previous_dir);
  const exePath = joinInside(row.previous_dir, manifest.exe);
  if (!existsSync(exePath)) throw new Error('The previous version is missing its program file.');
  upsertInstall(id, {
    installed_tag: row.previous_tag,
    install_dir: row.previous_dir,
    exe_path: exePath,
    previous_tag: row.installed_tag,
    previous_dir: row.install_dir,
    file_delivered: manifest.gameFile.delivery === 'copy' ? 0 : row.file_delivered,
  });
  setState(id, 'installed');
}

/**
 * Removes the port's program files (current + previous version). Never touches the
 * linked game, its files, or saves - saves kept inside the install are backed up to
 * <portDir>/save-backups first, and that folder is left in place.
 */
export async function uninstall(id: string): Promise<void> {
  const manifest = getManifest(id);
  const row: RecompInstallRow | undefined = getInstall(id);
  if (!manifest) throw new Error('Unknown port.');
  if (jobs.has(id)) {
    cancelInstall(id);
    while (jobs.has(id)) await new Promise((r) => setTimeout(r, 50));
  }
  if (row?.install_dir) await backupSaves(manifest, row.install_dir);
  for (const tag of [row?.installed_tag ?? null, row?.previous_tag ?? null]) {
    const d = tagDirOf(id, tag);
    if (d) await rm(d, { recursive: true, force: true });
  }
  upsertInstall(id, {
    installed_tag: null,
    install_dir: null,
    exe_path: null,
    previous_tag: null,
    previous_dir: null,
    file_delivered: 0,
  });
  setState(id, 'not_installed');
}

/** Reconciles rows left mid-install by a previous run (the job died with the process). */
export async function reconcileInstalls(rows: RecompInstallRow[]): Promise<void> {
  for (const row of rows) {
    if (row.state !== 'downloading' && row.state !== 'verifying' && row.state !== 'extracting') continue;
    const ok = row.exe_path && (await stat(row.exe_path).catch(() => null));
    upsertInstall(row.recomp_id, { state: ok ? 'installed' : row.installed_tag ? 'failed' : 'not_installed' });
  }
}
