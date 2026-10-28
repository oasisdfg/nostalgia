import { z } from 'zod';
import { shell, dialog, BrowserWindow, type OpenDialogOptions } from 'electron';
import { registerInvoke } from '../registry';
import { getManifest } from '../../recomps/registry';
import { listDtos, dtoFor, dtosForGame } from '../../recomps/service';
import { checkPort, checkPorts } from '../../recomps/github';
import { refreshRegistry } from '../../recomps/remoteRegistry';
import { startInstall, cancelInstall, rollback, uninstall, setLocatedExe } from '../../recomps/installer';
import { autoLink, linkManually, unlink, resolveGamePath, setPicked, clearPicked } from '../../recomps/linker';
import { launchRecomp } from '../../recomps/launch';
import { getArt } from '../../recomps/art';
import { getInstall } from '../../db/repositories/recompsRepo';
import { recompsDir } from '../../recomps/paths';
import { buildLogPath } from '../../recomps/builder';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

/** OS dialog in main; returns the chosen path verbatim (opaque) or null on cancel. */
async function openDialog(options: OpenDialogOptions): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow();
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

// Every request names a port by its registry id (checked against the bundled registry)
// or a game by games.id. No channel accepts a path or URL from the renderer.
const portId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .refine((id) => getManifest(id) != null, 'unknown port');
const idSchema = z.object({ id: portId });
// Art is asked for in bulk (a whole grid); unknown ids are simply skipped by getArt.
const artSchema = z.object({ ids: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(500) });
const checkSchema = z.object({ id: portId.optional() }).optional();
const gameSchema = z.object({ gameId: z.coerce.number().int() });
const linkSchema = z.object({ id: portId, gameId: z.coerce.number().int() });

export function registerRecompsHandlers(): void {
  registerInvoke('recomps:list', async () => {
    await autoLink();
    return listDtos();
  });
  registerInvoke('recomps:forGame', async (req) => {
    const { gameId } = gameSchema.parse(req);
    await autoLink();
    return dtosForGame(gameId);
  });
  registerInvoke('recomps:checkUpdates', async (req) => {
    const p = checkSchema.parse(req ?? undefined);
    // A full check also refreshes the remote port registry (new ports, fixed entries).
    if (!p?.id) await refreshRegistry(true);
    await checkPorts(p?.id);
    return listDtos();
  });
  registerInvoke('recomps:install', (req) => {
    const { id } = idSchema.parse(req);
    startInstall(id);
    return dtoFor(id);
  });
  registerInvoke('recomps:cancel', (req) => {
    const { id } = idSchema.parse(req);
    cancelInstall(id);
    return dtoFor(id);
  });
  registerInvoke('recomps:rollback', async (req) => {
    const { id } = idSchema.parse(req);
    await rollback(id);
    return dtoFor(id);
  });
  registerInvoke('recomps:uninstall', async (req) => {
    const { id } = idSchema.parse(req);
    await uninstall(id);
    return dtoFor(id);
  });
  registerInvoke('recomps:link', async (req) => {
    const p = linkSchema.parse(req);
    await linkManually(p.id, p.gameId);
    return dtoFor(p.id);
  });
  registerInvoke('recomps:unlink', (req) => {
    const { id } = idSchema.parse(req);
    unlink(id);
    return dtoFor(id);
  });
  registerInvoke('recomps:launch', (req) => launchRecomp(idSchema.parse(req).id));
  registerInvoke('recomps:revealGameFile', async (req) => {
    const { id } = idSchema.parse(req);
    // The port's picker needs the file on disk - a library file is fetched into the cache.
    shell.showItemInFolder(await resolveGamePath(id));
    return { ok: true as const };
  });
  registerInvoke('recomps:revealInstall', async (req) => {
    const { id } = idSchema.parse(req);
    const dir = getInstall(id)?.install_dir;
    if (!dir) throw new Error("This port isn't installed.");
    await shell.openPath(dir);
    return { ok: true as const };
  });
  registerInvoke('recomps:revealBuildLog', (req) => {
    const log = buildLogPath(idSchema.parse(req).id);
    if (!existsSync(log)) return { ok: false };
    shell.showItemInFolder(log);
    return { ok: true };
  });
  // The user's own copy of a game Nostalgia doesn't manage (PS4 dump, XBLA package, Switch or
  // PSP folder) - or a library port's fallback when there's no matching library game. The
  // path comes only from this dialog; the renderer names the port, never a path.
  registerInvoke('recomps:pickGameFiles', async (req) => {
    const { id } = idSchema.parse(req);
    const m = getManifest(id)!;
    const folder = m.gameFile.pickKind === 'folder';
    const path = await openDialog({
      title: `Choose your copy of ${m.originalTitle}`,
      properties: [folder ? 'openDirectory' : 'openFile'],
    });
    if (path) await setPicked(id, path);
    return dtoFor(id);
  });
  registerInvoke('recomps:clearPicked', (req) => {
    const { id } = idSchema.parse(req);
    clearPicked(id);
    return dtoFor(id);
  });
  // 'external' ports: the user installed the port with its own installer; they point us at
  // the exe once (main-resolved exe rule: an OS dialog in main, never a renderer path).
  registerInvoke('recomps:locateExe', async (req) => {
    const { id } = idSchema.parse(req);
    const m = getManifest(id)!;
    if (m.assetKind !== 'external') throw new Error('This port is installed by Nostalgia.');
    const path = await openDialog({
      title: `Locate ${m.name}`,
      properties: ['openFile'],
      filters: [{ name: 'Program', extensions: ['exe'] }],
    });
    if (path) {
      await checkPort(m); // know the current version, so a later release reads as an update
      setLocatedExe(id, path);
    }
    return dtoFor(id);
  });
  registerInvoke('recomps:art', (req) => getArt(artSchema.parse(req).ids));
  registerInvoke('recomps:revealDir', async () => {
    const dir = recompsDir();
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true as const };
  });
}
