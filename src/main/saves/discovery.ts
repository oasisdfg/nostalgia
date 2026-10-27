import { readdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { getSetting } from '../db/repositories/settingsRepo';
import { getGame } from '../db/repositories/gamesRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getPrimaryFileForGame } from '../db/repositories/gameFilesRepo';
import { upsertSave } from '../db/repositories/savesRepo';
import { hashFile } from '../storage/hashing';
import { listInstallsForGame } from '../db/repositories/recompsRepo';
import { getManifest } from '../recomps/registry';
import { expandSaveDir } from '../recomps/paths';
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
 * name matches the game's rom file (or title), plus the save folders of any installed
 * Native Port linked to the game, and upserts saves rows (uq_saves_identity). Returns
 * the number of saves discovered.
 */
export async function discoverSavesForGame(gameId: number): Promise<number> {
  const game = getGame(gameId);
  if (!game) return 0;
  const system = getSystem(game.systemId);
  if (!system) return 0;
  const fromSystem = await discoverInSystemDir(gameId, game.systemId, game.title, system.slug);
  const fromPorts = await discoverInPortDirs(gameId, game.systemId);
  return fromSystem + fromPorts;
}

async function upsertFrom(gameId: number, systemId: number, full: string, name: string): Promise<void> {
  const st = await stat(full);
  const h = await hashFile(full);
  upsertSave({
    gameId,
    systemId,
    type: classify(extname(name)),
    slot: null,
    localPath: full,
    sizeBytes: st.size,
    crc32: h.crc32,
    md5: h.md5,
    sha1: h.sha1,
  });
}

/**
 * A port's save folder belongs to that one game, so every file in it is a save - no
 * filename matching. Top level only, like the system folders.
 */
async function discoverInPortDirs(gameId: number, systemId: number): Promise<number> {
  let count = 0;
  for (const row of listInstallsForGame(gameId)) {
    const manifest = getManifest(row.recomp_id);
    if (!manifest || row.state !== 'installed') continue;
    for (const tpl of manifest.saveDirs) {
      const dir = expandSaveDir(tpl, row.install_dir);
      if (!dir) continue;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        await upsertFrom(gameId, systemId, join(dir, entry.name), entry.name).catch(() => undefined);
        count++;
      }
    }
  }
  return count;
}

async function discoverInSystemDir(gameId: number, systemId: number, title: string, slug: string): Promise<number> {
  const dir = savesDirForSystem(slug);
  if (!dir) return 0;

  const file = getPrimaryFileForGame(gameId);
  const fileStem = file ? stem(basename(file.storage_key)) : '';
  const titleStem = title.toLowerCase();

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
    await upsertFrom(gameId, systemId, join(dir, entry.name), entry.name);
    count++;
  }
  return count;
}
