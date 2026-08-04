// User-added download sources, persisted in the `settings` table (key `sources.custom`,
// plain JSON - same pattern as saves.dirs, no migration needed). The user pastes an
// archive.org /details or minerva-archive.org /browse URL and picks a console; we probe
// the item to detect file extensions + whether members are zipped, then store a source
// entry that the existing archive/minerva lookups merge in (see archiveSources.ts /
// minervaSources.ts). MAIN PROCESS ONLY.
import { randomUUID } from 'node:crypto';
import { getSetting, setSetting } from '../db/repositories/settingsRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { IGDB_PLATFORM_BY_SLUG } from '@shared/contracts/catalog';
import type { CustomSourceDTO } from '@shared/contracts/ipc';
import type { ArchiveSource } from './archiveSources';
import { MINERVA_SOURCES, minervaTorrentUrl, type MinervaSource } from './minervaSources';

const KEY = 'sources.custom';

export interface CustomSource {
  id: string;
  kind: 'archive' | 'minerva';
  systemId: number;
  platformId: number;
  /** Display label (archive item id or Minerva collection). */
  label: string;
  /** The original pasted URL. */
  url: string;
  extensions: string[];
  extract: boolean;
  /** archive.org item id (kind='archive'). */
  item?: string;
  /** Minerva "Redump - <Mfr> - <Platform>" collection (kind='minerva'). */
  collection?: string;
}

export function listCustomSources(): CustomSource[] {
  const row = getSetting(KEY);
  const val = row && !row.encrypted ? row.value : null;
  return Array.isArray(val) ? (val as CustomSource[]) : [];
}
function persist(list: CustomSource[]): void {
  setSetting(KEY, list, false);
}

export function toCustomSourceDTO(s: CustomSource): CustomSourceDTO {
  return { id: s.id, kind: s.kind, systemId: s.systemId, label: s.label, url: s.url, extensions: s.extensions, extract: s.extract };
}

// --- Merge hooks consumed by archiveSources.ts / minervaSources.ts -----------------------

export function getCustomArchiveSourcesForPlatform(platformId: number): ArchiveSource[] {
  return listCustomSources()
    .filter((s) => s.kind === 'archive' && s.platformId === platformId && s.item)
    .map((s) => ({ platformId, item: s.item!, extensions: s.extensions, extract: s.extract }));
}
export function getAllCustomArchiveSources(): ArchiveSource[] {
  return listCustomSources()
    .filter((s) => s.kind === 'archive' && s.item)
    .map((s) => ({ platformId: s.platformId, item: s.item!, extensions: s.extensions, extract: s.extract }));
}
export function getCustomMinervaSourcesForPlatform(platformId: number): MinervaSource[] {
  return listCustomSources()
    .filter((s) => s.kind === 'minerva' && s.platformId === platformId && s.collection)
    .map((s) => ({ platformId, collection: s.collection!, extensions: s.extensions }));
}

// --- Add / remove ------------------------------------------------------------------------

export async function addCustomSource(url: string, systemId: number): Promise<CustomSource> {
  const system = getSystem(systemId);
  if (!system) throw new Error('Unknown console.');
  const platformId = IGDB_PLATFORM_BY_SLUG[system.slug];
  if (platformId == null) throw new Error(`No catalog platform is mapped for ${system.name}.`);

  const parsed = parseSourceUrl(url);
  let entry: CustomSource;
  if (parsed.kind === 'archive') {
    const probe = await probeArchiveItem(parsed.item);
    entry = {
      id: randomUUID(),
      kind: 'archive',
      systemId,
      platformId,
      label: parsed.item,
      url,
      item: parsed.item,
      extensions: probe.extensions,
      extract: probe.extract,
    };
  } else {
    // A Minerva /browse path is a directory listing, not proof that a collection torrent
    // exists at the pinned assets version. Probe it up front so a typo'd or unsupported
    // path fails HERE with a clear message, instead of silently adding a source that
    // resolves nothing and leaves every title in that console greyed out.
    await probeMinervaCollection(parsed.collection);
    if (MINERVA_SOURCES.some((s) => s.collection === parsed.collection)) {
      throw new Error(`"${parsed.collection}" is already built in - its games are downloadable without adding it.`);
    }
    // Minerva collections are always per-game Redump .zip members → extract.
    entry = {
      id: randomUUID(),
      kind: 'minerva',
      systemId,
      platformId,
      label: parsed.collection,
      url,
      collection: parsed.collection,
      extensions: ['zip'],
      extract: true,
    };
  }

  const list = listCustomSources();
  const key = (s: CustomSource): string => `${s.kind}:${s.platformId}:${s.item ?? s.collection}`;
  const dup = list.find((s) => key(s) === key(entry));
  if (dup) return dup; // idempotent
  list.push(entry);
  persist(list);
  return entry;
}

export function removeCustomSource(id: string): void {
  persist(listCustomSources().filter((s) => s.id !== id));
}

// --- URL parsing + probing ---------------------------------------------------------------

type ParsedUrl = { kind: 'archive'; item: string } | { kind: 'minerva'; collection: string };

function parseSourceUrl(url: string): ParsedUrl {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  const host = u.host.toLowerCase();
  if (host.includes('archive.org')) {
    const m = /\/details\/([^/?#]+)/.exec(u.pathname);
    if (!m) throw new Error('Expected an archive.org /details/<item> link.');
    return { kind: 'archive', item: decodeURIComponent(m[1]) };
  }
  if (host.includes('minerva-archive.org')) {
    const m = /\/browse\/(.+?)\/?$/.exec(u.pathname);
    if (!m) throw new Error('Expected a minerva-archive.org /browse/<path> link.');
    // "Redump/Sony - PlayStation Portable" → collection "Redump - Sony - PlayStation Portable".
    const collection = decodeURIComponent(m[1])
      .split('/')
      .filter(Boolean)
      .join(' - ');
    return { kind: 'minerva', collection };
  }
  throw new Error('Only archive.org and minerva-archive.org links are supported.');
}

/**
 * Confirms a Minerva collection has a torrent at the pinned assets version. minerva-archive.org
 * is slow, so this is a HEAD with a short ceiling - and a HEAD the host refuses (405/501) is
 * NOT treated as a missing collection, only an outright 404 is.
 */
async function probeMinervaCollection(collection: string): Promise<void> {
  const url = minervaTorrentUrl(collection);
  let res: Response;
  try {
    res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error('Could not reach minerva-archive.org to check that collection. Try again in a moment.');
  }
  if (res.status === 404) {
    throw new Error(
      `Minerva has no torrent for "${collection}". Use the exact folder path from the /browse page (e.g. /browse/Redump/Sony - PlayStation 3/).`,
    );
  }
}

const IGNORE_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'xml', 'sqlite', 'torrent', 'txt', 'md5', 'sha1', 'sha256', 'nfo', 'pdf', 'ico', 'json',
]);

/** Reads an archive.org item's file list to guess the playable extensions + extract flag. */
async function probeArchiveItem(item: string): Promise<{ extensions: string[]; extract: boolean }> {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(item)}`);
  if (!res.ok) throw new Error(`Could not read that archive item (HTTP ${res.status}).`);
  const json = (await res.json()) as { files?: { name?: string }[]; is_dark?: boolean };
  if (json.is_dark) throw new Error('That archive item is dark - no files are available.');
  const counts = new Map<string, number>();
  for (const f of json.files ?? []) {
    const name = f.name ?? '';
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (!ext || IGNORE_EXT.has(ext)) continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  if (counts.size === 0) throw new Error('No downloadable game files were found in that item.');
  const exts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  // A per-game .zip/.7z set is extracted after download; disc images load directly.
  const extract = exts[0] === 'zip' || exts[0] === '7z';
  return { extensions: extract ? [exts[0]] : exts.slice(0, 5), extract };
}
