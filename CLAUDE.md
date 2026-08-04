# Nostalgia - Engineering Guide (CLAUDE.md)

Nostalgia is a Windows-only desktop emulation frontend (LaunchBox / Playnite class) built on **Electron + React + TypeScript + Vite** (via `electron-vite`). The canonical contracts document (schema, TypeScript interfaces, naming registry) is the single source of truth; this file is the governance layer that enforces it. Where this file restates a schema column, IPC channel, enum value, or interface name, it cites the canonical name **verbatim**. Do not introduce a second spelling.

This guide is split into:

1. Architecture at a glance
2. Process boundaries and the data layer
3. [Security posture (locked)](#security-posture-locked)
4. [SQLite schema](#4-sqlite-schema) - the canonical schema plus the additive migration `0002` this guide mandates
5. Storage, download, and cache subsystem
6. [Metadata subsystem](#6-metadataprovider-interface--provider-chain)
7. [On-demand download + cache subsystem](#7-on-demand-download--cache-subsystem)
8. [Metadata scraping subsystem](#8-metadata-scraping-subsystem)
9. [Emulator launch subsystem](#9-emulator-launch-subsystem)
10. [Gamepad / spatial navigation](#10-gamepad--spatial-navigation-architecture)
11. [UI modes & shared component library](#11-ui-modes--shared-component-library)
12. Conventions for Claude Code working in this repo

---

## 1. Architecture at a glance

- **Main process** owns everything stateful and privileged: `better-sqlite3` (synchronous, native, rebuilt for Electron via `@electron/rebuild`), the `StorageProvider` and `MetadataProvider` implementations, the download/cache manager, the launcher (`child_process.spawn`), the save-sync engine, secret encryption (`safeStorage`), and all network I/O.
- **Preload** exposes exactly one bridge object, `window.nostalgia`, via `contextBridge`. It is typed against `IpcInvokeMap` / `IpcEventMap` and exposes nothing else.
- **Renderer** is React + Tailwind. UI/app state lives in **Zustand** (active mode, focus context, transient settings). Every DB-backed read goes through **TanStack Query** wrapping the IPC bridge; `IpcEventMap` push events drive cache invalidation. The renderer never touches the DB, the filesystem, or the network directly.
- **Two UI modes, one component library:** windowed **Desktop Mode** (mouse + keyboard) and fullscreen **Big Screen Mode** (fully gamepad-navigable via `@noriginmedia/norigin-spatial-navigation` fed by the Gamepad API). Both render from the same component library and the same data layer.

The on-demand model is central: games are **not** stored locally by default. Logical titles (`games`) and their files (`game_files`) are first created by a **library ingest** pass that walks `StorageProvider.list()`; the actual bytes are fetched on demand into a size-limited LRU cache and launched from there.

---

## 2. Process boundaries and the data layer

- `better-sqlite3` is imported **only** under `src/main/`. A lint rule blocks the import anywhere else.
- The renderer's authoritative data is read via TanStack Query hooks that call `window.nostalgia.invoke(channel, request)`. Mutations invalidate the relevant query keys. The push channels `downloads:stateChanged`, `saves:syncStateChanged`, `cache:changed`, `launch:exited`, and `scrape:progress` drive invalidation so the UI stays live without polling.
- Zustand holds only UI/app state - active mode, current focus context, transient (unsaved) settings. It never caches authoritative DB rows.
- Schema changes are always migrations (see [§4](#4-sqlite-schema)). Never hand-edit a live DB or mutate `schema_migrations`.

---

## Security posture (locked)

> Anchor: `security-posture-locked`

These rules are non-negotiable. A PR that loosens any of them must be rejected.

### Secret handling (encrypted at rest, never decrypted across IPC)

`screenscraper.credentials` and `thegamesdb.apiKey` are stored as `safeStorage`-encrypted blobs in `settings` with `settings.encrypted = 1`; `settings.value` holds the base64 of the ciphertext. The one and only module permitted to call `safeStorage` is `src/main/secrets/safeStore.ts`.

```ts
// src/main/secrets/safeStore.ts  (main process only - never imported by renderer/preload)
import { safeStorage } from 'electron';

export function setSecret(key: string, plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage unavailable; refusing to persist secret as plaintext');
  }
  const blob = safeStorage.encryptString(plaintext);            // Buffer
  upsertSetting({ key, value: blob.toString('base64'), encrypted: 1, updated_at: Date.now() });
}

/** In-process only. NEVER reachable from any IPC channel. */
export function getSecret(key: string): string | null {
  const row = readSetting(key);                                 // { value, encrypted }
  if (!row) return null;
  if (row.encrypted !== 1) throw new Error(`settings['${key}'] not marked encrypted`);
  return safeStorage.decryptString(Buffer.from(row.value, 'base64'));
}
```

Hard rules that every author must honor:

- **Plaintext secrets never cross IPC. Decryption is in-process only.** There is **no** IPC channel that returns a decrypted credential. The `'settings:get'` and `'settings:getMany'` handlers **redact** encrypted rows: for an encrypted row, `'settings:get'` returns `{ key, value: null, encrypted: true }` - the canonical response type is `{ key: string; value: unknown; encrypted: boolean } | null`, and `value` is set to `null` for encrypted rows (never the decrypted string, never a sentinel string literal not defined in the contracts). `'settings:getMany'` returns `null` for the value of any encrypted key in its `Record<string, unknown>`. Decrypted credentials are obtained **only** by calling `getSecret()` in main, and are passed in-process directly into the `MetadataProvider` implementations (`src/main/metadata/providers/screenScraper.ts`, `src/main/metadata/providers/theGamesDb.ts`). They are never logged, never serialized into an error payload, never returned to the renderer.
- **The renderer can write a secret but never read one back.** `'settings:set'` accepts `{ key, value, encrypted?: boolean }`; when `encrypted` is true the main handler routes to `setSecret()` and the plaintext is consumed and discarded. A subsequent `'settings:get'` on that key yields `{ value: null, encrypted: true }`.
- **`safeStorage` requires the app to be ready.** All secret access occurs after the Electron `ready` event. On Windows this binds the ciphertext to the OS user via DPAPI, so a copied DB on another machine/account will fail to decrypt - which is the desired behavior, not a bug to work around.
- **Non-secret settings stay JSON and are returned verbatim.** `storage.root`, `storage.providerId`, `cache.dir`, `cache.sizeLimitBytes`, `ui.defaultMode`, and `scrape.defaultChain` are `encrypted = 0`; `settings.value` is plain JSON and is returned verbatim over `'settings:get'` (i.e. `value` is the parsed JSON, `encrypted: false`). Only `encrypted = 1` rows are redacted.

### Electron process hardening

Every `BrowserWindow` (Desktop Mode and Big Screen Mode share one window factory in `src/main/windows/createWindow.ts`) is created with the locked-down baseline below. These `webPreferences` are non-negotiable; a PR that loosens any of them must be rejected.

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,          // preload and page share no scope
    sandbox: true,                   // renderer runs in the OS sandbox
    nodeIntegration: false,          // no require()/process in the page
    nodeIntegrationInWorker: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, '../preload/index.js'),
  },
});
```

`sandbox: true` is correct and required. A `contextIsolation` preload that talks to main only through `ipcRenderer` / `contextBridge` - which is exactly what the single `window.nostalgia` bridge does - needs **no** Node built-ins. `better-sqlite3` and all other Node usage live in the **main** process, not the preload, so nothing in the renderer or preload requires `sandbox: false`. Do not relax it.

- **Single bridge surface.** The preload (`src/preload/index.ts`) exposes exactly one object via `contextBridge.exposeInMainWorld('nostalgia', …)` - the `window.nostalgia` bridge. It exposes typed `invoke`/event-subscription wrappers and **nothing else**: no `ipcRenderer`, no `require`, no Node primitives. `@electron/remote` is **not installed** and must never be added.
- **Validated IPC, allow-listed channels.** Main registers `ipcMain.handle` for the **exact** string keys of `IpcInvokeMap` and no others. Every handler validates its `request` payload against a zod schema before touching the DB - IDs are coerced to integers, enum strings are checked against the canonical value sets (e.g. `downloads.state`, `saves.sync_state`), and unknown channels are never registered. The preload rejects any channel name not present in `IpcInvokeMap` / `IpcEventMap`, so the renderer cannot smuggle arbitrary strings into `ipcRenderer.invoke`.
- **No decrypted text or secret blobs in error payloads.** Any IPC error payload returned to the renderer must never carry a `settings.value` blob or decrypted text. Error envelopes carry a stable code and a human-safe message only; when in doubt, redact.
- **Strict CSP.** The renderer ships a restrictive Content-Security-Policy (set via `onHeadersReceived` in main and a `<meta>` fallback): `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'` (Tailwind's injected styles), `img-src 'self' asset:`, `connect-src 'self'`. No remote `script-src`. The page never makes network calls itself - all scraping/download HTTP happens in main; remote art is fetched in main, written to the assets folder, and surfaced to the renderer only as `media_assets.local_path` (served through the `asset:` protocol).
- **Local assets via a custom protocol, not `file://`.** Register a privileged `asset:` protocol in main that maps to the assets folder and the cache dir, so the renderer references images through `asset://…` instead of being granted `file://` read of the whole disk. The opaque on-disk paths (`media_assets.local_path`, `cache_entries.local_path`) stay in main; the renderer gets protocol URLs. `file://` URLs are forbidden in the renderer.
- **Navigation lockdown.** `webContents.on('will-navigate')` and `setWindowOpenHandler` both deny everything except the app's own origin; external links (if ever needed) go through `shell.openExternal` from main after validation. No `window.open`, no new windows.
- **No insecure dev affordances in production.** DevTools, the React devtools bridge, and any verbose logging are compiled out / disabled when `app.isPackaged` is true.

### Opaque-path discipline (repo-wide rule)

Paths and storage keys may contain invisible Unicode (zero-width joiners, RTL marks, NBSPs, combining characters). They are **data, not display strings**. This applies to every column flagged opaque in [§4](#4-sqlite-schema): `emulators.exe_path`, `emulators.working_dir`, `systems.icon_path`, `game_files.storage_key`, `media_assets.local_path`, `downloads.temp_path`, `cache_entries.local_path`, `cache_entries.cache_key`, `saves.local_path`, plus the `destPath`/`localPath` fields on `DownloadOptions` / `DownloadResult` and `RemoteEntry.key` / `RemoteStat.key`.

Rules:

- **Store verbatim.** Persist exactly the bytes the OS file dialog or the `StorageProvider` returned. No `path.normalize`, no NFC/NFD Unicode normalization, no case-folding, no trimming, no separator rewriting, no slug-ification of a path.
- **Compare as bytes.** Equality and lookups (e.g. resolving a `cache_entries.cache_key`, dedup on `game_files (game_id, storage_key)`) are exact string/byte comparisons. Never "normalize then compare." If two visually identical paths differ by a zero-width character, they are different keys - that is correct.
- **Never build a shell command.** There is **no** `exec`, no `shell: true`, no string interpolation of a path into a command line, anywhere in the repo. Launch is always:

```ts
// src/main/launch/launcher.ts
child_process.spawn(emulator.exePath, resolvedArgvArray, {
  cwd: workingDir ?? path.dirname(emulator.exePath),
});
```

  The launch-arg templates (`emulators.default_args_template`, `system_emulator.launch_args_template`, both JSON `string[]`) are resolved **element-wise**: each placeholder token (`{romPath}`, `{romDir}`, `{romName}`, `{systemSlug}`, `{emulatorDir}`) is substituted inside its own array element and pushed to `resolvedArgvArray` as a discrete argv entry. A path is never split on spaces, never quoted by hand, never concatenated with another argument. **`{romPath}` resolves to `cache_entries.local_path` for the row whose `cache_entries.game_file_id` equals the launched `game_files.id`.** (The on-disk path lives only on `cache_entries.local_path`; there is no `game_files.local_path` column. The bytes must already be `cache_state = 'cached'`; the launcher resolves/triggers the download first - see [§9](#9-emulator-launch-subsystem).) Full launch semantics are in [§9](#9-emulator-launch-subsystem).

- **Round-trip through TypeScript, not the shell.** When a path must reach an emulator, it travels as a string in the argv array; OS quoting is handled by `spawn`. ESLint bans `child_process.exec`, `child_process.execSync`, and `spawn` with `shell: true`.

### Main-resolved exe-path rule for emulator executables

`emulators.exe_path` is **never supplied by the renderer** - main resolves every path, from exactly these sources (all return the resolved absolute path verbatim, stored opaque):

1. **OS file dialog** - `'emulators:browseForExe'` opens `dialog.showOpenDialog({ properties: ['openFile'], defaultPath: <managed emulator dir>, filters: [{ name: 'Executable', extensions: ['exe'] }] })`; returns `{ exePath }` or `null`.
2. **Scan of the app-managed emulator folder** - `'emulators:scanDir'` walks the `emulators.dir` setting (default `<userData>/emulators`, see `src/main/emulators/detect.ts`), matches a conservative known-emulator filename allow-list, and registers any new ones. The renderer triggers the scan but supplies **no path**; main resolves every `exe_path` from inside the managed dir.
3. **Main-curated, checksum-verified install** *(planned)* - a vetted catalog of emulators (id → official URL + pinned checksum). Main downloads → verifies → extracts into the managed dir → registers. The renderer only picks a catalog **id**, never a URL or path.

- The emulator create/edit UI has **no free-text field** for the exe path - it shows the chosen path read-only and a "Browse…" button wired to `'emulators:browseForExe'`. The renderer cannot type, paste, or construct an exe path.
- `'emulators:create'` / `'emulators:update'` accept an `exePath` that **must** have originated from one of the main-side sources above; main treats it as opaque and stores it unchanged. No hardcoded default emulator paths ship in the repo (the curated catalog is download config, not a shipped path).

### No debug/developer UI in shipped views

Shipped Desktop Mode and Big Screen Mode views contain **no** developer-facing surface: no raw SQL console, no IPC-channel inspector, no "dump JSON," no `metadata.raw_json` viewer, no log panel, no feature-flag toggles, no path-as-displayed-with-escape-codes widgets. The UI is clean and self-evident. This is the same product rule enforced structurally in [§11](#11-ui-modes--shared-component-library).

- Diagnostics, if needed during development, live behind `if (!app.isPackaged)` in main or a dev-only route that is **tree-shaken out** of the production renderer bundle - never a hidden key combo in a shipped view.
- Internal identifiers (DB row ids, provider game ids, `downloads.id`, opaque storage keys) are not rendered to users. The UI shows titles, art, and human labels (`display_name`, `name`), never `storage_key` or `provider_game_id`.

---

## 4. SQLite schema

> Anchor: `4-sqlite-schema`

The canonical schema in the contracts document is authoritative for migration `0001_init.sql`. This section restates the column names every other section cites and then specifies the **additive migration `0002`** that this guide mandates to close real gaps surfaced by the launch, scrape, save-discovery, and save-sync flows. `0002` is forward-only and adds only new columns, new indexes, and new constraints; it does not alter existing column types.

Pragmas applied at open (`src/main/db/connection.ts`), verbatim:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

Conventions: timestamps are `INTEGER` Unix epoch **milliseconds**; booleans are `INTEGER NOT NULL DEFAULT 0 CHECK (col IN (0,1))`; enums are `TEXT` with a `CHECK`; JSON columns are `TEXT` with `CHECK (json_valid(col))`; opaque paths/keys are `TEXT` stored verbatim.

Tables (canonical names): `schema_migrations`, `systems`, `emulators`, `system_emulator`, `games`, `game_files`, `metadata`, `media_assets`, `downloads`, `cache_entries`, `saves`, `settings`, `scrape_jobs`, `play_sessions`.

### Key column references (cite verbatim)

- The **launch path** lives only on `cache_entries.local_path`, joined to the launched file via `cache_entries.game_file_id` = `game_files.id`. **There is no `game_files.local_path` column.** `game_files` columns are: `id, game_id, storage_key, display_name, size_bytes, crc32, md5, sha1, hash_source, disc_no, is_primary, cache_state, created_at, updated_at`.
- Hash columns (lowercase hex, no `0x`): `crc32`, `md5`, `sha1` on both `game_files` and `saves`.
- `game_files.hash_source ∈ {manifest, post_download, none}` records whether hashes came from `StorageProvider.stat()` (manifest) or from hashing after download.
- `game_files.cache_state ∈ {remote, downloading, cached, stale, error}`. Newly ingested rows start at `remote`.

### Migration `0002` - additive constraints and columns this guide mandates

Each statement below resolves a concrete gap. All are additive and idempotent within the migration transaction.

```sql
-- 0002_schema_amendments.sql

-- (A) media_assets dedupe is enforced by the DB, not just by app logic.
--     A game legitimately has many 'screenshot'/'fanart' rows, so (game_id,type)
--     cannot be unique - but (game_id,type,checksum) is the real dedupe key.
--     mediaCache.ts computes the sha1 BEFORE insert and uses INSERT ... ON CONFLICT.
--     checksum MUST be non-NULL on the upsert path (it is the conflict target).
CREATE UNIQUE INDEX uq_media_assets_dedupe
  ON media_assets(game_id, type, checksum);

-- (B) saves identity, so post-play discovery is an idempotent UPSERT instead of
--     accumulating duplicate rows on every launch:exited re-scan. slot is nullable,
--     so local_path (NOT NULL, opaque, verbatim) keeps the key total.
CREATE UNIQUE INDEX uq_saves_identity
  ON saves(game_id, type, slot, local_path);

-- (C) Three-way save-sync state: capture what the remote was at last successful sync
--     so the engine can tell "remote is newer" from "remote is the version I already
--     have," and detect a true conflict without re-listing every time.
--     conflict := local sha1 != synced_hash  AND  remote updatedAt != remote_updated_at
ALTER TABLE saves ADD COLUMN remote_updated_at INTEGER;   -- epoch ms of RemoteSaveRef.updatedAt at last sync
ALTER TABLE saves ADD COLUMN synced_hash       TEXT;      -- sha1 that was synced (matches saves.sha1 at sync time)

-- (D) Back the ON DELETE CASCADE + per-system save-folder query path with an index,
--     mirroring the other FK indexes. Without it, deleting a system and every
--     per-system save query is a full table scan.
CREATE INDEX idx_saves_system ON saves(system_id);

-- (E) Protect a user's manual metadata pin from being silently overwritten by a
--     later automatic re-scrape. The scrape worker MUST skip denormalizing onto
--     `games` when this is 1 (see §8).
ALTER TABLE games ADD COLUMN metadata_locked INTEGER NOT NULL DEFAULT 0
  CHECK (metadata_locked IN (0,1));

-- (F) Back a global recent/most-played SESSION feed (distinct from the denormalized
--     games.last_played_at / play_count) with a global ORDER BY started_at DESC index.
--     The existing per-game composite idx_play_sessions_game cannot serve this as a prefix.
CREATE INDEX idx_play_sessions_started ON play_sessions(started_at);
```

> **Download checksum coupling (enforced in `0001_init.sql`).** `downloads.checksum_expected TEXT` and `downloads.checksum_algo TEXT CHECK (checksum_algo IN ('crc32','md5','sha1'))` must be coupled so the verify step can never silently no-op: the table carries `CHECK ((checksum_expected IS NULL) = (checksum_algo IS NULL))`. When both are present, verification is **mandatory** before the `.part` file is renamed to its final path, and `cache_entries.verified` is set to `1` only on a passing compare (see [§7](#7-on-demand-download--cache-subsystem)). If a pre-existing `0001` predates this CHECK, add it in `0002` as `-- (G)` with the same predicate.

The `metadata` table keeps `UNIQUE (game_id, provider)` and stores per-provider `matched_by`, `match_confidence`, and `provider_game_id`. The `games`-level denormalization (description, release_date, genre, players, rating) is gated by `games.metadata_locked` (above): a manual pin sets the lock; the scrape worker honors it.

---

## 5. Storage, download, and cache subsystem (`src/shared/contracts/storage.ts`)

Games live behind a provider-agnostic `StorageProvider`. The shipped implementation is `LocalFolderStorageProvider` (`src/main/storage/providers/localFolder.ts`); future cloud/HTTP providers satisfy the same interface. Concrete impls live in `src/main/storage/providers/`.

The interface (cite verbatim): `getCapabilities()`, `list(prefix?)`, `stat(key)`, `getDownloadUrl(key)`, `download(key, opts)`, `verify(localPath, expected)`, plus the save-sync surface `listSaves(gameRef)`, `uploadSave(localPath, meta)`, `downloadSave(remoteRef, destPath, opts?)`, and optional `deleteSave?(remoteRef)`. Capability flags: `supportsRanged`, `supportsHashManifest`, `supportsSaveSync`, `supportsDirectUrl`, `supportsSaveDelete`, `providerId`.

`LocalFolderStorageProvider` reports `{ supportsRanged: true, supportsHashManifest: true, supportsSaveSync: true, supportsDirectUrl: true, supportsSaveDelete: true, providerId: 'local-folder' }`. `list`/`stat` walk the directory; `stat` reads hashes from an optional sibling `manifest.json` and falls back to hashing on first access; `download` performs a ranged file copy honoring `rangeStart` + `signal`; saves live under `<root>/.saves/<gameRefKey>/`. The cache directory and root are independent settings (`storage.root`, `cache.dir`).

### `getDownloadUrl` is consumed in main only

`getDownloadUrl(key)` returns a URL (a `file://` URL for `LocalFolderStorageProvider`). This URL is consumed **only in the main process** by the download/cache fetch path - the renderer never receives it. This is required by the security posture: `file://` is forbidden in the renderer, and the CSP (`connect-src 'self'`, `img-src 'self' asset:`, `default-src 'none'`) would block any renderer use of it. A future HTTP provider may return an `https://` URL; either way the consumer is main-side only. The renderer only ever sees cached bytes via `asset://` (art) or has them launched directly (game files).

### Library ingest - the acquisition path for the on-demand catalog

`games` / `game_files` rows are created by a **library ingest** pass, not by hand. Without this there is no way to populate the on-demand catalog.

- IPC channel (part of the closed `IpcInvokeMap` catalog):

  ```ts
  'library:scan': {
    request:  { systemId: number; prefix?: string };
    response: { added: number; updated: number };
  }
  ```

- Main module `src/main/storage/ingest.ts`:
  1. Calls `StorageProvider.list(prefix)`.
  2. Maps each `RemoteEntry` (where `isDirectory === false`) to a logical `games` row and its `game_files` row(s), keyed by the opaque `RemoteEntry.key` → `game_files.storage_key` (multi-disc → multiple `game_files` sharing one `games.id`, distinguished by `disc_no`; exactly one `is_primary = 1` per game enforced by `uq_game_files_primary`). New rows start at `cache_state = 'remote'`.
  3. Calls `StorageProvider.stat(key)` to seed `game_files.size_bytes` and, when `supportsHashManifest`, the `crc32`/`md5`/`sha1` with `hash_source = 'manifest'`. When no manifest hashes exist, `hash_source` stays `none` and hashing happens `post_download`.
  4. Upserts on the opaque-byte key `game_files (game_id, storage_key)` so re-scanning is idempotent (returns `added` vs `updated`).
- Renderer trigger: a **"Scan library"** action in System settings (and Storage settings) invokes `library:scan` for the chosen system, then invalidates the `games:list` query. Ingest discovers files; it does **not** download them.

---

## 6. MetadataProvider interface & provider chain

> Anchor: `6-metadataprovider-interface--provider-chain`

Retro-focused scraping with **ScreenScraper.fr primary, TheGamesDB fallback**. Types live in `src/shared/contracts/metadata.ts` (cite verbatim): `MetadataProvider`, `MetadataResolver`, `MetadataMatch`, `NormalizedMetadata`, `MediaRef`, `MediaType`, `HashQuery`, `RateLimitState`, `ResolvedMetadata`, `MetadataProviderId` (`screenscraper | thegamesdb`), `MatchedBy` (`hash | filename | title | manual`).

- Each provider implements `searchByHash`, `searchByName`, `getGameDetails`, `getMedia`, `getRateLimitState`. Providers read credentials in-process via `getSecret()` (`screenscraper.credentials`, `thegamesdb.apiKey`) - never over IPC.
- `MetadataResolver` (`src/main/metadata/resolver.ts`) runs the chain in order: **hash match first** (CRC32/MD5/SHA1 + size via `HashQuery`), then filename/title. It records `matched_by` + `match_confidence` and exposes per-provider quota via `getQuota()`. `resolveManual(provider, providerGameId)` applies a user's explicit choice and sets `matchedBy = 'manual'`, `confidence = 1`.

---

## 7. On-demand download + cache subsystem

> Anchor: `7-on-demand-download--cache-subsystem`

Downloads are resumable/ranged, report progress, verify checksums, and land in a size-limited LRU cache.

- **Queue.** `downloads` rows track state (`queued | downloading | paused | verifying | completed | failed | canceled`), `bytes_total`, `bytes_received`, `resume_offset`, `etag`/`last_modified` (range validators), `temp_path` (the `.part` file), and `checksum_expected`/`checksum_algo`. `uq_downloads_active` keeps at most one non-terminal download per `game_file_id`. Control via `downloads:enqueue|pause|resume|cancel|list`; progress via the throttled `downloads:progress` event and terminal transitions via `downloads:stateChanged`.
- **Resume.** Branch on `ProviderCapabilities.supportsRanged`. When true, resume sends a Range request from `resume_offset`, validating with `etag`/`last_modified`; when false, downloads restart from 0.
- **Verification is mandatory when an expected checksum exists.** On download completion, if `downloads.checksum_expected`/`checksum_algo` are present (they are coupled by the `0001` CHECK so neither can be set without the other), the manager verifies the `.part` file against them **before** renaming it to the final path. Only on a passing compare is the `.part` promoted, `game_files.cache_state` set to `cached`, and `cache_entries.verified` set to `1`. A failed compare moves the download to `failed` and the file to `cache_state = 'error'`. If no expected checksum is available, the file is hashed `post_download` to populate `game_files.crc32/md5/sha1` and `verified` is set to `0`.
- **Hash sourcing - account for both.** `game_files.hash_source = 'manifest'` (seeded by `StorageProvider.stat()` at ingest) and `'post_download'` (hashed after fetch). Scraping by hash works in either case.
- **LRU cache.** `cache_entries` records every cached blob's `local_path`, `size_bytes`, `last_accessed_at`, and `pinned`. The cache dir (`cache.dir`) and limit (`cache.sizeLimitBytes`) are settings. On exceeding the limit, `cache:evict` removes least-recently-used unpinned entries (`idx_cache_entries_lru` on `(pinned, last_accessed_at)`). `cache:pin` exempts an entry. `cache:stats`/`cache:clear` round out the surface; `cache:changed` pushes updated `CacheStats`.

---

## 8. Metadata scraping subsystem

> Anchor: `8-metadata-scraping-subsystem`

- **Queue.** `scrape_jobs` (state `queued | running | succeeded | failed | canceled | no_match`, `provider_chain`, `attempts`, `last_error`). `uq_scrape_jobs_active` keeps one non-terminal job per game. The queue is **re-runnable** (retries bump `attempts`), so all writes downstream must be idempotent. Control via `scrape:enqueue`, candidates via `scrape:candidates`, manual application via `scrape:applyManual`, quota via `scrape:quota`; progress via `scrape:progress`.
- **Match precedence.** Hash first (`HashQuery`), then filename/title, recorded as `metadata.matched_by` with `match_confidence`. Raw provider payloads are cached one row per provider per game in `metadata` (`UNIQUE (game_id, provider)`).
- **Denormalization honors the manual lock.** After resolving, the worker denormalizes selected fields onto `games` (`description`, `release_date`, `genre`, `players`, `rating`) **only when `games.metadata_locked = 0`**. `scrape:applyManual` (and `MetadataResolver.resolveManual`) set `matched_by = 'manual'`, `match_confidence = 1`, and set `games.metadata_locked = 1` so a later automatic re-scrape does not silently overwrite the user's choice. Re-locking/unlocking is a user action.
- **Media caching.** `mediaCache.ts` downloads each `MediaRef` into the assets folder and indexes it in `media_assets`. It **dedupes by `(game_id, type, checksum)`**: it computes the on-disk file's sha1 (`media_assets.checksum`) **before** insert and uses `INSERT ... ON CONFLICT` against `uq_media_assets_dedupe`. Because `checksum` is the conflict target, the upsert path must always populate it (no NULL checksum on insert). Re-running a scrape therefore cannot accumulate duplicate art rows. The renderer references art via `asset://` over `media_assets.local_path`; it never sees `source_url` or raw filesystem paths.

---

## 9. Emulator launch subsystem

> Anchor: `9-emulator-launch-subsystem`

`launch:start` resolves and spawns; it never concatenates a command string.

1. Resolve the active `system_emulator` row for the game's system (`is_active = 1`, enforced by `uq_system_emulator_active`), giving the `emulator` and the per-system `launch_args_template` (`string[]`). Fall back to `emulators.default_args_template` if no per-system override.
2. Resolve the target `game_files` row (the request's `gameFileId`, else the system/game's `is_primary = 1` file).
3. Ensure the bytes are cached: the file must be `cache_state = 'cached'`. If not, trigger/await the download (see [§7](#7-on-demand-download--cache-subsystem)) before spawning.
4. Resolve placeholders **element-wise** into `resolvedArgvArray`. **`{romPath}` resolves to `cache_entries.local_path` for the row whose `cache_entries.game_file_id` equals the launched `game_files.id`.** Other tokens: `{romDir}`, `{romName}`, `{systemSlug}`, `{emulatorDir}`. Each token is substituted inside its own array element; nothing is split on spaces, hand-quoted, or concatenated.
5. Spawn:

   ```ts
   child_process.spawn(emulator.exePath, resolvedArgvArray, {
     cwd: emulator.workingDir ?? path.dirname(emulator.exePath),
   });
   ```

6. Record a `play_sessions` row (started_at, game_file_id, emulator_id) and return `{ sessionId, pid }`. On exit, capture `exit_code`/`ended_at`, roll up `games.play_count` / `last_played_at`, emit `launch:exited`, and re-run save discovery (see [§ saves]). Bump `cache_entries.last_accessed_at` for the launched file.

---

## Saves & save states (track and sync)

Saves (`savestate | memorycard | sram | other`) are tracked locally and optionally synced via the **same** `StorageProvider` abstraction (`listSaves` / `uploadSave` / `downloadSave` / `deleteSave?`, gated by `supportsSaveSync` / `supportsSaveDelete`).

- **Discovery is idempotent.** `discovery.ts` scans each system's save folders and **upserts** `saves` rows using `ON CONFLICT` against `uq_saves_identity` (`game_id, type, slot, local_path`). It runs after every `launch:exited`, so re-discovery of the same memory card/slot updates the existing row instead of inserting a duplicate. `idx_saves_system` backs the per-system folder query.
- **Sync state.** `saves.sync_state ∈ {local_only, synced, pending_upload, pending_download, conflict}`. On sync, the engine (`src/main/saves/syncEngine.ts`) lists `RemoteSave`s and compares against the locally recorded `synced_hash` and `remote_updated_at` (added in migration `0002`):
  - **conflict** := local `sha1` ≠ `synced_hash` **AND** remote `updatedAt` ≠ `remote_updated_at` (both sides changed since last sync).
  - **pending_upload** := only the local side changed.
  - **pending_download** := only the remote side changed.
  - On a successful sync, persist `remote_id` (from `RemoteSaveRef.remoteId`), set `remote_updated_at = RemoteSaveRef.updatedAt`, `synced_hash = saves.sha1`, `last_synced_at = now`, and `sync_state = 'synced'`.
- **Surface.** `saves:list`, `saves:syncGame`, `saves:syncAll`, `saves:resolveConflict` (`keep: 'local' | 'remote'`); progress via `saves:syncProgress`, terminal via `saves:syncStateChanged`. `SaveDTO` exposes `syncState`, `remoteId`, `lastSyncedAt` to the renderer; the internal `synced_hash` / `remote_updated_at` are not surfaced (the renderer does not need them).

---

## 10. Gamepad / spatial navigation architecture

> Anchor: `10-gamepad--spatial-navigation-architecture`

- Use `@noriginmedia/norigin-spatial-navigation`. Do **not** hand-roll a focus engine. Feed it Gamepad API input (poll via `navigator.getGamepads()` in a `requestAnimationFrame` loop in the renderer; debounce/repeat directional input).
- Every focusable view/component registers with `useFocusable`. A control with no focusable wrapper is a bug.
- Big Screen Mode is **fully** gamepad-navigable with on-screen button hints and **zero** mouse dependency. Desktop Mode keeps mouse + keyboard but shares the same components.

---

## 11. UI modes & shared component library

> Anchor: `11-ui-modes--shared-component-library`

- **`docs/UI-STYLE.md` is the binding visual style guide** (seamless/no-hairline rules, elevation ladder, copy-paste recipes). Read it before writing or changing ANY renderer UI; a change that violates it is wrong even if it "works".
- One component library, one data layer, two modes: **Desktop Mode** (windowed, mouse + keyboard) and **Big Screen Mode** (fullscreen, gamepad). Both choose their shell off Zustand's `mode` (`desktop | bigscreen`), seeded from `ui.defaultMode`.
- Multi-system library with per-platform entries (Xbox 360, PS3, PS2, PSP, DS, GBA, SNES, original Xbox, GameCube, Wii) plus arbitrary user-added systems. A recent-/most-played view is a baseline feature backed by `games.last_played_at` / `play_count` (denormalized) and, for a cross-game session feed, `idx_play_sessions_started`.
- **No debug/developer UI** in either mode (see [§ security posture](#security-posture-locked)).

---

## 12. Conventions for Claude Code working in this repo

- **Contracts are the source of truth.** All shared types live in `src/shared/contracts/` (`storage.ts`, `metadata.ts`, `ipc.ts`) and are imported by **both** processes. DB row mappers and IPC payloads are *derived from* these types - never redefine a DTO or enum locally. Cite table/column/channel names from [§4](#4-sqlite-schema)–[§6](#6-metadataprovider-interface--provider-chain) **verbatim**; do not invent `gameFileId` vs `game_file_id` variants or a third spelling of an enum value. (The renderer-side typed wrappers live in `src/renderer/bridge/ipc.ts` and the preload bridge in `src/preload/index.ts`; both are typed *from* `ipc.ts`'s `IpcInvokeMap` / `IpcEventMap` - there is no separate `bridge.ts` contract file.)
- **The IPC catalog is closed.** New renderer↔main communication means adding an entry to `IpcInvokeMap` (request/response) or `IpcEventMap` (push) under the `domain:action` convention, plus a validating `ipcMain.handle` / `webContents.send` and a typed wrapper in the `window.nostalgia` preload bridge. No ad-hoc `ipcRenderer` usage; no channel that isn't in the map. (`library:scan` is part of this closed catalog - see [§5](#5-storage-download-and-cache-subsystem-srcsharedcontractsstoragets).)
- **Every schema change is a migration.** Never hand-edit a live DB or mutate `schema_migrations` by hand. Add a new numbered `.sql` file under `src/main/db/migrations/` (e.g. `0002_schema_amendments.sql`), and let the runner in `src/main/db/migrate.ts` apply it inside a transaction. The highest applied `schema_migrations.version` is the live schema. Migrations are forward-only and immutable once shipped.
- **DB stays in main; reads go through TanStack Query.** `better-sqlite3` is imported **only** under `src/main/`. Renderer DB-backed reads are TanStack Query hooks wrapping `window.nostalgia` invoke calls; mutations invalidate the relevant query keys, and `IpcEventMap` events (`downloads:stateChanged`, `saves:syncStateChanged`, `cache:changed`, `launch:exited`, `scrape:progress`) drive cache invalidation. Zustand holds only UI/app state - never authoritative DB data.
- **Every new screen is gamepad-focusable.** Any view or interactive component must register with `@noriginmedia/norigin-spatial-navigation` (`useFocusable`) so Big Screen Mode can reach it. Do not hand-roll focus. A control with no focusable wrapper is a bug. Provide on-screen button hints; assume zero mouse. See [§10](#10-gamepad--spatial-navigation-architecture) and [§11](#11-ui-modes--shared-component-library).
- **Throttle progress events.** `downloads:progress` and `saves:syncProgress` are high-frequency; coalesce/throttle emission in main (downloads ~4 Hz, save sync ~10 Hz, or on meaningful `fraction` deltas) before `webContents.send`. The renderer must not re-render per byte. Terminal transitions go through the lower-frequency `downloads:stateChanged` / `saves:syncStateChanged` channels.
- **Capabilities are branched, not assumed.** Before calling save-sync or ranged-download paths, check `ProviderCapabilities` (`supportsSaveSync`, `supportsRanged`, `supportsHashManifest`, `supportsDirectUrl`, `supportsSaveDelete`). Account for **both** hash sources: `game_files.hash_source = 'manifest'` (from `StorageProvider.stat`) and `'post_download'` (hashed after fetch). See [§7](#7-on-demand-download--cache-subsystem) and [§8](#8-metadata-scraping-subsystem).
- **Secrets never leave main.** Do not add an IPC channel, log line, error message, or telemetry payload that contains a decrypted credential. `safeStorage` calls appear only in `src/main/secrets/safeStore.ts`; decryption is in-process via `getSecret()` and feeds the `MetadataProvider` implementations directly. No IPC channel returns a decrypted credential. Any IPC error payload must never carry a `settings.value` blob or decrypted text. When in doubt, redact.
- **Lint gates the dangerous primitives.** ESLint bans: `child_process.exec` / `execSync`, `spawn` with `shell: true`, string concatenation into command lines, `path.normalize` / Unicode-normalization on opaque columns, `@electron/remote`, raw `ipcRenderer` in renderer code, and `better-sqlite3` imports outside `src/main/`. A failing lint blocks merge.
