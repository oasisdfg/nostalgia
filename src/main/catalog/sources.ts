// Unified download-source resolution across ALL source families (Internet Archive + Minerva
// torrents). The catalog handlers and the DownloadManager go through here so a new family is
// added in one place. A resolved match carries the opaque `source` string that gets recorded
// on game_files (`archive-org:<id>` or `minerva:<collection>`) and later routes the download.
import {
  hasArchiveSourceForSystem,
  matchArchiveForSystem,
  archiveSourceId,
  sourceNeedsExtract as archiveSourceNeedsExtract,
} from './archiveSources';
import { getMinervaSourcesForSystem, getMinervaProvider, minervaSourceString } from './minervaSources';
import type { ArchiveMatch } from '../storage/providers/archiveOrg';

export interface ResolvedSource {
  /** Opaque source tag recorded on game_files.source. */
  source: string;
  match: ArchiveMatch;
}

/** Any download source (archive or Minerva) configured for the system's platform. */
export function hasAnySourceForSystem(systemId: number): boolean {
  return hasArchiveSourceForSystem(systemId) || getMinervaSourcesForSystem(systemId).length > 0;
}

/**
 * High-confidence match of a title across every configured source for a system. Internet
 * Archive is tried first (carries md5 for verification + direct HTTP is faster than a
 * torrent swarm); Minerva torrents are the fallback for titles the archive items miss.
 * Returns the source tag + match, or null (title greyed out) when nothing matches.
 */
export async function matchAnySourceForSystem(systemId: number, title: string): Promise<ResolvedSource | null> {
  const arch = await matchArchiveForSystem(systemId, title).catch(() => null);
  if (arch) return { source: `archive-org:${archiveSourceId(arch.source)}`, match: arch.match };
  for (const s of getMinervaSourcesForSystem(systemId)) {
    const m = await getMinervaProvider(s.collection)
      .matchTitle(title)
      .catch(() => null);
    if (m) return { source: minervaSourceString(s.collection), match: m };
  }
  return null;
}

/** Whether a source's downloaded file is a per-game .zip that must be unzipped to launch. */
export function sourceNeedsExtract(source: string): boolean {
  if (source.startsWith('minerva:')) return true; // Minerva Redump members are per-game zips
  return archiveSourceNeedsExtract(source);
}
