import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Absolute path to the bundled aria2c.exe, or null if it isn't present. Packaged it
 * lives at `<resources>/aria2/aria2c.exe` (electron-builder `extraResources`, OUTSIDE
 * the asar so it's spawnable); in dev it's the repo's `resources/aria2/aria2c.exe`
 * (fetched by `scripts/fetch-aria2.mjs`). MAIN PROCESS ONLY.
 */
export function aria2BinaryPath(): string | null {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'aria2', 'aria2c.exe')
    : join(app.getAppPath(), 'resources', 'aria2', 'aria2c.exe');
  return existsSync(path) ? path : null;
}
