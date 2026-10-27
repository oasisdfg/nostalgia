import { z } from 'zod';
import { shell } from 'electron';
import { registerInvoke } from '../registry';
import { getManifest } from '../../recomps/registry';
import { listDtos, dtoFor, dtosForGame } from '../../recomps/service';
import { checkPorts } from '../../recomps/github';
import { startInstall, cancelInstall, rollback, uninstall } from '../../recomps/installer';
import { autoLink, linkManually, unlink, fileForPort } from '../../recomps/linker';
import { launchRecomp } from '../../recomps/launch';
import { ensureCached } from '../../launch/launcher';
import { getInstall } from '../../db/repositories/recompsRepo';
import { recompsDir } from '../../recomps/paths';
import { mkdir } from 'node:fs/promises';

// Every request names a port by its registry id (checked against the bundled registry)
// or a game by games.id. No channel accepts a path or URL from the renderer.
const portId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .refine((id) => getManifest(id) != null, 'unknown port');
const idSchema = z.object({ id: portId });
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
    const row = getInstall(id);
    if (row?.linked_game_id == null) throw new Error('Link a game to this port first.');
    const fileId = fileForPort(id, row.linked_game_id);
    if (fileId == null) throw new Error('The linked game has no file yet.');
    // The port's picker needs the file on disk - fetch it into the cache if it isn't.
    shell.showItemInFolder(await ensureCached(fileId));
    return { ok: true as const };
  });
  registerInvoke('recomps:revealInstall', async (req) => {
    const { id } = idSchema.parse(req);
    const dir = getInstall(id)?.install_dir;
    if (!dir) throw new Error("This port isn't installed.");
    await shell.openPath(dir);
    return { ok: true as const };
  });
  registerInvoke('recomps:revealDir', async () => {
    const dir = recompsDir();
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true as const };
  });
}
