// Config mapping IGDB platforms to Internet Archive items used as download sources.
// THIS LIST IS THE ONLY PLACE DOWNLOAD SOURCES ARE DEFINED. To light up a console,
// paste one entry:  { platformId, item, extensions }  - no code changes needed.
// A platform may have MORE THAN ONE item (list several entries with the same
// platformId); matching tries each in order. No other sources are hardcoded.
import { ArchiveOrgStorageProvider, type ArchiveMatch } from '../storage/providers/archiveOrg';
import { getGame } from '../db/repositories/gamesRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getCustomArchiveSourcesForPlatform, getAllCustomArchiveSources } from './customSources';
import { IGDB_PLATFORM_BY_SLUG } from '@shared/contracts/catalog';

export interface ArchiveSource {
  /** IGDB platform id (see IGDB_PLATFORM_BY_SLUG). */
  platformId: number;
  /** Internet Archive item identifier (the part after archive.org/details/). */
  item: string;
  /** Playable file extensions in this item (lowercase, no dot). The file filter
   *  and what title-normalization strips. Defaults to a broad ROM/disc set. */
  extensions?: string[];
  /** Optional console-specific normalization: extra case-insensitive regex sources
   *  removed from titles for naming quirks the base rules don't cover. Rarely needed. */
  strip?: string[];
  /** When true, each game is a per-game .zip wrapping a disc image the emulator can't
   *  read directly (Redump Xbox 360 / Xbox / PS2 / PSX / PSP). The DownloadManager
   *  unzips the image after download and launches the extracted file (see extract.ts). */
  extract?: boolean;
  /** Path of a CONTAINER ZIP inside the item whose MEMBERS are the per-game files
   *  (No-Intro set zips, e.g. ni-roms "roms/… .zip"). Members are listed/served via
   *  the archive's zip-view service (non-ranged; see archiveOrg.ts). */
  zipPath?: string;
  /** Restrict indexing to files under this exact path prefix - for a multi-console
   *  item (a TOSEC Sega set holding Dreamcast + Saturn + Genesis) so one platform's
   *  source doesn't pull in the others' files. Byte-exact prefix, e.g. "Dreamcast/Games/". */
  pathPrefix?: string;
}

/** Unique id for a source: `<item>` or `<item>!<zipPath>` (several sources can share
 *  one item with different container zips). '!' never occurs in archive identifiers.
 *  Recorded on game_files as `archive-org:<id>` so downloads route to the exact zip. */
export function archiveSourceId(s: Pick<ArchiveSource, 'item' | 'zipPath'>): string {
  return s.zipPath ? `${s.item}!${s.zipPath}` : s.item;
}

/** Fallback file extensions when an entry doesn't specify its own. */
export const DEFAULT_ROM_EXTENSIONS = [
  'iso', 'bin', 'chd', 'cso', 'pbp', 'wbfs', 'rvz', 'gcm', 'nkit', 'cue',
  'zip', '7z', 'nes', 'sfc', 'smc', 'gb', 'gbc', 'gba', 'n64', 'z64', 'v64',
  'nds', '3ds', 'cia', 'md', 'gen', 'smd', 'pce', 'a26', 'gg', 'sms', 'ws', 'wsc',
];

/** Expands an alphabetized Redump collection into one `.zip`+extract source per item. */
function redumpSet(platformId: number, prefix: string, suffixes: string[]): ArchiveSource[] {
  return suffixes.map((s) => ({ platformId, item: `${prefix}${s}`, extensions: ['zip'], extract: true }));
}

// Each entry maps an IGDB platform to one Internet Archive item. A platform may
// list several items (tried in order; first title match wins). Items where each
// game is its own file/per-game archive work directly; container archives that
// pack many games inside ONE zip are NOT usable here (see archiveZip.ts).
export const ARCHIVE_SOURCES: ArchiveSource[] = [
  // PlayStation 2 (8)
  { platformId: 8, item: 'playstation2_essentials', extensions: ['iso', 'bin'] },
  // PlayStation (7) - Centuron-PSX ships bin+cue pairs; index the .bin (the data
  // track) so a game isn't dropped as a bin/cue ambiguity.
  { platformId: 7, item: 'Centuron-PSX', extensions: ['bin'] },
  // PlayStation (7) - Redump .chd set (r/Roms megathread). Per-game .chd, loads in
  // DuckStation directly (no extract). Access-restricted (needs ARCHIVE_S3 creds).
  { platformId: 7, item: 'chd_psx', extensions: ['chd'] },
  // NOTE - 'PSNCollectionByGhostware' was previously mapped here as a PlayStation 3 (9)
  // source. It is NOT a PS3 set: of its 1507 ISOs, 396 are named PSP outright and the rest
  // are "minis", which ship in PSP format. RPCS3 cannot boot any of them. Because the title
  // matcher only sees filenames, PS3 entries (e.g. Chains of Olympus, Ghost of Sparta -
  // which are PSP games whose HD versions are PS3) matched the PSP file and downloaded
  // gigabytes before the platform guard rejected them at the end. Removed rather than left
  // for the guard to catch, so those titles report availability honestly up front.
  // PlayStation 3 (9) - Redump .iso letter sets (public, NOT access-restricted). Per-game
  // raw .iso (single file, no extract). ⚠ These are ENCRYPTED disc dumps: RPCS3 needs the
  // per-disc key (.dkey) to boot them, and the keys are NOT bundled in these items - the
  // download SUCCEEDS but the game will not launch until a decrypt/key step is added.
  // Wired for availability/download; playability is a tracked follow-up.
  ...[
    'a_part1', 'a_part2', 'a_part3', 'b_part1', 'b_part2', 'b_part3', 'c_part1', 'c_part2', 'c_part3',
    'd_part1', 'd_part2', 'd_part3', 'd_part4', 'd_part5', 'e', 'f_part1', 'f_part2', 'f_part3',
    'g_part1', 'g_part2', 'g_part3', 'h_part1', 'h_part2', 'i', 'j', 'k', 'l_part1', 'l_part2', 'l_part3',
    'm_part1', 'm_part2', 'm_part3', 'm_part4', 'm_part5', 'n_part1', 'n_part2', 'n_part3',
    'o_part1', 'o_part2', 'o_part3', 'p_part1', 'p_part2', 'q', 'r_part1', 'r_part2', 'r_part3', 'r_part4',
    's_part1', 's_part2', 's_part3', 's_part4', 's_part5', 's_part6', 't_part1', 't_part2', 't_part3', 't_part4',
    'u_part1', 'u_part2', 'v', 'w_part1', 'w_part2', 'x', 'y', 'z',
  ].map((s): ArchiveSource => ({ platformId: 9, item: `sony_playstation3_${s}`, extensions: ['iso'] })),
  // PlayStation Portable (38) - this USA set is mislabeled by its item id.
  { platformId: 38, item: 'def-jam-vendetta-u', extensions: ['iso', 'cso'] },
  // Xbox (11) - xemu-ready .iso (some carry a .xiso.iso double extension).
  { platformId: 11, item: 'massive-xbox-usa-rom-set-xemu-ready', extensions: ['iso'] },
  { platformId: 11, item: 'microsoft-xbox-xemu-ready-software-collection-part-3', extensions: ['iso'], strip: ['\\.xiso'] },
  // Game Boy Advance (24) - per-game .zip (emulators load zipped ROMs directly).
  { platformId: 24, item: 'GameboyAdvanceRomCollectionByGhostware', extensions: ['zip'] },
  // Super Nintendo (19)
  { platformId: 19, item: 'gameplay-snes', extensions: ['7z'] },
  // GameCube (21) - per-game .rvz (Dolphin loads directly). ~93 English games.
  { platformId: 21, item: 'GameCube_rvz-english', extensions: ['rvz', 'iso', 'gcm', 'nkit'] },
  // Wii (5) - per-game USA .iso (No-Intro naming). ~110 games.
  { platformId: 5, item: 'Wii_ISO', extensions: ['iso', 'wbfs', 'rvz'] },

  // ── Complete Redump sets (r/Roms megathreads) ──────────────────────────────────
  // These are access-restricted archive.org items (require ARCHIVE_S3 creds - see
  // archiveCreds.ts) where each game is a per-game .zip wrapping a single disc image
  // the emulator can't read directly. `extract: true` → the DownloadManager unzips the
  // image after download and launches the extracted file. Alphabetized items (some
  // split into _partN); the matcher tries each until a title matches.
  ...redumpSet(12, 'microsoft_xbox360_', [
    'numberssymbols', 'a_part1', 'a_part2', 'b_part1', 'b_part2', 'c_part1', 'c_part2',
    'd_part1', 'd_part2', 'd_part3', 'e', 'f_part1', 'f_part2', 'g', 'h', 'i', 'j', 'k', 'l',
    'm_part1', 'm_part2', 'n_part1', 'n_part2', 'o', 'p', 'q', 'r', 's_part1', 's_part2',
    't_part1', 't_part2', 'u', 'v', 'w', 'x_part1', 'x_part2', 'y', 'z',
  ]),
  ...redumpSet(11, 'microsoft_xbox_', [
    'numberssymbols', 'a', 'b', 'c_part1', 'c_part2', 'd_part1', 'd_part2', 'e', 'f', 'g', 'h',
    'i', 'j', 'k', 'l', 'm_part1', 'm_part2', 'n_part1', 'n_part2', 'o_part1', 'o_part2', 'p',
    'q', 'r', 's_part1', 's_part2', 't_part1', 't_part2', 'u', 'v', 'w', 'x', 'y', 'z',
  ]),
  ...redumpSet(8, 'sony_playstation2_', [
    'numberssymbols', 'a', 'b', 'c', 'd_part1', 'd_part2', 'e', 'f', 'g', 'h', 'i', 'j', 'k',
    'l', 'm_part1', 'm_part2', 'n', 'o_part1', 'o_part2', 'p', 'q', 'r', 's_part1', 's_part2',
    's_part3', 's_part4', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  ]),
  ...redumpSet(7, '', ['sony_playstation_part1', 'sony_playstation_part2', 'sony_playstation_part3', 'sony_playstation_part4', 'sony_playstation_part5']),
  ...redumpSet(38, '', ['sony_playstation_portable_part1', 'sony_playstation_portable_part2', 'sony_playstation_portable_part3', 'sony_playstation_portable_part4']),

  // ── No-Intro cartridge sets via ni-roms container zips (r/Roms megathread) ─────
  // ni-roms is one access-restricted item whose files are per-SET zips; the per-game
  // files are MEMBERS of those zips, listed/served through the archive's zip-view
  // service (`zipPath` mode in archiveOrg.ts - non-ranged, single stream; ROMs are
  // small). Each member is itself a per-game .zip wrapping the bare ROM → extract.
  // Verified live 2026-07-05 (GBA lists 3559 members incl. Pokémon Emerald USA).
  { platformId: 24, item: 'ni-roms', zipPath: 'roms/Nintendo - Game Boy Advance.zip', extensions: ['zip'], extract: true },
  { platformId: 19, item: 'ni-roms', zipPath: 'roms/Nintendo - Super Nintendo Entertainment System.zip', extensions: ['zip'], extract: true },
  { platformId: 4, item: 'ni-roms', zipPath: 'roms/Nintendo - Nintendo 64 (BigEndian).zip', extensions: ['zip'], extract: true },

  // ── TOSEC Sega sets via a subfolder of a multi-console item (pathPrefix) ────────
  // One big access-restricted item holds every Sega console; pathPrefix scopes it to
  // one platform's Games folder. Per-game .zip wrapping a disc image → extract. Region
  // ranking picks the USA rip when a title ships in several regions.
  // Sega Dreamcast (23) - all regions under Dreamcast/Games/<region>/.
  { platformId: 23, item: 'tosec-iso-sega', pathPrefix: 'Dreamcast/Games/', extensions: ['zip'], extract: true },
  // Sega Saturn (32) - the [ISO] dumps (the [BIN] folder holds bin/cue duplicates).
  { platformId: 32, item: 'tosec-iso-sega-part2', pathPrefix: 'Saturn/Games/[ISO]/', extensions: ['zip'], extract: true },

  // ── Atari 2600 (59) ── per-game .7z (RetroArch/Stella load compressed ROMs directly,
  // like the SNES 7z set above - no extract).
  { platformId: 59, item: 'nointro.atari-2600', extensions: ['7z'] },

  // ── Nintendo Switch (130) ── per-game .nsp/.xci. E0701 is public; retro-nx is
  // access-restricted (needs ARCHIVE_S3 creds). NOTE: Switch titles need an emulator
  // (Ryujinx) plus firmware/prod.keys to boot - the download works; launch is user setup.
  { platformId: 130, item: 'E0701', extensions: ['nsp', 'xci'] },
  { platformId: 130, item: 'retro-nx', extensions: ['nsp', 'xci'] },

  // NOTE - the alphabetized Redump sets above are `access-restricted-item`. They now
  // work because the provider sends the ARCHIVE_S3 credential on the direct data node
  // (see archiveCreds.ts / archiveOrg.mirrorUrls). Without creds configured the provider
  // skips them and their titles show as unavailable.
  //
  // STILL MISSING (format-specific follow-ups, not yet wired):
  //   PS3:      sony_playstation3_* are raw .iso disc dumps; RPCS3 needs the disc key
  //             (.dkey) to boot them - not bundled in the .iso sets. Needs a launch-side
  //             decrypt/key step before wiring.
  //   DS:       every per-game DS item on the megathread is dark (checked 2026-07-05:
  //             no-intro-nintendo-ds-decrypted-roms-*), and ni-roms carries no DS set.
  //   GC/Wii:   megathread RVZ/ISO items (rvz-gc-*, wii_rvz_*, RedumpNintendoGameCube*,
  //             WiiRomSetByGhostware*) all came back dark 2026-07-05 - the existing
  //             partial sets above remain the only live sources.
];

/**
 * First-letter bucket of an alphabetized set item id, e.g. "sony_playstation3_s_part4" → 's',
 * "microsoft_xbox360_numberssymbols" → '#'. null = not letter-bucketed (a whole-set item like
 * "playstation2_essentials" or "sony_playstation_part1", which must always be checked).
 */
function itemLetterHint(item: string): string | null {
  if (/(?:^|_)numberssymbols$/i.test(item)) return '#';
  const m = /_([a-z])(?:_part\d+)?$/i.exec(item);
  return m ? m[1].toLowerCase() : null;
}

/** The letter bucket a title files under: leading article dropped (Redump files
 *  "The Last of Us" as "Last of Us, The" → 'l'), leading digit/symbol → '#'. */
function titleLetterBucket(title: string): string {
  const t = title.trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
  const c = t.charAt(0);
  return c >= 'a' && c <= 'z' ? c : '#';
}

/**
 * Orders a system's sources so the ones most likely to contain the title are tried
 * first: the title's own letter bucket, then un-bucketed whole-set items, then the
 * remaining letter buckets as a safety net. For alphabetized sets (PS3/X360/Xbox/PS2
 * Redump) this turns a worst-case a→z metadata crawl into a couple of fetches.
 */
export function orderSourcesForTitle(sources: ArchiveSource[], title: string): ArchiveSource[] {
  const letter = titleLetterBucket(title);
  const hit: ArchiveSource[] = [];
  const unbucketed: ArchiveSource[] = [];
  const rest: ArchiveSource[] = [];
  for (const s of sources) {
    const hint = itemLetterHint(s.item);
    if (hint === letter) hit.push(s);
    else if (hint == null) unbucketed.push(s);
    else rest.push(s);
  }
  return [...hit, ...unbucketed, ...rest];
}

function profileOf(source: ArchiveSource): {
  extensions: string[];
  strip?: string[];
  zipPath?: string;
  pathPrefix?: string;
} {
  return {
    extensions: source.extensions ?? DEFAULT_ROM_EXTENSIONS,
    strip: source.strip,
    zipPath: source.zipPath,
    pathPrefix: source.pathPrefix,
  };
}

export function getArchiveSourcesForPlatform(platformId: number): ArchiveSource[] {
  return [
    ...ARCHIVE_SOURCES.filter((s) => s.platformId === platformId),
    ...getCustomArchiveSourcesForPlatform(platformId), // user-added sources (Settings → Sources)
  ];
}

/** Looks a source up by its id (`<item>` or `<item>!<zipPath>` - see archiveSourceId). */
export function getArchiveSourceByItem(sourceId: string): ArchiveSource | undefined {
  return [...ARCHIVE_SOURCES, ...getAllCustomArchiveSources()].find((s) => archiveSourceId(s) === sourceId);
}

/**
 * Whether a game_file's `source` (`archive-org:<sourceId>`) is a per-game .zip that must
 * be unzipped after download before it can launch. Legacy bare `archive-org` → false.
 */
export function sourceNeedsExtract(source: string): boolean {
  const prefix = 'archive-org:';
  if (!source.startsWith(prefix)) return false;
  return getArchiveSourceByItem(source.slice(prefix.length))?.extract === true;
}

const providerCache = new Map<string, ArchiveOrgStorageProvider>();
export function getArchiveProvider(sourceId: string): ArchiveOrgStorageProvider {
  let provider = providerCache.get(sourceId);
  if (!provider) {
    const source = getArchiveSourceByItem(sourceId);
    // Legacy/unknown ids fall back to treating the id as a bare item name.
    provider = new ArchiveOrgStorageProvider(
      source?.item ?? sourceId,
      source ? profileOf(source) : { extensions: DEFAULT_ROM_EXTENSIONS },
    );
    providerCache.set(sourceId, provider);
  }
  return provider;
}

export function getArchiveSourcesForSystem(systemId: number): ArchiveSource[] {
  const system = getSystem(systemId);
  if (!system) return [];
  const platformId = IGDB_PLATFORM_BY_SLUG[system.slug];
  return platformId == null ? [] : getArchiveSourcesForPlatform(platformId);
}

export interface ArchiveResolved {
  source: ArchiveSource;
  match: ArchiveMatch;
}

/**
 * High-confidence match of a title across all Archive items configured for a
 * system's platform. Returns the first item that matches (and which one), so the
 * caller can record the exact item for download routing. null = unmatched (greyed).
 */
export async function matchArchiveForSystem(systemId: number, title: string): Promise<ArchiveResolved | null> {
  const ordered = orderSourcesForTitle(getArchiveSourcesForSystem(systemId), title);
  // The likely candidates (the title's own letter bucket + un-bucketed whole-set items -
  // exactly the ones orderSourcesForTitle front-loads) are tried one at a time: a hit here
  // is the common case and sequential keeps archive.org traffic minimal. A single item's
  // failure (throttle/network) skips it rather than aborting the whole match - without
  // that, one transient error cached the title as "unavailable" (the old Skate 3 bug).
  const likely = ordered.filter((s) => itemLetterHint(s.item) == null || itemLetterHint(s.item) === titleLetterBucket(title));
  const rest = ordered.filter((s) => !likely.includes(s));
  for (const source of likely) {
    try {
      const match = await getArchiveProvider(archiveSourceId(source)).matchTitle(title);
      if (match) return { source, match };
    } catch {
      /* skip this item, keep checking the rest */
    }
  }
  // Wrong-letter buckets almost never match - this tail exists to reach a definitive
  // "unavailable" (or catch an oddly-filed title). Sequentially it's ~35 metadata
  // fetches × network latency with the UI waiting; batches of 8 make the verdict
  // arrive several times faster. First hit (in order) wins.
  const BATCH = 8;
  for (let i = 0; i < rest.length; i += BATCH) {
    const results = await Promise.all(
      rest.slice(i, i + BATCH).map(async (source): Promise<ArchiveResolved | null> => {
        try {
          const match = await getArchiveProvider(archiveSourceId(source)).matchTitle(title);
          return match ? { source, match } : null;
        } catch {
          return null;
        }
      }),
    );
    const hit = results.find((r) => r != null);
    if (hit) return hit;
  }
  return null;
}

/** Whether any Archive source is configured for a system's platform. */
export function hasArchiveSourceForSystem(systemId: number): boolean {
  return getArchiveSourcesForSystem(systemId).length > 0;
}

/**
 * Resolves the provider for an archive-sourced game_file from its `source` column.
 * The catalog records `archive-org:<item>` so multi-item platforms route to the
 * exact item; legacy bare `archive-org` returns null (caller falls back by game).
 */
export function getArchiveProviderForSource(source: string): ArchiveOrgStorageProvider | null {
  const prefix = 'archive-org:';
  return source.startsWith(prefix) ? getArchiveProvider(source.slice(prefix.length)) : null;
}

/** Legacy/fallback: resolve by the game's platform (first configured source). */
export function getArchiveProviderForGame(gameId: number): ArchiveOrgStorageProvider | null {
  const game = getGame(gameId);
  if (!game) return null;
  const sources = getArchiveSourcesForSystem(game.systemId);
  return sources.length > 0 ? getArchiveProvider(archiveSourceId(sources[0])) : null;
}
