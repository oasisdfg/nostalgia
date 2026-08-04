import { z } from 'zod';
import { dialog, BrowserWindow } from 'electron';
import { registerInvoke } from '../registry';
import { getSetting, getSettings, setSetting } from '../../db/repositories/settingsRepo';

const getSchema = z.object({ key: z.string() });
const getManySchema = z.object({ keys: z.array(z.string()) });
const setSchema = z.object({ key: z.string(), value: z.unknown(), encrypted: z.boolean().optional() });

export function registerSettingsHandlers(): void {
  registerInvoke('settings:get', (req) => getSetting(getSchema.parse(req).key));
  registerInvoke('settings:getMany', (req) => getSettings(getManySchema.parse(req).keys));
  registerInvoke('settings:set', (req) => {
    const p = setSchema.parse(req);
    setSetting(p.key, p.value, p.encrypted ?? false);
    return { ok: true as const };
  });

  // Folder picker for storage/cache paths. Returns the resolved absolute path
  // verbatim (opaque) or null on cancel - the renderer never types a path.
  registerInvoke('storage:browseForFolder', async () => {
    const parent = BrowserWindow.getFocusedWindow();
    const options = { title: 'Select folder', properties: ['openDirectory' as const, 'createDirectory' as const] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return { folderPath: result.filePaths[0] };
  });
}
