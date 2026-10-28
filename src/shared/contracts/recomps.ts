// Native Ports: fan-made PC builds of console games (static recompilations, decomps,
// game-specific runtimes) that run from files in the user's own copy of the game.
// Types plus the zod schema the bundled registry is validated against at load.

import { z } from 'zod';

export type RecompMethod = 'recomp' | 'decomp' | 'runtime';
export type RecompStatus = 'playable' | 'beta';

/** One known-good dump. Hashes are lowercase hex. */
export interface RecompAcceptedFile {
  label: string;
  sha1?: string;
  md5?: string;
  crc32?: string;
  sha256?: string;
  size?: number;
}

/** Game file the port needs, with how Nostalgia hands it over. */
export interface RecompGameFileReq {
  /**
   * Slug of the ORIGINAL game's console, for display, art and library matching. May name a
   * console Nostalgia has no system for (e.g. 'ps4') when `source` is 'pick'.
   */
  systemSlug: string;
  /**
   * Known-good dumps; any one match verifies the file. `sha256` and `size` serve disc images
   * too big to hash on the fly: an exact size match links the game (unverified), and the
   * port's own installer checks the hash. EMPTY when the project publishes no hash: the
   * port can then only be linked by hand, and the copy shows as unverified.
   */
  accepted: RecompAcceptedFile[];
  /**
   * Where the file comes from:
   *  - 'library'  a game in a Nostalgia system (auto-linked by hash; the user can still
   *               choose files instead when they have no matching library game)
   *  - 'pick'     something Nostalgia doesn't manage (PS4 dumps, XBLA packages, Switch
   *               ExeFS/RomFS, PSP folders): chosen once through an OS dialog in main
   */
  source: 'library' | 'pick';
  /** what the OS dialog selects (default 'file') */
  pickKind?: 'file' | 'folder';
  /** plain-text hint shown with "Choose files…", e.g. the exact dump and update needed */
  pickHint?: string;
  /**
   * How the file reaches the port:
   *  - 'argv'      pass it through launch.args ({romPath} token, element-wise like emulators)
   *  - 'copy'      copy (hardlink when same volume) into the install at `placePath` before first launch
   *  - 'in-app'    the port asks for it itself; Nostalgia shows "Select this file in the port" with Reveal
   */
  delivery: 'argv' | 'copy' | 'in-app';
  /** for 'copy': path relative to the install dir, e.g. "assets/game.iso" */
  placePath?: string;
}

/** The unified per-port settings Nostalgia can set for the user (one UI for every port). */
export type PortSettingKey = 'fullscreen' | 'resolution' | 'frameCap';
export const PORT_SETTING_KEYS: PortSettingKey[] = ['fullscreen', 'resolution', 'frameCap'];
export type ConfigScalar = string | number | boolean;

/**
 * How the unified settings map onto a port's own config file. Each option maps a choice id
 * (e.g. 'on', 'original2x', '60') to the key/value writes that select it. JSON keys are
 * dotted paths into nested objects; INI/TOML keys are `section.key` (or a bare top-level key).
 * Applied before launch, to an EXISTING file only (backed up once, idempotent).
 */
export interface RecompConfigMap {
  /** tokens {installDir} {localAppData} {appData} {documents} */
  file: string;
  format: 'json' | 'ini';
  options: Partial<Record<PortSettingKey, Record<string, Record<string, ConfigScalar>>>>;
}

/** The user's picks for one port: setting → choice id. Absent = leave the port's own value. */
export type RecompUserConfig = Partial<Record<PortSettingKey, string>>;

/**
 * A port built from source on the user's PC (no prebuilt release). Bundled registry ONLY:
 * the remote registry can never add or change one, since it names commands Nostalgia runs.
 * Sources are a `git clone` of `repo`; every command is python with these argv arrays, run
 * from the checkout. Element-wise tokens: {romPath} = the linked game file; {workDir} = a
 * short build folder Nostalgia owns (`<system drive>\nostalgia-<id>`, removed on uninstall;
 * builds can hold ~50k deep files, so it stays clear of the 260-character path limit).
 */
export interface RecompBuild {
  /** tools that must be on PATH before building */
  requires: ('git' | 'python')[];
  /** python script + args that builds the port, e.g. ["tools/install.py", "--iso", "{romPath}"] */
  install: string[];
  /** python script + args that starts the built game */
  run: string[];
  /** shown before building: what the user's PC needs */
  requirements: string;
}

/**
 * What the port's GitHub release asset is:
 *  - 'zip' / '7z'  an archive Nostalgia extracts into the install
 *  - 'exe'         a single-file program, placed as <installDir>/<exe>
 *  - 'external'    the port ships its own installer/launcher; Nostalgia doesn't install it.
 *                  The user installs it from the project page, then locates its exe once.
 */
export type RecompAssetKind = 'zip' | '7z' | 'exe' | 'external';

export interface RecompManifest {
  id: string; // stable slug, e.g. "zelda64recomp"
  name: string; // "Zelda 64: Recompiled"
  originalTitle: string; // "The Legend of Zelda: Majora's Mask"
  method: RecompMethod;
  status: RecompStatus;
  summary: string;
  repo: string; // "Zelda64Recomp/Zelda64Recomp" (GitHub owner/name, canonical)
  homepage: string; // https URL shown as "Project page"; added to the openExternal allow-list
  /** glob matched against release asset names; Windows x64 only (Nostalgia is Windows-only).
   *  Absent for `build` and `external` ports. */
  assetMatch?: string; // "*Windows*.zip"
  assetKind: RecompAssetKind;
  /** exe path relative to the install root, e.g. "Zelda64Recompiled.exe". For 'external' it
   *  only pre-fills the locate dialog. */
  exe?: string;
  /** argv template; same tokens as emulators plus {installDir} */
  args: string[];
  gameFile: RecompGameFileReq;
  /** folders the port writes saves to; tokens {appData} {localAppData} {documents} {installDir} */
  saveDirs: string[];
  /** unified settings → this port's config file (optional) */
  config?: RecompConfigMap;
  /** built from source instead of downloaded (bundled registry only) */
  build?: RecompBuild;
  /** the original game's IGDB id, for art (fetched by main; no image URLs in the registry) */
  igdbId?: number;
  /** ISO date the entry was added, for the "Recently added" sort */
  addedAt?: string;
}

export type RecompInstallState =
  | 'not_installed'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'building'
  | 'installed'
  | 'failed';

/** Whether the user's copy of the game is in hand: a known-good dump, some copy, or none. */
export type RecompGameReady = 'verified' | 'unverified' | 'missing';

export interface RecompDTO {
  manifest: RecompManifest;
  state: RecompInstallState;
  installedTag: string | null;
  /** the version kept on disk for rollback, after an update */
  previousTag: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  /** games.id this port is linked to, when linked */
  linkedGameId: number | null;
  /** the user's copy: verified dump (hash match), unverified (hand-linked, size match, picked), or missing */
  gameReady: RecompGameReady;
  /** basename of picked files/folder, for display only (never the path) */
  pickedName: string | null;
  /** 'copy': the file is in place; 'in-app': the port has been launched at least once
   *  (so the user has already been through its file picker). */
  fileDelivered: boolean;
  /** installed (or located, for 'external') + the game in hand + nothing busy. Computed in main. */
  canPlay: boolean;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Registry validation (main parses registry.json with this at load)
// ---------------------------------------------------------------------------

const hex = (len: number) => z.string().regex(new RegExp(`^[0-9a-f]{${len}}$`));
/** A path inside the install: relative, no `..` segment, no drive or root. */
const relPath = z
  .string()
  .min(1)
  .refine((p) => !/^([a-zA-Z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..'), 'must be a relative path inside the install');

export const recompManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    originalTitle: z.string().min(1),
    method: z.enum(['recomp', 'decomp', 'runtime']),
    status: z.enum(['playable', 'beta']),
    summary: z.string(),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    homepage: z.string().url().startsWith('https://'),
    assetMatch: z.string().min(1).optional(),
    assetKind: z.enum(['zip', '7z', 'exe', 'external']).default('zip'),
    exe: relPath.optional(),
    args: z.array(z.string()),
    gameFile: z
      .object({
        systemSlug: z.string().min(1),
        accepted: z
          .array(
            z
              .object({
                label: z.string(),
                sha1: hex(40).optional(),
                md5: hex(32).optional(),
                crc32: hex(8).optional(),
                sha256: hex(64).optional(),
                size: z.number().int().positive().optional(),
              })
              .refine((a) => a.sha1 || a.md5 || a.crc32 || a.sha256 || a.size, 'needs a hash or a size'),
          )
          .default([]),
        source: z.enum(['library', 'pick']).default('library'),
        pickKind: z.enum(['file', 'folder']).optional(),
        pickHint: z.string().optional(),
        delivery: z.enum(['argv', 'copy', 'in-app']),
        placePath: relPath.optional(),
      })
      .refine((g) => g.delivery !== 'copy' || g.placePath, "'copy' delivery needs placePath"),
    saveDirs: z.array(z.string()),
    config: z
      .object({
        file: z.string().min(1),
        format: z.enum(['json', 'ini']),
        options: z
          .object({
            fullscreen: z.record(z.record(z.union([z.string(), z.number(), z.boolean()]))),
            resolution: z.record(z.record(z.union([z.string(), z.number(), z.boolean()]))),
            frameCap: z.record(z.record(z.union([z.string(), z.number(), z.boolean()]))),
          })
          .partial(),
      })
      .optional(),
    build: z
      .object({
        requires: z.array(z.enum(['git', 'python'])),
        install: z.array(z.string()).min(1),
        run: z.array(z.string()).min(1),
        requirements: z.string(),
      })
      .optional(),
    igdbId: z.number().int().positive().optional(),
    addedAt: z.string().date().optional(),
  })
  .refine(
    (m) => m.build || m.assetKind === 'external' || (m.assetMatch && m.exe),
    'a release port needs assetMatch and exe',
  );

export const recompRegistrySchema = z.array(recompManifestSchema);
