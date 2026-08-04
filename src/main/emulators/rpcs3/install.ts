// Inspects an RPCS3 installation for the per-game state that decides whether a title
// needs setup before it will run well: a custom configuration, and available/enabled
// patches. All keyed by the title's SERIAL (see storage/ps3serial.ts).
//
// This module is READ-ONLY by design. RPCS3's YAML is hand-tuned by the user through its
// own GUI; generating or rewriting it here risks clobbering settings we do not understand.
// We detect and report, never write.
//
// Layout (verified against a real v0.0.38 win64 build):
//   <exeDir>/config/custom_configs/config_<SERIAL>.yml   per-game config
//   <exeDir>/config/patch_config.yml                     which patches are enabled
//   <exeDir>/patches/patch.yml                           the patch database
//   <exeDir>/config/games.yml                            RPCS3's own serial -> path registry
// MAIN PROCESS ONLY.
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isPs3Serial } from '../../storage/ps3serial';

export interface Rpcs3Paths {
  /** Directory holding rpcs3.exe. */
  root: string;
  configDir: string;
  customConfigsDir: string;
  patchConfigPath: string;
  patchDbPath: string;
  gamesRegistryPath: string;
}

/**
 * Resolves an RPCS3 install's directories from its exe path. Windows builds are portable
 * (config/ sits next to the exe); an installed build keeps it under %APPDATA%/rpcs3. The
 * portable layout wins when present, matching RPCS3's own precedence.
 */
export async function resolveRpcs3Paths(exePath: string): Promise<Rpcs3Paths> {
  const root = dirname(exePath);
  const portable = join(root, 'config');
  const appdata = process.env.APPDATA ? join(process.env.APPDATA, 'rpcs3', 'config') : null;
  const configDir = (await isDir(portable)) || !appdata ? portable : appdata;
  return {
    root,
    configDir,
    customConfigsDir: join(configDir, 'custom_configs'),
    patchConfigPath: join(configDir, 'patch_config.yml'),
    patchDbPath: join(root, 'patches', 'patch.yml'),
    gamesRegistryPath: join(configDir, 'games.yml'),
  };
}

async function isDir(p: string): Promise<boolean> {
  return stat(p)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

async function exists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}

/** True when a per-game config exists for this serial (RPCS3 applies it automatically). */
export async function hasCustomConfig(paths: Rpcs3Paths, serial: string): Promise<boolean> {
  if (!isPs3Serial(serial)) return false;
  return exists(join(paths.customConfigsDir, `config_${serial}.yml`));
}

// The patch DB is ~900 KB and rarely changes; cache the serial set, invalidated by mtime.
let patchDbCache: { path: string; mtimeMs: number; serials: Set<string> } | null = null;

/**
 * The set of serials that have at least one patch in the install's patch database.
 *
 * patch.yml leans heavily on YAML anchors/aliases, so a structural parse would need a full
 * YAML implementation. Serials appear verbatim as mapping keys (`BCUS98111: [ 01.03 ]`),
 * so a token scan answers "are there patches for this serial" exactly, with no dependency.
 */
export async function loadPatchedSerials(paths: Rpcs3Paths): Promise<Set<string>> {
  try {
    const st = await stat(paths.patchDbPath);
    if (patchDbCache && patchDbCache.path === paths.patchDbPath && patchDbCache.mtimeMs === st.mtimeMs) {
      return patchDbCache.serials;
    }
    const text = await readFile(paths.patchDbPath, 'utf8');
    const serials = new Set(text.match(/\b[A-Z]{4}[0-9]{5}\b/g) ?? []);
    patchDbCache = { path: paths.patchDbPath, mtimeMs: st.mtimeMs, serials };
    return serials;
  } catch {
    return new Set();
  }
}

/**
 * True when at least one patch is ENABLED for this serial.
 *
 * patch_config.yml nests hash > patch name > game title > SERIAL > version > Enabled, so
 * "enabled for this serial" means an `Enabled: true` inside the serial's own indented
 * block. Scanned by indentation rather than parsed, for the same anchor reasons as above.
 */
export async function hasEnabledPatches(paths: Rpcs3Paths, serial: string): Promise<boolean> {
  if (!isPs3Serial(serial)) return false;
  let text: string;
  try {
    text = await readFile(paths.patchConfigPath, 'utf8');
  } catch {
    return false;
  }

  const lines = text.split(/\r?\n/);
  const indentOf = (l: string) => l.length - l.trimStart().length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== `${serial}:`) continue;
    const base = indentOf(lines[i]);
    // Walk the serial's block: everything indented deeper than the serial key itself.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '') continue;
      if (indentOf(line) <= base) break;
      if (/^\s*Enabled:\s*true\s*$/i.test(line)) return true;
    }
  }
  return false;
}

/**
 * RPCS3's own serial -> game path registry. Used as a fallback source of a title's serial
 * when we cannot read it from the dump, and to detect that a DIFFERENT install already
 * knows this game. Lines are `SERIAL: <path>`; paths are taken verbatim (opaque).
 */
export async function readGamesRegistry(paths: Rpcs3Paths): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const text = await readFile(paths.gamesRegistryPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z]{4}[0-9]{5}):\s*(.+?)\s*$/.exec(line);
      if (m) out.set(m[1], m[2]);
    }
  } catch {
    // no registry yet - RPCS3 has not scanned any games
  }
  return out;
}
