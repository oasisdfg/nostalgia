import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getSetting, setSetting } from '../repositories/settingsRepo';

/**
 * Seeds sane first-run settings if absent. All paths are under the app data dir
 * (app.getPath('userData'), relocated to Documents\Nostalgia in src/main/index.ts) -
 * NEVER a dev/build path - so a packaged install is usable out of the box. Idempotent:
 * only fills keys the user hasn't set.
 */
export function seedDefaultSettings(): void {
  const userData = app.getPath('userData');
  const gamesDir = join(userData, 'games'); // local ROM library (user can repoint in Settings)
  const cacheDir = join(userData, 'cache'); // downloaded/on-demand game bytes
  const emulatorsDir = join(userData, 'emulators'); // app-managed emulator folder
  const recompsDir = join(userData, 'recomps'); // app-managed Native Ports folder
  mkdirSync(gamesDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(emulatorsDir, { recursive: true });
  mkdirSync(recompsDir, { recursive: true });

  const ensure = (key: string, value: unknown): void => {
    if (!getSetting(key)) setSetting(key, value, false);
  };
  ensure('storage.root', gamesDir);
  ensure('cache.dir', cacheDir);
  ensure('cache.sizeLimitBytes', 25 * 1024 ** 3); // 25 GB LRU cache by default
  ensure('emulators.dir', emulatorsDir);
  ensure('ui.defaultMode', 'desktop');
  ensure('recomps.dir', recompsDir);
  ensure('recomps.autoCheck', true);
}
