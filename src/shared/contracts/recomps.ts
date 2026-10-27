// Native Ports: fan-made PC builds of console games (static recompilations, decomps,
// game-specific runtimes) that run from files in the user's own copy of the game.
// Types plus the zod schema the bundled registry is validated against at load.

import { z } from 'zod';

export type RecompMethod = 'recomp' | 'decomp' | 'runtime';
export type RecompStatus = 'playable' | 'beta';

/** Game file the port needs, with how Nostalgia hands it over. */
export interface RecompGameFileReq {
  /** system slug of the ORIGINAL game, must match a seeded systems.slug (n64, ps2, xbox360, ...) */
  systemSlug: string;
  /** any one matching hash accepts the file; lowercase hex */
  accepted: { label: string; sha1?: string; md5?: string; crc32?: string }[];
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

export interface RecompManifest {
  id: string; // stable slug, e.g. "zelda64recomp"
  name: string; // "Zelda 64: Recompiled"
  originalTitle: string; // "The Legend of Zelda: Majora's Mask"
  method: RecompMethod;
  status: RecompStatus;
  summary: string;
  repo: string; // "Zelda64Recomp/Zelda64Recomp" (GitHub owner/name)
  homepage: string; // https URL shown as "Project page"; added to the openExternal allow-list
  /** glob matched against release asset names; Windows x64 only (Nostalgia is Windows-only) */
  assetMatch: string; // "*Windows*.zip"
  /** exe path relative to the extracted install root, e.g. "Zelda64Recompiled.exe" */
  exe: string;
  /** argv template; same tokens as emulators plus {installDir} */
  args: string[];
  gameFile: RecompGameFileReq;
  /** folders the port writes saves to; tokens {appData} {localAppData} {documents} {installDir} */
  saveDirs: string[];
  /** unified settings → this port's config file (optional) */
  config?: RecompConfigMap;
}

export type RecompInstallState = 'not_installed' | 'downloading' | 'verifying' | 'extracting' | 'installed' | 'failed';

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
  /** true when the linked game has a file whose hash is in manifest.gameFile.accepted */
  fileVerified: boolean;
  /** 'copy': the file is in place; 'in-app': the port has been launched at least once
   *  (so the user has already been through its file picker). */
  fileDelivered: boolean;
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

export const recompManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  originalTitle: z.string().min(1),
  method: z.enum(['recomp', 'decomp', 'runtime']),
  status: z.enum(['playable', 'beta']),
  summary: z.string(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  homepage: z.string().url().startsWith('https://'),
  assetMatch: z.string().min(1),
  exe: relPath,
  args: z.array(z.string()),
  gameFile: z
    .object({
      systemSlug: z.string().min(1),
      accepted: z
        .array(
          z
            .object({ label: z.string(), sha1: hex(40).optional(), md5: hex(32).optional(), crc32: hex(8).optional() })
            .refine((a) => a.sha1 || a.md5 || a.crc32, 'needs at least one hash'),
        )
        .min(1),
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
});

export const recompRegistrySchema = z.array(recompManifestSchema);
