import { recompManifestSchema, recompRegistrySchema, type RecompManifest } from '@shared/contracts/recomps';
import raw from './registry.json';

/**
 * The port registry: the list bundled with the app, with the remote registry (see
 * remoteRegistry.ts) merged over it. A remote entry replaces the bundled one with the same
 * id, or adds a new port - except for the kinds of port that decide what runs on the user's
 * PC (see remoteMayCarry), which stay bundled-only.
 */

let bundled: RecompManifest[] | null = null;
let remote: RecompManifest[] = [];
let merged: RecompManifest[] | null = null;

function bundledManifests(): RecompManifest[] {
  if (!bundled) bundled = recompRegistrySchema.parse(raw) as RecompManifest[];
  return bundled;
}

/**
 * What the remote list may NOT do, because each changes what runs on the user's PC or where
 * Nostalgia reads from: build from source, ship a bare .exe, point at an external installer,
 * or have the user pick files - and it can't replace a bundled port that does any of these,
 * nor switch a bundled port's kind. Those stay in the registry that ships with the app.
 */
function remoteMayCarry(m: RecompManifest, bundled: RecompManifest | undefined): boolean {
  const risky = (x: RecompManifest): boolean =>
    x.build != null || x.assetKind === 'exe' || x.assetKind === 'external' || x.gameFile.source === 'pick';
  if (risky(m)) return false;
  if (bundled && (risky(bundled) || bundled.assetKind !== m.assetKind)) return false;
  return true;
}

/**
 * Validates a remote list entry by entry (one bad entry drops itself, not the whole list)
 * and strips anything a remote entry may not carry. Returns the accepted entries.
 */
export function sanitizeRemote(entries: unknown): RecompManifest[] {
  if (!Array.isArray(entries)) return [];
  const bundledById = new Map(bundledManifests().map((m) => [m.id, m]));
  const out: RecompManifest[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const parsed = recompManifestSchema.safeParse(entry);
    if (!parsed.success) continue;
    const m = parsed.data as RecompManifest;
    if (seen.has(m.id) || !remoteMayCarry(m, bundledById.get(m.id))) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Installs a (sanitized) remote list; the merged view is rebuilt on next read. */
export function setRemoteManifests(list: RecompManifest[]): void {
  remote = list;
  merged = null;
}

export function listManifests(): RecompManifest[] {
  if (!merged) {
    const byId = new Map(remote.map((m) => [m.id, m]));
    const base = bundledManifests().map((m) => byId.get(m.id) ?? m);
    const known = new Set(base.map((m) => m.id));
    merged = [...base, ...remote.filter((m) => !known.has(m.id))];
  }
  return merged;
}

export function getManifest(id: string): RecompManifest | undefined {
  return listManifests().find((m) => m.id === id);
}

/** Vetted external URLs for app:openExternal: each port's project page and GitHub repo.
 *  Read at call time, so it follows the remote registry. */
export function recompExternalUrls(): string[] {
  return listManifests().flatMap((m) => [m.homepage, `https://github.com/${m.repo}`]);
}
