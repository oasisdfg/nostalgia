import { app, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { UpdateMode, UpdateStatusDTO } from '@shared/contracts/ipc';
import { broadcastEvent } from '../ipc/registry';
import { hasOpenSession } from '../db/repositories/playSessionsRepo';
import { isBusy } from '../storage/downloadManager';
import { isInstalling as isPortInstalling } from '../recomps/installer';
import { shutdownOnce } from '../lifecycle/shutdown';

/**
 * Nostalgia's own self-update from GitHub Releases (electron-updater). Mandatory and
 * always on for NSIS installs: check ~10 s after startup and every 4 h, download in the
 * background, install on quit (or on "Restart now" when nothing is running). Portable
 * builds can't replace themselves, so they only check and point at the release page.
 */

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 250; // ~4 Hz, same as downloads:progress

// Sessions opened before this process can't be ours to wait on (see hasOpenSession).
const processStartedAt = Date.now();

function log(...args: unknown[]): void {
  if (!app.isPackaged) console.log('[updates]', ...args);
}

/** How this copy of the app may update itself. Not a user setting. */
export function detectUpdateMode(): UpdateMode {
  if (!app.isPackaged) return 'disabled';
  if (process.env.NOSTALGIA_SMOKE === '1') return 'disabled';
  if (process.env.NOSTALGIA_DISABLE_UPDATES === '1') return 'disabled';
  // electron-builder's portable exe sets this; the hand-assembled `npm run package`
  // build ships no app-update.yml. Neither can replace itself.
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'notify';
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) return 'notify';
  return 'auto';
}

let mode: UpdateMode = 'disabled';
let status: UpdateStatusDTO = {
  state: 'idle',
  mode,
  currentVersion: app.getVersion(),
  version: null,
  releaseNotes: null,
  fraction: null,
  checkedAt: null,
  error: null,
};
let started = false;
let checking: Promise<void> | null = null;

function setStatus(patch: Partial<UpdateStatusDTO>): void {
  status = { ...status, ...patch };
  broadcastEvent('updates:status', status);
}

export function getUpdateStatus(): UpdateStatusDTO {
  return status;
}

/** Release notes arrive as HTML (GitHub renders the markdown) - reduce to plain text. */
function plainNotes(notes: UpdateInfo['releaseNotes']): string | null {
  if (!notes) return null;
  const raw = typeof notes === 'string' ? notes : notes.map((n) => n.note ?? '').join('\n\n');
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function wireEvents(): void {
  let lastProgress = 0;
  autoUpdater.on('checking-for-update', () => {
    // A periodic re-check must not knock an in-flight/finished download back to "checking".
    if (status.state === 'downloading' || status.state === 'downloaded') return;
    setStatus({ state: 'checking', error: null });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setStatus({
      state: mode === 'auto' ? 'downloading' : 'available',
      version: info.version,
      releaseNotes: plainNotes(info.releaseNotes),
      fraction: mode === 'auto' ? 0 : null,
      checkedAt: Date.now(),
      error: null,
    });
  });
  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'not-available', version: null, releaseNotes: null, fraction: null, checkedAt: Date.now(), error: null });
  });
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const now = Date.now();
    if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    const fraction = Math.max(0, Math.min(1, p.percent / 100));
    status = { ...status, state: 'downloading', fraction };
    broadcastEvent('updates:progress', { fraction, bytesPerSecond: p.bytesPerSecond });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setStatus({
      state: 'downloaded',
      version: info.version,
      releaseNotes: plainNotes(info.releaseNotes) ?? status.releaseNotes,
      fraction: 1,
      error: null,
    });
  });
  autoUpdater.on('error', (err: Error) => {
    log('error', err?.message);
    // Raw messages carry URLs/stack traces - only a short human message reaches the DTO.
    const duringDownload = status.state === 'downloading';
    setStatus({
      state: 'error',
      fraction: null,
      checkedAt: Date.now(),
      error: duringDownload ? 'Update download failed, will retry' : "Couldn't reach GitHub to check for updates",
    });
  });
}

/** One check (deduped). Errors surface through the 'error' event; retried on the next tick. */
function check(): Promise<void> {
  if (mode === 'disabled') return Promise.resolve();
  // A downloaded update is waiting for a restart - nothing more to fetch.
  if (status.state === 'downloaded') return Promise.resolve();
  if (!checking) {
    checking = autoUpdater
      .checkForUpdates()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        checking = null;
      });
  }
  return checking;
}

/** Call once after the main window exists. No-op (and no network) when disabled. */
export function startUpdater(): void {
  if (started) return;
  started = true;
  mode = detectUpdateMode();
  status = { ...status, mode };
  log('mode', mode);
  if (mode === 'disabled') return;

  autoUpdater.logger = {
    info: (m?: unknown) => log(m),
    warn: (m?: unknown) => log('warn', m),
    error: (m?: unknown) => log('error', m),
    debug: (m: string) => log('debug', m),
  };
  autoUpdater.allowPrerelease = false;
  if (mode === 'auto') {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  } else {
    // Check only: show "available", never download or install.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // The hand-assembled portable build has no app-update.yml to read the feed from.
    if (__UPDATE_OWNER__ && __UPDATE_REPO__) {
      autoUpdater.setFeedURL({ provider: 'github', owner: __UPDATE_OWNER__, repo: __UPDATE_REPO__ });
    }
  }
  wireEvents();

  // Wait out startup work (folder scans, download reconcile) before the first check.
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_INTERVAL_MS);
  }, FIRST_CHECK_DELAY_MS);
}

/** Manual "Check for updates". Resolves with the status after the check settles. */
export async function checkNow(): Promise<UpdateStatusDTO> {
  await check();
  return status;
}

/** Whether quitting now would interrupt something the user is doing. */
export function canInstallNow(): { ok: boolean; reason?: string } {
  if (hasOpenSession(processStartedAt)) return { ok: false, reason: 'A game is running.' };
  if (isBusy()) return { ok: false, reason: 'A download is in progress.' };
  if (isPortInstalling()) return { ok: false, reason: 'A Native Port is installing.' };
  return { ok: true };
}

/**
 * "Restart now": install the downloaded update if nothing is running. When refused, the
 * update still installs on the next normal quit (autoInstallOnAppQuit).
 */
export function restartAndInstall(): { ok: boolean; reason?: string } {
  if (mode !== 'auto' || status.state !== 'downloaded') {
    return { ok: false, reason: 'No update is ready to install.' };
  }
  const gate = canInstallNow();
  if (!gate.ok) return gate;
  shutdownOnce();
  // Silent install: perMachine NSIS still raises its one UAC prompt, then relaunches the
  // app (isForceRunAfter) without walking the user through the installer wizard again.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return { ok: true };
}

/** The latest-release page, built here from the publish config (never from the renderer). */
export async function openReleasePage(): Promise<void> {
  if (!__UPDATE_OWNER__ || !__UPDATE_REPO__) return;
  await shell.openExternal(`https://github.com/${__UPDATE_OWNER__}/${__UPDATE_REPO__}/releases/latest`);
}
