import { z } from 'zod';
import { shell } from 'electron';
import { rm } from 'node:fs/promises';
import { registerInvoke } from '../registry';
import { listSavesForGame, getSaveInternal, deleteSaveRow } from '../../db/repositories/savesRepo';
import { mapSave } from '../../db/repositories/types';
import { syncGame, syncAll } from '../../saves/syncEngine';
import { resolveConflict } from '../../saves/conflictResolver';

const gameSchema = z.object({ gameId: z.number().int() });
const saveSchema = z.object({ saveId: z.number().int() });
const conflictSchema = z.object({ saveId: z.number().int(), keep: z.enum(['local', 'remote']) });

export function registerSavesHandlers(): void {
  registerInvoke('saves:list', (req) => listSavesForGame(gameSchema.parse(req).gameId));
  registerInvoke('saves:syncGame', async (req) => {
    await syncGame(gameSchema.parse(req).gameId);
    return { ok: true as const };
  });
  registerInvoke('saves:syncAll', async () => {
    await syncAll();
    return { ok: true as const };
  });
  registerInvoke('saves:resolveConflict', async (req) => {
    const p = conflictSchema.parse(req);
    await resolveConflict(p.saveId, p.keep);
    const row = getSaveInternal(p.saveId);
    if (!row) throw new Error('Save not found.');
    return mapSave(row);
  });

  // Reveal in the OS file manager. The opaque path is resolved in main and never
  // crosses to the renderer (the renderer passes only the saveId).
  registerInvoke('saves:reveal', (req) => {
    const row = getSaveInternal(saveSchema.parse(req).saveId);
    if (!row) throw new Error('Save not found.');
    shell.showItemInFolder(row.local_path);
    return { ok: true as const };
  });

  // Delete the save file on disk + its row. The renderer confirms before calling.
  registerInvoke('saves:delete', async (req) => {
    const row = getSaveInternal(saveSchema.parse(req).saveId);
    if (!row) throw new Error('Save not found.');
    await rm(row.local_path, { force: true });
    deleteSaveRow(row.id);
    return { ok: true as const };
  });
}
