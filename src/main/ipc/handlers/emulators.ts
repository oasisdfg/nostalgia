import { z } from 'zod';
import { dialog, BrowserWindow, shell } from 'electron';
import { registerInvoke } from '../registry';
import * as emulatorsRepo from '../../db/repositories/emulatorsRepo';
import {
  getEmulatorDir,
  ensureEmulatorDir,
  scanEmulatorDir,
  knownArgsForExe,
  autoBindEmulators,
} from '../../emulators/detect';

const idSchema = z.object({ id: z.number().int() });
const createSchema = z.object({
  name: z.string().min(1),
  exePath: z.string().min(1),
  workingDir: z.string().nullish(),
  defaultArgsTemplate: z.array(z.string()).optional(),
  notes: z.string().nullish(),
});
const updateSchema = z.object({
  id: z.number().int(),
  patch: z.object({
    name: z.string().optional(),
    exePath: z.string().optional(),
    workingDir: z.string().nullish(),
    defaultArgsTemplate: z.array(z.string()).optional(),
    notes: z.string().nullish(),
  }),
});

export function registerEmulatorsHandlers(): void {
  registerInvoke('emulators:list', () => emulatorsRepo.listEmulators());
  registerInvoke('emulators:get', (req) => emulatorsRepo.getEmulator(idSchema.parse(req).id));
  registerInvoke('emulators:create', (req) => {
    const p = createSchema.parse(req);
    // Auto-fill launch args for a recognized emulator (by exe filename) when the caller
    // didn't provide any, so Play boots the game instead of just opening the emulator.
    const defaultArgsTemplate =
      p.defaultArgsTemplate && p.defaultArgsTemplate.length > 0 ? p.defaultArgsTemplate : knownArgsForExe(p.exePath);
    return emulatorsRepo.createEmulator({ ...p, defaultArgsTemplate });
  });
  registerInvoke('emulators:update', (req) => {
    const p = updateSchema.parse(req);
    return emulatorsRepo.updateEmulator(p.id, p.patch);
  });
  registerInvoke('emulators:delete', (req) => ({ deleted: emulatorsRepo.deleteEmulator(idSchema.parse(req).id) }));

  // The app-managed emulator folder: where the user drops emulator builds.
  registerInvoke('emulators:getDir', () => ({ dir: getEmulatorDir() }));
  registerInvoke('emulators:revealDir', async () => {
    await shell.openPath(await ensureEmulatorDir());
    return { ok: true as const };
  });
  // Scan the managed folder and register any known emulators found in it. The
  // renderer supplies no path - main resolves every exe_path inside the managed dir.
  registerInvoke('emulators:scanDir', async () => {
    const result = await scanEmulatorDir();
    autoBindEmulators(); // bind each console to the right emulator that was just found
    return result;
  });

  // Set an exe path from the OS file dialog (defaults into the managed folder).
  // Returns the resolved absolute path verbatim (opaque) or null on cancel.
  registerInvoke('emulators:browseForExe', async () => {
    const parent = BrowserWindow.getFocusedWindow();
    const options = {
      title: 'Select emulator executable',
      defaultPath: getEmulatorDir(),
      properties: ['openFile' as const],
      filters: [{ name: 'Executable', extensions: ['exe'] }],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return { exePath: result.filePaths[0] };
  });
}
