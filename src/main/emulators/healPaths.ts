// Repairs emulator paths after the app DATA DIR moves (the %APPDATA%\Roaming ->
// Documents\Nostalgia relocation). Moving the data dir relocates the managed emulator
// builds on disk, but `emulators.exe_path` rows still hold the OLD absolute path, so every
// launch/"open emulator" spawn fails with "Couldn't start the emulator". MAIN PROCESS ONLY.
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listEmulators, updateEmulator } from '../db/repositories/emulatorsRepo';

/** Path tail after the last managed "emulators" segment, e.g. "PCSX2\pcsx2-qt.exe". */
function tailUnderEmulators(p: string): string | null {
  const m = /[\\/]emulators[\\/](.+)$/i.exec(p);
  return m ? m[1] : null;
}

/**
 * Re-points any emulator whose exe no longer exists at the SAME build under the current
 * managed emulator folder, matching on the path tail after the "emulators" segment (so it
 * works regardless of where the data dir used to live). Rows whose exe still resolves, or
 * whose build isn't present in the new folder, are left untouched - this only ever repairs
 * a broken path, never rewrites a working one.
 *
 * The replacement path is resolved by MAIN from inside the app-managed emulator dir, which
 * is one of the sanctioned exe-path sources (same as the folder scan); it is then stored
 * verbatim. Returns the number of rows repaired.
 */
export function healEmulatorPaths(): number {
  const root = join(app.getPath('userData'), 'emulators');
  let fixed = 0;
  for (const e of listEmulators()) {
    if (!e.exePath || existsSync(e.exePath)) continue; // still valid - leave alone
    const tail = tailUnderEmulators(e.exePath);
    if (!tail) continue;
    const exePath = join(root, tail);
    if (!existsSync(exePath)) continue; // that build isn't in the new folder either

    // Carry the working dir across the same way when it is also stale.
    let workingDir = e.workingDir ?? null;
    if (workingDir && !existsSync(workingDir)) {
      const wdTail = tailUnderEmulators(workingDir);
      workingDir = wdTail ? join(root, wdTail) : workingDir;
    }

    updateEmulator(e.id, { exePath, workingDir });
    fixed++;
  }
  return fixed;
}
