import { readdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { getSetting } from '../db/repositories/settingsRepo';
import { getGame } from '../db/repositories/gamesRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getPrimaryFileForGame } from '../db/repositories/gameFilesRepo';
import { upsertSave } from '../db/repositories/savesRepo';
import { hashFile } from '../storage/hashing';
import type { SaveType } from '@shared/contracts/ipc';

const TYPE_BY_EXT: Record<string, SaveType> = {
  '.state': 'savestate',
  '.savestate': 'savestate',
  '.st': 'savestate',
  '.srm': 'sram',
  '.sav': 'sram',
  '.sram': 'sram',
  '.mcr': 'memorycard',
  '.mcd': 'memorycard',
  '.mc': 'memorycard',
  '.ps2': 'memorycard',
};

function classify(ext: string): SaveType {
  return TYPE_BY_EXT[ext.toLowerCase()] ?? 'other';
}

function stem(name: string): string {
  const ext = extname(name);
  return (ext ? name.slice(0, -ext.length) : name).toLowerCase();
}

/** Per-system save folders are configured in settings under `saves.dirs` (slug -> dir). */
function savesDirForSystem(slug: string): string | null {
  const row = getSetting('saves.dirs');
  const map =
    row && !row.encrypted && row.value && typeof row.value === 'object'
      ? (row.value as Record<string, string>)
      : {};
  const dir = map[slug];
  return typeof dir === 'string' && dir.length > 0 ? dir : null;
}

/**
 * Idempotent post-play discovery: scans the system's save folder for files whose
 * name matches the game's rom file (or title) and upserts saves rows. Returns the
 * number of saves discovered. No-op when no folder is configured.
 */
export async function discoverSavesForGame(gameId: number): Promise<number> {
  const game = getGame(gameId);
  if (!game) return 0;
  const system = getSystem(game.systemId);
  if (!system) return 0;
  const dir = savesDirForSystem(system.slug);
  if (!dir) return 0;

  const file = getPrimaryFileForGame(gameId);
  const fileStem = file ? stem(basename(file.storage_key)) : '';
  const titleStem = game.title.toLowerCase();

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const s = stem(entry.name);
    const matches =
      (fileStem && (s === fileStem || s.startsWith(fileStem) || fileStem.startsWith(s))) ||
      (titleStem && (s.includes(titleStem) || titleStem.includes(s)));
    if (!matches) continue;
    const full = join(dir, entry.name);
    const st = await stat(full);
    const h = await hashFile(full);
    upsertSave({
      gameId,
      systemId: game.systemId,
      type: classify(extname(entry.name)),
      slot: null,
      localPath: full,
      sizeBytes: st.size,
      crc32: h.crc32,
      md5: h.md5,
      sha1: h.sha1,
    });
    count++;
  }
  return count;
}
