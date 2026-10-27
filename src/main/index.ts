import { app, net, BrowserWindow } from 'electron';
import { join, sep } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, existsSync, readdirSync, renameSync, cpSync, rmSync } from 'node:fs';
import { getSetting, setSetting } from './db/repositories/settingsRepo';
import { loadDotEnv } from './env';
import { getDb } from './db/connection';
import { migrate, currentSchemaVersion } from './db/migrate';
import { seedBuiltinSystems } from './db/seed/builtinSystems';
import { seedDefaultSettings } from './db/seed/defaults';
import { createWindow } from './windows/createWindow';
import { registerAssetSchemePrivileged, registerAssetProtocol } from './protocol/asset';
import { installCsp } from './security/csp';
import { registerIpc } from './ipc';
import { reconcileInterruptedDownloads, reconcileCacheStates } from './storage/downloadManager';
import { upgradeKnownEmulatorArgs, autoBindEmulators } from './emulators/detect';
import { healEmulatorPaths } from './emulators/healPaths';
import { scanSystemFolder } from './storage/folderScan';
import { listSystems } from './db/repositories/systemsRepo';
import { shutdownOnce } from './lifecycle/shutdown';
import { startUpdater } from './updates/updater';
import { autoLink } from './recomps/linker';
import { checkPortsAtStartup } from './recomps/github';
import { reconcileInstalls } from './recomps/installer';
import { listInstalls } from './db/repositories/recompsRepo';

const smoke = process.env.NOSTALGIA_SMOKE === '1';

// Relocate ALL app data out of %APPDATA%\Roaming into a visible, user-writable folder
// (Documents\Nostalgia). Every `app.getPath('userData')` call across the app - the DB,
// cache, downloaded games, emulators, saves, art, the asset:// roots - resolves here,
// so this single override moves everything. Overridable via NOSTALGIA_DATA_DIR. Must run
// before the app is ready (and before any userData path is read). Skipped under smoke,
// which keeps its own throwaway dirs. The app installs to Program Files but runs
// unelevated, so its data must live somewhere the user can write without elevation -
// Program Files is not that place.
//
// On first launch after the move, one-time-migrate a prior install's data from the old
// default location; `legacyDataDir` is kept so the DB's absolute path settings can be
// rewritten once the DB is open (see whenReady).
let legacyDataDir: string | null = null;
if (!smoke) {
  const legacyDir = app.getPath('userData'); // the OLD default: %APPDATA%\Roaming\Nostalgia
  const dataDir = process.env.NOSTALGIA_DATA_DIR || join(app.getPath('documents'), 'Nostalgia');
  mkdirSync(dataDir, { recursive: true });
  if (migrateLegacyData(legacyDir, dataDir)) legacyDataDir = legacyDir;
  app.setPath('userData', dataDir);
}

/**
 * One-time move of a prior install's data from `legacyDir` (old default userData) into
 * `dataDir` (new location). Only runs when the old dir holds a database AND the new dir
 * has not been initialized yet, so it fires exactly once and never clobbers newer data.
 * Moves per top-level entry (fast rename on the same volume; copy+remove across volumes).
 * Best-effort: a failure must not block startup. Returns true if a migration ran.
 */
function migrateLegacyData(legacyDir: string, dataDir: string): boolean {
  if (legacyDir === dataDir) return false;
  if (!existsSync(join(legacyDir, 'nostalgia.db'))) return false; // no prior install to move
  if (existsSync(join(dataDir, 'nostalgia.db'))) return false; // new dir already has data
  try {
    for (const entry of readdirSync(legacyDir)) {
      const from = join(legacyDir, entry);
      const to = join(dataDir, entry);
      if (existsSync(to)) continue; // never overwrite something already in the new dir
      try {
        renameSync(from, to); // same-volume: instant metadata move (no byte copy)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
          cpSync(from, to, { recursive: true }); // cross-volume: copy then remove
          rmSync(from, { recursive: true, force: true });
        } else {
          throw e;
        }
      }
    }
    return true;
  } catch (e) {
    console.error('[boot] legacy data migration failed (starting with whatever moved):', e);
    return false;
  }
}

/**
 * After a legacy migration, the DB still holds ABSOLUTE path settings that point into the
 * old data dir (storage.root, cache.dir, emulators.dir, and the saves.dirs map). Re-point
 * any value under the old dir to the corresponding path under the new one. Values the user
 * repointed elsewhere (a different drive) don't start with the old prefix and are left as-is.
 */
function rewriteLegacyPathSettings(legacyDir: string, dataDir: string): void {
  const prefix = legacyDir.endsWith(sep) ? legacyDir : legacyDir + sep;
  const remap = (v: string): string => (v.startsWith(prefix) ? join(dataDir, v.slice(prefix.length)) : v);
  for (const key of ['storage.root', 'cache.dir', 'emulators.dir']) {
    const row = getSetting(key);
    if (row && !row.encrypted && typeof row.value === 'string') {
      const next = remap(row.value);
      if (next !== row.value) setSetting(key, next, false);
    }
  }
  const saves = getSetting('saves.dirs');
  if (saves && !saves.encrypted && saves.value && typeof saves.value === 'object') {
    const obj = saves.value as Record<string, string>;
    let changed = false;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      next[k] = typeof v === 'string' ? remap(v) : v;
      if (next[k] !== v) changed = true;
    }
    if (changed) setSetting('saves.dirs', next, false);
  }
}

function boot(...args: unknown[]): void {
  if (!app.isPackaged) console.log('[boot]', ...args);
}

// Single-instance: a second launch focuses the existing window (skipped in smoke).
if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Must run before the app is ready.
registerAssetSchemePrivileged();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  shutdownOnce();
});

app
  .whenReady()
  .then(async () => {
    loadDotEnv();
    const userData = app.getPath('userData');
    const assetsDir = join(userData, 'assets');
    const cacheDir = join(userData, 'cache');
    await mkdir(assetsDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });

    const db = getDb();
    migrate(db);
    seedBuiltinSystems();
    if (!smoke) seedDefaultSettings(); // smoke configures its own throwaway dirs
    // Re-point absolute path settings carried over from a legacy-dir migration (above).
    if (legacyDataDir) rewriteLegacyPathSettings(legacyDataDir, app.getPath('userData'));
    boot(
      'db opened (journal_mode =',
      db.pragma('journal_mode', { simple: true }),
      ') schema v' + String(currentSchemaVersion(db)),
    );

    installCsp();
    boot('CSP installed');

    registerAssetProtocol({ assets: assetsDir, cache: cacheDir });
    boot('asset:// protocol registered');

    let healthCalled = false;
    registerIpc({
      onHealth: () => {
        healthCalled = true;
        boot('app:health round-trip OK');
        if (smoke) setTimeout(() => app.exit(0), 300);
      },
    });
    boot('IPC registered');

    // Give known emulators their current launch args (boots the game in FULLSCREEN where
    // the emulator has a CLI flag) - upgrades an empty or previously-shipped template without
    // touching a user's custom args. Then bind each console to the emulator that runs it.
    if (!smoke) {
      // Repair exe paths left stale by a data-dir move BEFORE binding, so bindings
      // resolve to a runnable emulator instead of a dead path.
      const healed = healEmulatorPaths();
      if (healed > 0) boot('repaired', healed, 'emulator path(s) after data dir move');
      upgradeKnownEmulatorArgs();
      autoBindEmulators();
    }

    // Resume any download a previous run left mid-flight (process exit stops the
    // transfer; the .part bytes survive and we pick up from there).
    if (!smoke) {
      // Repair first: a game whose bytes are on disk must read as installed before any
      // queued download is reconciled (otherwise it gets re-fetched).
      reconcileCacheStates();
      // Then reconcile each console's games folder with the library, so a game the user
      // dropped in (or renamed) between runs is picked up without them asking. Cheap:
      // readdir + stat, hashing only to break a same-size tie. Best-effort per system so
      // one unreadable folder can't stop startup, and it runs BEFORE download reconcile so
      // a file that's really present is never queued for re-download.
      void (async () => {
        for (const system of listSystems()) {
          const r = await scanSystemFolder(system.id).catch(() => null);
          if (r && (r.added || r.relinked || r.missing)) {
            boot(`folder scan ${system.slug}: +${r.added} added, ${r.relinked} re-linked, ${r.missing} missing`);
          }
        }
        await reconcileInterruptedDownloads();
        // Native Ports: settle installs a previous run left mid-flight, bind ports to the
        // library's copies of their games (after the folder scans above found them), then
        // refresh release info (at most every 6 h per port, unless recomps.autoCheck is off).
        await reconcileInstalls(listInstalls());
        await autoLink().catch((e) => boot('port auto-link failed', e));
        await checkPortsAtStartup().catch(() => undefined);
      })();
    }

    if (smoke) {
      // Verify the asset:// protocol end-to-end from main.
      await writeFile(join(assetsDir, 'health.txt'), 'ok');
      try {
        const res = await net.fetch('asset://assets/health.txt');
        const txt = await res.text();
        console.log('[smoke] asset fetch', res.status, JSON.stringify(txt));
        if (res.status !== 200 || txt !== 'ok') {
          console.error('[smoke] FAIL: asset protocol did not return the file');
          app.exit(1);
          return;
        }
      } catch (err) {
        console.error('[smoke] FAIL: asset fetch threw', err);
        app.exit(1);
        return;
      }
    }

    if (smoke) {
      const sysCount = (db.prepare('SELECT COUNT(*) AS c FROM systems').get() as { c: number }).c;
      console.log('[smoke] db tables OK, systems rows =', sysCount);
      try {
        const {
          runStorageSmoke,
          runCatalogSmoke,
          runMetadataSmoke,
          runSavesSmoke,
          runArchiveSmoke,
          runPhase1Smoke,
          runTorrentSmoke,
          runFolderScanSmoke,
          runRecompsSmoke,
          runRecompsNetSmoke,
        } = await import('./dev/smokeChecks');
        await runStorageSmoke();
        await runCatalogSmoke();
        await runMetadataSmoke();
        await runSavesSmoke();
        await runArchiveSmoke();
        await runPhase1Smoke();
        await runFolderScanSmoke();
        await runRecompsSmoke();
        // Network-dependent BitTorrent check - opt-in so the default smoke stays offline/fast.
        if (process.env.NOSTALGIA_SMOKE_TORRENT === '1') await runTorrentSmoke();
        if (process.env.NOSTALGIA_SMOKE_RECOMPS_NET === '1') await runRecompsNetSmoke();
      } catch (err) {
        console.error('[smoke] FAIL: subsystem check', err);
        app.exit(1);
        return;
      }
    }

    const win = createWindow();
    // Self-update: first check ~10 s after startup, then every 4 h. Disabled in dev and
    // under smoke (no network); check-only for portable builds.
    startUpdater();
    win.webContents.on('did-finish-load', () => boot('renderer loaded'));
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[boot] renderer process gone', details);
      if (smoke) app.exit(1);
    });

    if (smoke) {
      setTimeout(() => {
        if (!healthCalled) {
          console.error('[smoke] FAIL: renderer never called app:health within 25s');
          app.exit(1);
        }
      }, 25000);
    }
  })
  .catch((err) => {
    console.error('[boot] fatal during startup', err);
    app.exit(1);
  });
