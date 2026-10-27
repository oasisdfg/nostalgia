import { access, readFile, writeFile } from 'node:fs/promises';
import {
  PORT_SETTING_KEYS,
  type ConfigScalar,
  type RecompManifest,
  type RecompUserConfig,
} from '@shared/contracts/recomps';
import { getSetting } from '../db/repositories/settingsRepo';
import { applyPatch } from '../emulators/configure';
import { expandSaveDir } from './paths';

/**
 * Per-port unified settings (fullscreen / resolution / frame cap) written into each port's
 * OWN config file before launch - the same rails as emulators/configure.ts: only a file that
 * already exists (the port writes its own on first run; we never create one blind), the
 * pristine file backed up ONCE to `<file>.nostalgia.bak`, and a no-op when already set.
 */

/** The user's picks for every port, from the `recomps.config` setting. */
export function userConfigFor(recompId: string): RecompUserConfig {
  const row = getSetting('recomps.config');
  const all = row && !row.encrypted && row.value && typeof row.value === 'object' ? (row.value as Record<string, unknown>) : {};
  const mine = all[recompId];
  return mine && typeof mine === 'object' ? (mine as RecompUserConfig) : {};
}

/** The key/value writes the user's picks resolve to - unknown choices are ignored. */
export function resolveWrites(manifest: RecompManifest, picks: RecompUserConfig): Record<string, ConfigScalar> {
  const out: Record<string, ConfigScalar> = {};
  const options = manifest.config?.options ?? {};
  for (const key of PORT_SETTING_KEYS) {
    const choice = picks[key];
    const writes = choice != null ? options[key]?.[choice] : undefined;
    if (writes) Object.assign(out, writes);
  }
  return out;
}

/** Sets dotted-path keys into a JSON document, creating intermediate objects. */
export function applyJsonWrites(content: string, writes: Record<string, ConfigScalar>): string {
  const doc = JSON.parse(content) as Record<string, unknown>;
  let changed = false;
  for (const [path, value] of Object.entries(writes)) {
    const parts = path.split('.');
    let node = doc;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (node[leaf] !== value) {
      node[leaf] = value;
      changed = true;
    }
  }
  return changed ? JSON.stringify(doc, null, 4) : content;
}

/** INI/TOML: `section.key` writes go under [section]; a bare key is top-level. */
function applyIniWrites(content: string, writes: Record<string, ConfigScalar>): string {
  const bySection = new Map<string | null, Record<string, string>>();
  for (const [path, value] of Object.entries(writes)) {
    const dot = path.lastIndexOf('.');
    const section = dot >= 0 ? path.slice(0, dot) : null;
    const key = dot >= 0 ? path.slice(dot + 1) : path;
    const set = bySection.get(section) ?? {};
    set[key] = String(value);
    bySection.set(section, set);
  }
  let out = content;
  for (const [section, set] of bySection) out = applyPatch(out, { section: section ?? undefined, set });
  return out;
}

/** Applies the user's picks to the port's config file. Best-effort: never blocks a launch. */
export async function applyPortConfig(manifest: RecompManifest, installDir: string): Promise<void> {
  const map = manifest.config;
  if (!map) return;
  const writes = resolveWrites(manifest, userConfigFor(manifest.id));
  if (Object.keys(writes).length === 0) return;
  const file = expandSaveDir(map.file, installDir);
  if (!file) return;
  try {
    await access(file);
  } catch {
    return; // the port hasn't written its config yet - don't create it blind
  }
  const original = await readFile(file, 'utf8');
  let updated: string;
  try {
    updated = map.format === 'json' ? applyJsonWrites(original, writes) : applyIniWrites(original, writes);
  } catch {
    return; // unparseable (hand-edited?) - leave it alone
  }
  if (updated === original) return;
  const bak = `${file}.nostalgia.bak`;
  try {
    await access(bak);
  } catch {
    await writeFile(bak, original).catch(() => undefined); // back up the pristine config once
  }
  await writeFile(file, updated);
}
