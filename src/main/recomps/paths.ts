import { app } from 'electron';
import { isAbsolute, join, relative } from 'node:path';
import { getSetting } from '../db/repositories/settingsRepo';

/** The managed ports folder: the `recomps.dir` setting, default <userData>/recomps. */
export function recompsDir(): string {
  const row = getSetting('recomps.dir');
  return row && !row.encrypted && typeof row.value === 'string' && row.value.length > 0
    ? row.value
    : join(app.getPath('userData'), 'recomps');
}

/** <recomps.dir>/<id> - every version of one port, plus its save-backups. */
export function portDir(recompId: string): string {
  return join(recompsDir(), recompId);
}

/** True when `child` resolves to `parent` itself or somewhere beneath it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Joins a manifest-relative path onto `base`, refusing anything that escapes it. */
export function joinInside(base: string, rel: string): string {
  const full = join(base, rel);
  if (isAbsolute(rel) || !isInside(base, full)) throw new Error('Port path escapes its install folder.');
  return full;
}

/** Expands a manifest saveDirs entry ({appData} {localAppData} {documents} {installDir}). */
export function expandSaveDir(template: string, installDir: string | null): string | null {
  const tokens: Record<string, string | null> = {
    '{appData}': app.getPath('appData'),
    '{localAppData}': process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local'),
    '{documents}': app.getPath('documents'),
    '{installDir}': installDir,
  };
  let out = template;
  for (const [token, value] of Object.entries(tokens)) {
    if (!out.includes(token)) continue;
    if (value == null) return null; // e.g. {installDir} for a port that isn't installed
    out = out.split(token).join(value);
  }
  return join(out); // separators only - the template is ours, not an opaque stored path
}
