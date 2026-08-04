# Nostalgia - BUILD_PLAN.md

A phased build plan for implementing Nostalgia against the canonical contracts. Each phase is self-contained, depends only on earlier phases, and produces complete drop-in files. Every phase opens with a **Paste-ready task** line you can hand to a coding agent verbatim, followed by Goal, Depends on, Files to deliver, Key implementation notes, and Acceptance criteria.

Global invariants every phase MUST honor:

- `better-sqlite3` runs **only** in the main process. The renderer reaches the DB exclusively through `window.nostalgia` and the channels in `IpcInvokeMap` / `IpcEventMap`.
- All filesystem paths and storage keys are stored **verbatim** as `TEXT`. Never normalize, never concatenate into a command string. Launch is always `child_process.spawn(exePath, argvArray, opts)`.
- Emulator `.exe` paths come only from the OS file dialog (`emulators:browseForExe`) and are stored as resolved absolute paths in `emulators.exe_path`.
- Secrets (`screenscraper.credentials`, `thegamesdb.apiKey`) are encrypted at rest via Electron `safeStorage`; the DB stores only the encrypted blob with `settings.encrypted = 1`. **Plaintext secrets never cross IPC** - `settings:get`/`settings:getMany` redact encrypted rows; decryption happens only in-process.
- BrowserWindow security baseline is **non-negotiable**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `webviewTag: false`, `allowRunningInsecureContent: false`, plus the typed preload. Local assets are served through a privileged `asset:` protocol - never `file://` in the renderer.
- Windows-only target. Keep launch/path code internally portable but do not author macOS `.app`-bundle or Linux launch paths. Packaging is Windows NSIS + portable via `electron-builder`.
- No developer/debug UI in shipped views.

Canonical names (table names, column names, enum values, interface names, IPC channels, settings keys, launch tokens) are cited verbatim throughout and must not drift.

### Contract additions made by this plan (closed and explicit)

The canonical contracts in Part A/B/C are authored verbatim in Phase 0 and Phase 1, with exactly the following additive deltas. These are the *only* deviations from the source-of-truth document; everything else is copied verbatim.

1. **`IpcInvokeMap` gains two channels** (added in Phase 0 alongside the verbatim catalog): `'app:health'` (a permanent health-check channel) and `'library:scan'` (the on-demand library-ingest trigger). Both are part of the closed catalog the preload validates against.
2. **Migration `0002_schema_amendments.sql`** (added in Phase 1, after the verbatim `0001_init`) adds: a UNIQUE dedupe index on `media_assets`, three sync-bookkeeping columns on `saves`, a `metadata_locked` flag on `games`, a coupling `CHECK` on `downloads`, and a global index on `play_sessions`. `0001_init` ships the canonical schema **verbatim and immutable**; all amendments live in `0002`.

Both deltas are spelled out in full where they are introduced. No phase invents a name not defined here or in the canonical contracts.

---

## Repo layout (target end-state)

```
Nostalgia/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ package.json
├─ tsconfig.json
├─ tsconfig.node.json
├─ tailwind.config.ts
├─ postcss.config.js
├─ src/
│  ├─ main/
│  │  ├─ index.ts                         # app bootstrap, orchestration
│  │  ├─ windows/createWindow.ts          # the single hardened BrowserWindow factory
│  │  ├─ protocol/asset.ts                # privileged asset: protocol (assets folder + cache dir)
│  │  ├─ security/csp.ts                   # onHeadersReceived CSP injection
│  │  ├─ ipc/
│  │  │  ├─ registry.ts                   # typed ipcMain.handle registration
│  │  │  ├─ index.ts                      # registers all handler modules
│  │  │  └─ handlers/                     # one file per domain
│  │  ├─ db/
│  │  │  ├─ connection.ts                 # open + pragmas
│  │  │  ├─ migrate.ts                    # migration runner
│  │  │  ├─ migrations/                   # 0001_init.sql, 0002_schema_amendments.sql, ...
│  │  │  ├─ seed/                         # builtinSystems.ts
│  │  │  └─ repositories/                 # typed repos, one per table-group
│  │  ├─ storage/
│  │  │  ├─ providers/localFolder.ts      # LocalFolderStorageProvider
│  │  │  ├─ index.ts                      # provider factory
│  │  │  ├─ hashing.ts                    # streaming crc32/md5/sha1
│  │  │  ├─ ingest.ts                     # StorageProvider.list()/stat() -> games/game_files
│  │  │  ├─ downloadManager.ts
│  │  │  └─ cache.ts                      # LRU accounting
│  │  ├─ metadata/
│  │  │  ├─ resolver.ts                   # MetadataResolver
│  │  │  └─ providers/                    # screenScraper.ts, theGamesDb.ts
│  │  ├─ launch/launcher.ts
│  │  ├─ saves/syncEngine.ts
│  │  └─ secrets/safeStore.ts
│  ├─ preload/
│  │  └─ index.ts                         # contextBridge -> window.nostalgia
│  ├─ renderer/
│  │  ├─ index.html
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  ├─ bridge/ipc.ts                    # typed wrappers over window.nostalgia
│  │  ├─ input/                           # gamepad + spatial-nav glue (shared by both modes)
│  │  ├─ query/                           # TanStack Query hooks
│  │  ├─ store/                           # Zustand slices
│  │  ├─ components/                      # shared component library
│  │  ├─ modes/desktop/                   # Desktop Mode views
│  │  ├─ modes/bigscreen/                 # Big Screen Mode views
│  │  └─ styles/index.css
│  └─ shared/
│     └─ contracts/                       # storage.ts, metadata.ts, ipc.ts
```

---

## Phase 0 - Scaffold

**Paste-ready task:** Scaffold the Nostalgia Electron app: electron-vite + TypeScript + React + Tailwind, a main-process `better-sqlite3` connection with a native Electron rebuild, the `src/shared/contracts/` types (storage/metadata/ipc) as the canonical source of truth, a privileged `asset:` protocol plus a strict CSP, a hardened `BrowserWindow` with a secure preload exposing a typed `window.nostalgia` bridge, and a single window that renders a Desktop/Big-Screen mode shell selected by Zustand state.

**Goal.** A runnable, type-checking Electron app: `electron-vite dev` opens a hardened window (`sandbox: true`); the main process opens a SQLite DB with correct pragmas; the renderer can call the `app:health` IPC channel through `window.nostalgia`; the `asset:` protocol and CSP are live; the contracts compile and are imported by both processes.

**Depends on.** Nothing.

**Files to deliver.**

- `package.json` - deps: `electron`, `electron-vite`, `vite`, `react`, `react-dom`, `typescript`, `better-sqlite3`, `@electron/rebuild`, `tailwindcss`, `postcss`, `autoprefixer`, `zustand`, `@tanstack/react-query`, `@noriginmedia/norigin-spatial-navigation`, `electron-builder`. Scripts: `dev` (`electron-vite dev`), `build` (`electron-vite build`), `rebuild` (`electron-rebuild -f -w better-sqlite3`), `typecheck`, `postinstall` (runs `rebuild`).
- `electron.vite.config.ts` - three-target config (`main`, `preload`, `renderer`); externalize `better-sqlite3` from the main bundle; alias `@shared` → `src/shared`, `@main` → `src/main`, `@renderer` → `src/renderer`.
- `tsconfig.json`, `tsconfig.node.json` - strict TS, path aliases `@shared/*`, `@main/*`, `@renderer/*`.
- `tailwind.config.ts`, `postcss.config.js` - Tailwind scanning `src/renderer/**/*.{ts,tsx,html}`; CSS custom-property theme tokens declared here for Phase 9 theming.
- `src/shared/contracts/storage.ts` - **verbatim** the `StorageProvider` contract block (types `HashAlgo`, `HashRef`, `ProviderCapabilities`, `RemoteEntry`, `RemoteStat`, `ProgressEvent`, `DownloadOptions`, `DownloadResult`, `GameRef`, `RemoteSave`, `SaveUploadMeta`, `RemoteSaveRef`, `StorageProvider`).
- `src/shared/contracts/metadata.ts` - **verbatim** the `MetadataProvider` contract block (`MetadataProviderId`, `MatchedBy`, `HashQuery`, `MetadataMatch`, `MediaType`, `MediaRef`, `NormalizedMetadata`, `RateLimitState`, `MetadataProvider`, `ResolvedMetadata`, `MetadataResolver`).
- `src/shared/contracts/ipc.ts` - the IPC catalog **verbatim** (all DTOs, `IpcInvokeMap`, `IpcEventMap`, helper aliases `IpcInvokeChannel`, `IpcEventChannel`, `IpcRequest<C>`, `IpcResponse<C>`, `IpcEvent<C>`), **plus exactly two additive channels** appended to `IpcInvokeMap`:

  ```ts
  // Added by BUILD_PLAN; part of the closed catalog. Everything else is Part-B-verbatim.
  'app:health':   { request: void;                                  response: { ok: true } };
  'library:scan': { request: { systemId: number; prefix?: string }; response: { added: number; updated: number } };
  ```

- `src/main/db/connection.ts` - opens `better-sqlite3` at `app.getPath('userData')/nostalgia.db`; applies pragmas verbatim: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`. Exports a singleton `getDb()`.
- `src/main/windows/createWindow.ts` - the single BrowserWindow factory. `webPreferences` is the locked baseline: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `webviewTag: false`, `allowRunningInsecureContent: false`, and `preload` pointing at the built preload. Loads the renderer entry. This factory is the only place a window is created.
- `src/main/protocol/asset.ts` - registers a privileged `asset:` scheme (`protocol.registerSchemesAsPrivileged` before `app.ready`, then `protocol.handle('asset', …)` after ready). It maps `asset://assets/<rel>` to the assets folder and `asset://cache/<rel>` to `cache.dir`, **read-only**, with path-traversal containment (resolved target must stay inside the mapped root). The renderer references all local images as `asset://…`, never `file://`.
- `src/main/security/csp.ts` - installs an `onHeadersReceived` handler on the default session injecting the strict CSP for all renderer responses: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data:; media-src 'self' asset:; font-src 'self'; connect-src 'self'`. (`'unsafe-inline'` for `style-src` is required only for Tailwind's injected styles; tighten in Phase 9 if a nonce strategy is adopted.) This CSP is live from Phase 0 so every later phase develops image/asset rendering under the final policy.
- `src/main/index.ts` - `app.whenReady` orchestration: register the `asset:` scheme (pre-ready), open DB via `getDb()`, install CSP via `csp.ts`, register `asset:` protocol handler, register IPC, then `createWindow()`.
- `src/main/ipc/registry.ts` - `registerInvoke<C extends IpcInvokeChannel>(channel, handler)` and `emitEvent<C extends IpcEventChannel>(win, channel, payload)` typed against `IpcInvokeMap`/`IpcEventMap`; registers `app:health` returning `{ ok: true }`.
- `src/preload/index.ts` - `contextBridge.exposeInMainWorld('nostalgia', …)` exposing `invoke<C>(channel, req)` and `on<C>(channel, cb)` typed via the contracts. Validates that `channel` is a member of `IpcInvokeMap`/`IpcEventMap` and rejects any other string; no raw `ipcRenderer` leaks. Works under `sandbox: true` (uses only `contextBridge` + `ipcRenderer`, both available in the sandboxed preload context).
- `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx` - React root; `QueryClientProvider`; renders mode shell.
- `src/renderer/store/uiStore.ts` - Zustand store with `mode: 'desktop' | 'bigscreen'` (default `desktop`; reads `ui.defaultMode` only from Phase 9 onward) and `setMode`.
- `src/renderer/modes/desktop/DesktopShell.tsx`, `src/renderer/modes/bigscreen/BigScreenShell.tsx` - empty-but-distinct shells (header/title bar vs. fullscreen canvas) chosen by `uiStore.mode`.
- `src/renderer/styles/index.css` - Tailwind directives + theme token `:root` defaults.
- `src/renderer/types/window.d.ts` - ambient declaration of `window.nostalgia` typed from `ipc.ts`.
- `.gitignore`, `README.md` (build/run instructions only; no debug UI).

**Key implementation notes.**

- The contracts files are copied **verbatim** from Part B; do not re-derive. The only additions are the two appended `IpcInvokeMap` channels listed above (`app:health`, `library:scan`). Both processes import from `@shared/contracts/*`.
- `sandbox: true` is mandatory and sufficient: the preload talks to main only via `contextBridge`/`ipcRenderer`, and all Node usage (including `better-sqlite3`) lives in main, so no Node built-ins are needed in the preload. Do **not** set `sandbox: false`.
- `window.nostalgia.invoke` must be generic over `IpcInvokeChannel` so `IpcRequest<C>`/`IpcResponse<C>` are enforced at call sites. `window.nostalgia.on` is generic over `IpcEventChannel` returning an unsubscribe function.
- The `asset:` protocol and CSP are foundational, not polish: they ship in Phase 0 so Phases 3–8 render images through `asset://` URLs under the real CSP and avoid late rework. `img-src 'self' asset:` means any `file://` image would be blocked - there is intentionally no `file://` path for renderer images.
- `better-sqlite3` is a native module: `postinstall` runs `@electron/rebuild` against the installed Electron ABI. Externalize it in the main Vite build so it is `require`'d at runtime, not bundled.
- Mode selection is pure Zustand UI state in Phase 0; it does not yet read `settings`.

**Acceptance criteria.**

- `npm install` completes and `better-sqlite3` is rebuilt for Electron (no ABI mismatch at runtime).
- `npm run dev` opens a window created by `createWindow.ts` with `sandbox: true` (verified via `webContents` preferences); toggling `uiStore.mode` swaps `DesktopShell` ↔ `BigScreenShell`.
- `npm run typecheck` passes with the contracts imported in both processes.
- On startup the DB file is created with WAL mode; an `app:health` `invoke` round-trips through `window.nostalgia` and returns `{ ok: true }`.
- A request to `asset://assets/<existing file>` resolves and renders; the active CSP header is present on the renderer document (`img-src 'self' asset: data:`), and a `file://` image is blocked.
- No `ipcRenderer` or `require` is reachable from renderer `window`; the preload rejects any channel not in the catalog.

---

## Phase 1 - Data layer

**Paste-ready task:** Implement Nostalgia's persistence: a `schema_migrations`-driven migration runner, the full canonical SQLite schema as migration `0001_init`, an additive `0002_schema_amendments` migration, typed main-process repositories for every table, IPC handlers for systems/emulators/games/settings/cache read paths, and TanStack Query hooks in the renderer wrapping those channels.

**Goal.** Every canonical table exists via versioned migrations; repositories perform typed CRUD returning DTO shapes from `ipc.ts`; the renderer reads/writes via TanStack Query hooks over `window.nostalgia`.

**Depends on.** Phase 0.

**Files to deliver.**

- `src/main/db/migrate.ts` - migration runner. Reads `src/main/db/migrations/*.sql` in version order, compares against `schema_migrations.version` (highest = live schema), applies pending migrations inside a transaction, inserts `(version, name, applied_at)`.
- `src/main/db/migrations/0001_init.sql` - the **entire canonical schema verbatim and immutable**: tables `schema_migrations`, `systems`, `emulators`, `system_emulator`, `games`, `game_files`, `metadata`, `media_assets`, `downloads`, `cache_entries`, `saves`, `settings`, `scrape_jobs`, `play_sessions`, plus all indexes and the partial unique indexes (`uq_system_emulator_active`, `uq_game_files_primary`, `uq_downloads_active`, `uq_scrape_jobs_active`). Once released, `0001_init` is never edited.
- `src/main/db/migrations/0002_schema_amendments.sql` - additive amendments that close schema gaps the canonical comments imply but the base DDL did not enforce. Exactly:

  ```sql
  -- media_assets dedupe: a game may have many screenshot/fanart rows, but never two
  -- identical assets of the same type. Enables INSERT ... ON CONFLICT in mediaCache.
  CREATE UNIQUE INDEX uq_media_assets_dedupe
    ON media_assets(game_id, type, checksum);

  -- saves: persist the remote state captured at last successful sync so the sync engine
  -- can do real three-way conflict detection instead of re-listing every time.
  ALTER TABLE saves ADD COLUMN remote_updated_at INTEGER; -- epoch ms of RemoteSaveRef.updatedAt at last sync
  ALTER TABLE saves ADD COLUMN synced_hash       TEXT;    -- sha1 hex that was synced

  -- games: lets a manual metadata pin survive a later automatic re-scrape.
  ALTER TABLE games ADD COLUMN metadata_locked INTEGER NOT NULL DEFAULT 0
    CHECK (metadata_locked IN (0,1));

  -- play_sessions: support a global cross-game "recently played sessions" feed.
  CREATE INDEX idx_play_sessions_started ON play_sessions(started_at);
  ```

  > **`downloads` checksum coupling.** The canonical `0001_init` allows `downloads.checksum_expected` and `downloads.checksum_algo` to be independently nullable, which would let the verify step silently no-op. SQLite cannot add a table-level `CHECK` via `ALTER TABLE`. Therefore the coupling rule - *both columns are NULL together or both NOT NULL together* - is enforced two ways: (1) the `downloadsRepo` writer asserts the invariant before any insert/update (it is the only writer of these columns), and (2) it is documented as a launch/download invariant in Phase 5. If a future `0003` rebuilds the table, add `CHECK ((checksum_expected IS NULL) = (checksum_algo IS NULL))` then.

- `src/main/db/repositories/types.ts` - internal row types + row→DTO mappers (epoch-ms numbers; `0/1` → boolean; JSON `TEXT` → `string[]`).
- `src/main/db/repositories/systemsRepo.ts` - CRUD on `systems`; ordered by `idx_systems_sort`; returns `SystemDTO`.
- `src/main/db/repositories/emulatorsRepo.ts` - CRUD on `emulators`; parses/stringifies `emulators.default_args_template`; returns `EmulatorDTO`.
- `src/main/db/repositories/systemEmulatorRepo.ts` - manages `system_emulator`; enforces single active row per system (honor `uq_system_emulator_active`); keeps `systems.default_emulator_id` in sync; returns `SystemEmulatorDTO`.
- `src/main/db/repositories/gamesRepo.ts` - `games` + `game_files` reads, `LibraryQuery` filtering/sorting/paging, `games:detail` assembling `GameDetailDTO` (game + files + media + saves); returns `GameDTO`/`GameFileDTO`.
- `src/main/db/repositories/mediaRepo.ts` - `media_assets` reads → `MediaAssetDTO`; surfaces `localPath` as an `asset://` URL (see notes).
- `src/main/db/repositories/savesRepo.ts` - `saves` reads → `SaveDTO`.
- `src/main/db/repositories/downloadsRepo.ts` - `downloads` reads → `DownloadDTO`; the sole writer of `checksum_expected`/`checksum_algo`, enforcing the both-or-neither coupling.
- `src/main/db/repositories/cacheRepo.ts` - `cache_entries` aggregation → `CacheStats`.
- `src/main/db/repositories/settingsRepo.ts` - `settings` get/set/getMany. For `encrypted=0`, JSON-parse the value. For `encrypted=1`, **never** return the stored blob or any decrypted form to the renderer: `settings:get`/`settings:getMany` return the row with `value: null` and `encrypted: true` (redacted). Decryption is wired in Phase 9 and is in-process only.
- `src/main/ipc/handlers/systems.ts` - `systems:list|get|create|update|delete|setEmulator`.
- `src/main/ipc/handlers/emulators.ts` - `emulators:list|get|create|update|delete` (browse dialog in Phase 2).
- `src/main/ipc/handlers/games.ts` - `games:list|search|detail|update|setFavorite`.
- `src/main/ipc/handlers/settings.ts` - `settings:get|set|getMany` (encrypted rows redacted on read).
- `src/main/ipc/handlers/cache.ts` - `cache:stats` (control ops in Phase 5).
- `src/main/ipc/index.ts` - calls each handler module's `register(registry)` at startup.
- `src/renderer/bridge/ipc.ts` - thin typed `invoke`/`on` wrappers over `window.nostalgia` keyed by `IpcInvokeChannel`/`IpcEventChannel`.
- `src/renderer/query/keys.ts` - query-key factory (`['systems']`, `['games', LibraryQuery]`, `['game', id]`, etc.).
- `src/renderer/query/useSystems.ts`, `useEmulators.ts`, `useGames.ts`, `useGameDetail.ts`, `useSettings.ts`, `useCacheStats.ts` - TanStack Query hooks with mutations that invalidate the right keys.
- `src/main/index.ts` *(modify)* - run `migrate()` immediately after `getDb()`, before registering handlers.

**Key implementation notes.**

- Migration runner is the **only** way schema changes ship; `0001_init` is immutable once released, and `0002_schema_amendments` is its only sibling at this phase. Future changes are new files (`0003_*.sql`). The highest applied `schema_migrations.version` is authoritative.
- Repositories are the only code that touches SQL. Booleans persist as `INTEGER` `0/1` constrained to `(0,1)`; timestamps are epoch **milliseconds**; JSON columns (`emulators.default_args_template`, `system_emulator.launch_args_template`, `scrape_jobs.provider_chain`, `settings.value`) are validated by `json_valid` at the DB and parsed/stringified at the repo boundary.
- `systemEmulatorRepo` mutations run in a transaction that clears the prior active row before inserting/activating, so `uq_system_emulator_active` never trips, and updates `systems.default_emulator_id` as the denormalized convenience pointer.
- `gamesRepo.list` maps `LibraryQuery.sort` to columns: `title`→`sort_title` (`idx_games_system_sort`), `lastPlayed`→`last_played_at` (`idx_games_last_played`), `addedAt`→`added_at`, `playCount`→`play_count`; `favorite` uses `idx_games_favorite`.
- `mediaRepo` returns `MediaAssetDTO.localPath` as an `asset://` URL derived from the on-disk `media_assets.local_path` (e.g. `asset://assets/<relative>`), so the renderer renders art under the Phase 0 CSP without `file://`.
- **Secrets redaction is a hard rule**: there is no IPC channel that returns a decrypted credential. `settingsRepo` redacts `encrypted=1` rows on every read path; only main-process code (Phase 9 `safeStore`) ever decrypts.

**Acceptance criteria.**

- Fresh DB: `migrate()` applies `0001_init` then `0002_schema_amendments`; all 14 tables, every index, the `uq_media_assets_dedupe` index, the three new `saves` columns, `games.metadata_locked`, and `idx_play_sessions_started` exist; `schema_migrations` has two rows. Re-running `migrate()` is a no-op.
- All partial/unique indexes enforce their invariants (verified by attempting a second active `system_emulator` row and a duplicate `(game_id, type, checksum)` media row → constraint errors).
- `systems:create`/`update`/`delete`, `emulators:*` CRUD, `games:list` with `LibraryQuery` paging/sorting, and `settings:set`/`get` all round-trip through `window.nostalgia` and return correct DTO shapes.
- Calling `settings:get` on an `encrypted=1` key returns `{ encrypted: true, value: null }` - the blob is never returned.
- A renderer component using `useSystems()`/`useGames()` renders live data; a mutation invalidates and refetches.
- `npm run typecheck` passes.

---

## Phase 2 - Systems & emulators settings

**Paste-ready task:** Build Nostalgia's systems and emulators configuration UI plus the OS file-dialog exe picker: CRUD for systems and emulators, per-system emulator binding with a per-system launch-argument template editor, and a one-time seed of the 10 enumerated built-in platforms.

**Goal.** A user can add/edit/remove emulators (exe path chosen only via file dialog), add/edit systems, bind one active emulator per system with a `launchArgsTemplate`, and the 10 enumerated built-in platforms exist on first run.

**Depends on.** Phases 0–1.

**Files to deliver.**

- `src/main/ipc/handlers/emulators.ts` *(modify)* - add `emulators:browseForExe`: opens `dialog.showOpenDialog` filtered to `.exe`, returns `{ exePath }` with the **resolved absolute** path verbatim, or `null` on cancel.
- `src/main/db/seed/builtinSystems.ts` - idempotent seed of the canonical built-in platforms into `systems` with `is_builtin = 1` and stable `slug`s. The enumerated console list yields **10 distinct platforms**: `xbox360` (Xbox 360, Microsoft), `ps3` (PlayStation 3, Sony), `ps2` (PlayStation 2, Sony), `psp` (PSP, Sony), `ds` (Nintendo DS, Nintendo), `gba` (Game Boy Advance, Nintendo), `snes` (SNES, Nintendo), `xbox` (Original Xbox, Microsoft), `gamecube` (GameCube, Nintendo), `wii` (Wii, Nintendo). Each row sets `name`, `short_name`, `manufacturer`, `sort_order`, `enabled = 1`, `is_builtin = 1`. Runs on startup; upserts by `slug` (never duplicates, never clobbers user edits to non-identity fields).
- `src/main/index.ts` *(modify)* - call `seedBuiltinSystems()` after `migrate()`.
- `src/renderer/modes/desktop/settings/EmulatorsSettings.tsx` - emulator list + create/edit form; "Browse…" button invokes `emulators:browseForExe` and stores the returned path read-only (never typed/edited); JSON array editor for `defaultArgsTemplate`.
- `src/renderer/modes/desktop/settings/SystemsSettings.tsx` - systems list + create/edit; toggle `enabled`; reorder `sortOrder`; per-system emulator binding picker that calls `systems:setEmulator` with `{ systemId, emulatorId, launchArgsTemplate }`.
- `src/renderer/components/forms/LaunchArgsEditor.tsx` - editor for a `string[]` template; shows available tokens `{romPath}`, `{romDir}`, `{romName}`, `{systemSlug}`, `{emulatorDir}` as insertable chips; validates JSON-array shape.
- `src/renderer/components/forms/ExePicker.tsx` - wraps `emulators:browseForExe`; displays the chosen `exePath` verbatim and read-only.
- `src/renderer/query/useEmulators.ts` *(modify)* - add `useBrowseForExe()` mutation and `useSetSystemEmulator()`.

**Key implementation notes.**

- The exe path is **never** typed or hardcoded. `ExePicker` is the only way to set `emulators.exe_path`, and the returned value is stored verbatim (may contain invisible Unicode).
- `LaunchArgsEditor` edits a JSON `string[]`; the persisted value goes to `system_emulator.launch_args_template` (per-system override) or `emulators.default_args_template` (emulator default). Tokens are inserted as discrete array elements, e.g. `["-f", "{romPath}"]` - element-wise, never concatenated.
- `systems:setEmulator` delegates to `systemEmulatorRepo`, which deactivates the prior active binding and updates `systems.default_emulator_id`.
- The seed is idempotent and must survive app restarts and user renames without creating duplicates (`systems.slug` is `UNIQUE`).
- **Platform count reconciliation (resolved):** the canonical `systems` table comment in the contracts reads "Ships with 11 named platforms," but the enumerated product list contains exactly **10** distinct consoles. This plan ships the **10** enumerated built-ins. The canonical schema comment should be corrected to "Ships with 10 named platforms" (a comment-only edit to the contracts; it changes no DDL). Arbitrary user systems are added via `systems:create`, not seeded.

**Acceptance criteria.**

- First run creates exactly 10 `systems` rows with `is_builtin = 1` and the canonical slugs; restarting does not duplicate them.
- Creating an emulator with a path picked via the dialog stores it verbatim; the field is read-only in the UI.
- Binding an emulator to a system writes one active `system_emulator` row, sets `systems.default_emulator_id`, and re-binding flips the active row without leaving two actives.
- A per-system `launchArgsTemplate` such as `["-f","{romPath}"]` persists and reloads intact as a JSON array.

---

## Phase 3 - Desktop-mode library UI

**Paste-ready task:** Build Nostalgia's Desktop Mode library: a systems navigation rail, a game grid with a detail panel, the shared component library both UI modes will reuse, a Zustand slice for active mode + focus/selection context, and full keyboard navigation (the spatial-navigation library fed by keyboard arrow/enter/escape events) - all reading through the existing TanStack Query hooks.

**Goal.** Mouse **and keyboard** browsing: pick a system, see its games in a grid, open a detail view with metadata, files, media, and saves placeholders, and drive the entire library with the keyboard alone. Components are mode-agnostic so Big Screen Mode (Phase 7) reuses them with gamepad input.

**Depends on.** Phases 0–2.

**Files to deliver.**

- `src/renderer/input/spatialNav.ts` - initializes `@noriginmedia/norigin-spatial-navigation` `init()` once (with keyboard handling enabled), and exposes a `FocusProvider` plus `useFocusable` re-exports. In Phase 3 norigin is driven by its built-in keyboard support (arrow keys move focus, Enter/Escape map to confirm/back); Phase 7 additionally feeds it gamepad events through this same module. Introducing the spatial-nav layer here (not Phase 7) is what gives Desktop Mode real keyboard navigation.
- `src/renderer/input/shortcuts.ts` - global keyboard shortcut map for Desktop Mode actions that are not pure focus movement: `/` focuses search, `f` toggles favorite on the focused game, `Enter` opens/plays the focused game, `Esc` closes the detail panel, sort cycling. Wired through React handlers, not raw DOM listeners on `window` outside React lifecycle.
- `src/renderer/store/uiStore.ts` *(modify)* - extend with `activeSystemId`, `selectedGameId`, `libraryQuery: LibraryQuery`, and a `focusContext` field (consumed by Phase 7 for button hints; populated here so keyboard/focus state has one home). Mode still `'desktop' | 'bigscreen'`.
- `src/renderer/components/Focusable.tsx` - thin wrapper applying norigin `useFocusable` to any shared component, with a consistent focus ring (theme token). Used here for `GameCard`, `SystemNav` items, and `Button` so they are keyboard-focusable in Desktop Mode and gamepad-focusable in Big Screen Mode with no logic fork.
- `src/renderer/components/GameCard.tsx` - single game tile: title, primary `box2d`/`box3d` art (from `MediaAssetDTO.localPath`, an `asset://` URL), favorite badge; mode-agnostic, wrapped in `Focusable`.
- `src/renderer/components/GameGrid.tsx` - virtualized grid of `GameCard` driven by `useGames(libraryQuery)`; focus order follows visual grid order for predictable arrow-key traversal.
- `src/renderer/components/SystemNav.tsx` - list of enabled `systems` (from `useSystems()`), keyboard/focus navigable, sets `activeSystemId`.
- `src/renderer/components/GameDetail.tsx` - renders `GameDetailDTO`: title/metadata block, `game_files` list with `cacheState`, `media_assets` gallery, `saves` list with `syncState` badges. Action buttons (Play/Download/Scrape) are stubs wired in later phases; all buttons are `Focusable` and Enter-activatable.
- `src/renderer/components/MediaGallery.tsx` - renders `MediaAssetDTO[]` grouped by `type`, images via `asset://` URLs.
- `src/renderer/components/Badge.tsx`, `Button.tsx`, `Toolbar.tsx`, `EmptyState.tsx`, `Spinner.tsx` - base component library (Tailwind, theme-token driven).
- `src/renderer/components/SearchBar.tsx` - drives `LibraryQuery.search` / `games:search`; focusable via the `/` shortcut.
- `src/renderer/modes/desktop/LibraryView.tsx` - composes `SystemNav` + `Toolbar` (search/sort/favorite filter) + `GameGrid` + `GameDetail`, all inside the `FocusProvider`.
- `src/renderer/modes/desktop/DesktopShell.tsx` *(modify)* - mount `FocusProvider`; route between `LibraryView` and the Phase 2 settings views.

**Key implementation notes.**

- All DB-backed reads go through TanStack Query hooks; no direct `invoke` from components. Sorting/filtering map to `LibraryQuery` and are pushed into `uiStore.libraryQuery`.
- **Keyboard navigation is a Phase 3 deliverable, not a Phase 7 carryover.** Do not hand-roll a focus engine: integrate `@noriginmedia/norigin-spatial-navigation` here and let its keyboard support move focus (arrows) and activate (Enter), supplemented by the `shortcuts.ts` map. Phase 7 reuses this exact integration and only adds gamepad input as an additional event source.
- `GameDetail` shows `game_files.cache_state` and `saves.sync_state` values verbatim (canonical enums) - these surfaces are live now even though their actions land in Phases 5/8.
- Components must not assume a pointer: no hover-only affordances; focus is always visible via a theme-token ring, so Phase 7's gamepad layer wraps them unchanged.
- All art renders from `asset://` URLs (Phase 0 protocol + CSP); no component constructs a `file://` URL.
- Selection (`selectedGameId`) lives in Zustand; the detail panel reads `useGameDetail(selectedGameId)`.

**Acceptance criteria.**

- The full library is navigable and actionable **with keyboard alone**: arrow keys move focus across `SystemNav`/`GameGrid`/`GameDetail`, Enter opens a game and activates buttons, `/` focuses search, `f` toggles favorite, `Esc` closes detail.
- Selecting a system filters the grid; search and sort update results via `LibraryQuery`.
- Clicking *or* keyboard-activating a card opens `GameDetail` showing metadata, files (with `cacheState`), media (rendered via `asset://`), and saves (with `syncState`).
- `EmptyState` renders for systems with no games; `Spinner` covers query loading; art loads under the strict CSP with no `file://` requests.
- Every shared component renders identically regardless of `uiStore.mode` (verified by mounting under both shells).

---

## Phase 4 - StorageProvider + library ingest + DownloadManager + cache

**Paste-ready task:** Implement Nostalgia's on-demand file backend: the `LocalFolderStorageProvider` satisfying the full `StorageProvider` contract, a library-ingest path that turns `StorageProvider.list()`/`stat()` into `games`/`game_files` rows (seeding manifest hashes), a `DownloadManager` with resumable/ranged downloads + progress events + checksum verification, and an LRU local cache with size limit and eviction. This is the only acquisition path for on-demand games and the only writer of `cache_entries`.

**Goal.** A user can scan a system's storage prefix to populate `games`/`game_files` (with `cache_state = 'remote'` and manifest hashes/sizes when available); a `remote` file can be enqueued, downloaded (resumably, with progress and checksum verification), cached under a size-limited LRU directory; cache stats and eviction are controllable. After this phase a `cache_entries` row with a real `local_path` exists for any downloaded file - which the Phase 5 launcher depends on.

**Depends on.** Phases 0–3.

**Files to deliver.**

- `src/main/storage/providers/localFolder.ts` - `LocalFolderStorageProvider implements StorageProvider`. `getCapabilities()` returns `{ supportsRanged: true, supportsHashManifest: true, supportsSaveSync: true, supportsDirectUrl: true, supportsSaveDelete: true, providerId: 'local-folder' }`. `list`/`stat` walk the `storage.root` directory; `stat` reads hashes from a sibling `manifest.json` when present (returning `RemoteStat.hashes: HashRef[]` + `sizeBytes`), else hashes on first access; `download` performs a ranged file copy honoring `DownloadOptions.rangeStart` + `signal`, emitting `onProgress`; `verify(localPath, expected)` compares a computed `HashRef`. `getDownloadUrl` returns a `file://` URL - **consumed in main only** (the DownloadManager may fetch by URL inside main); the renderer never receives it, consistent with the CSP. Save-sync methods store under `<root>/.saves/<gameRefKey>/` (used by Phase 8).
- `src/main/storage/index.ts` - provider factory keyed by the `storage.providerId` setting; reads `storage.root` from `settings`.
- `src/main/storage/hashing.ts` - streaming `crc32`/`md5`/`sha1` (lowercase hex) producing `HashRef`; shared by provider, ingest, downloads, and Phase 8.
- `src/main/storage/ingest.ts` - the on-demand catalog acquisition path. `scanLibrary(systemId, prefix?)`:
  1. resolves the active `StorageProvider`, calls `list(prefix)`,
  2. for each non-directory `RemoteEntry`, maps it to a logical `games` row (creating the game if absent, by `system_id` + derived title) and a `game_files` row keyed by the opaque `storage_key = RemoteEntry.key` (respecting `UNIQUE (game_id, storage_key)`), with `cache_state = 'remote'`,
  3. when `getCapabilities().supportsHashManifest` is true, calls `stat(key)` and persists `RemoteStat.sizeBytes` into `game_files.size_bytes` and each `RemoteStat.hashes` value into `game_files.crc32`/`md5`/`sha1` with `hash_source = 'manifest'`,
  4. sets exactly one `is_primary = 1` per game (honoring `uq_game_files_primary`),
  5. returns `{ added, updated }`.
  Multi-disc entries become multiple `game_files` rows under one game. Ingest is idempotent: re-scanning updates existing rows by `storage_key` rather than duplicating.
- `src/main/storage/cache.ts` - LRU manager over `cache_entries`: `getCachePath(cacheKey)`, `touch(cacheKey)` (updates `last_accessed_at`), `add(entry)`, `stats(): CacheStats`, `evict(targetBytes)` (evicts by `idx_cache_entries_lru` order, skipping `pinned = 1` and any file currently `downloading`), `pin(gameFileId, pinned)`. Reads `cache.dir` and `cache.sizeLimitBytes` from `settings`. Enforces the limit after each completed download.
- `src/main/storage/downloadManager.ts` - queue over the `downloads` table. `enqueue(gameFileId, priority)` inserts respecting `uq_downloads_active`, and **before the download starts** copies the matching manifest hash from `game_files` into `downloads.checksum_expected` + `downloads.checksum_algo` (preferring `sha1`, else `md5`, else `crc32`) so first-download verification has an expected value; the writer enforces the both-or-neither coupling. A worker picks by `idx_downloads_state` (`state, priority DESC, created_at`), transitions `queued → downloading → verifying → completed` (or `paused`/`failed`/`canceled`), persisting `bytes_received`, `resume_offset`, `etag`, `last_modified`, `temp_path` (`.part`). On resume, re-issues a ranged read from `resume_offset` validated by `etag`/`last_modified`. On completion: if `checksum_expected`/`checksum_algo` are present, verification is **mandatory** before the `.part` is moved to final; only on a passing compare does it move `.part` to final, write a `cache_entries` row (`game_file_id`, `cache_key = storage_key`, `local_path`, `size_bytes`, `verified = 1`), and set `game_files.cache_state = 'cached'`. On mismatch → `state = 'failed'`, `game_files.cache_state = 'error'`, `.part` discarded. It also exposes `awaitCompletion(gameFileId): Promise<void>` that resolves when that file's row reaches `completed` and rejects on `failed`/`canceled` - the single mechanism Phase 5 launch uses to block on a download (no second download path). Emits `downloads:progress` and `downloads:stateChanged`; on cache add emits `cache:changed`.
- `src/main/ipc/handlers/library.ts` - `library:scan` → `ingest.scanLibrary`.
- `src/main/ipc/handlers/downloads.ts` - `downloads:list|enqueue|pause|resume|cancel`.
- `src/main/ipc/handlers/cache.ts` *(modify)* - add `cache:evict|clear|pin` (keep `cache:stats`).
- `src/renderer/query/useLibraryScan.ts` - `useLibraryScan()` mutation calling `library:scan`; invalidates `['games', …]` on success.
- `src/renderer/query/useDownloads.ts` - hooks for list/enqueue/pause/resume/cancel; subscribes to `downloads:progress` + `downloads:stateChanged` to update live state and invalidate `['game', id]`.
- `src/renderer/query/useCache.ts` - `useCacheStats()`, `useEvictCache()`, `useClearCache()`, `usePinFile()`; subscribes to `cache:changed`.
- `src/renderer/components/DownloadProgress.tsx` - per-file progress bar fed by `downloads:progress` (`ProgressEvent.fraction`/`bytesPerSecond`).
- `src/renderer/modes/desktop/settings/SystemsSettings.tsx` *(modify)* - add a "Scan library" action per system that calls `useLibraryScan({ systemId })` so a user can populate games on demand.
- `src/renderer/components/GameDetail.tsx` *(modify)* - Download button → `downloads:enqueue`; show `cacheState` transitions live.

**Key implementation notes.**

- **Ingest is the catalog's only acquisition path.** Games are not stored locally by default; `scanLibrary` is what turns the provider's `list()`/`stat()` into rows. Without it the on-demand model has no way to be populated. `library:scan` is part of the closed `IpcInvokeMap`.
- **Both hash sources are wired here.** Manifest hashes are persisted at ingest via `stat()` (`hash_source = 'manifest'`), and the matching hash is copied into `downloads.checksum_expected`/`checksum_algo` at `enqueue`. Post-download hashing for files that lacked manifest hashes happens in Phase 6 (`hash_source = 'post_download'`). This makes the "account for BOTH sources" requirement executable, and lets Phase 6 scrape by manifest hash *before* any download.
- The provider satisfies the **entire** `StorageProvider` interface; callers branch on `getCapabilities()` (e.g. only attempt ranged resume when `supportsRanged`; only read manifest hashes when `supportsHashManifest`).
- Resume bookkeeping maps directly to `downloads` columns: `resume_offset`, `etag`, `last_modified`, `temp_path`, `bytes_received`, `bytes_total`. The `uq_downloads_active` partial index guarantees one in-flight/queued/paused/verifying row per `game_file_id`.
- Checksum verification uses the canonical `checksum_algo` enum (`crc32 | md5 | sha1`). When `checksum_expected`/`checksum_algo` are both present, verification is mandatory before promoting `.part`; `cache_entries.verified` is set to 1 only on a passing compare. The `downloadsRepo` coupling guarantees these two columns are always both-set or both-null, so the verify step can never silently no-op on a half-populated pair.
- `getDownloadUrl` returns `file://` and is consumed **in main only**; the renderer never receives it. Renderer images and cached assets are reached exclusively via the `asset:` protocol from Phase 0.
- Cache writes always go through `cache_entries`; `cache.dir` and `storage.root` are **independent** settings. Eviction respects `pinned` and never evicts a file currently `downloading`.
- `DownloadResult.outcome = 'aborted'` when `signal` fires (pause/cancel); paused downloads retain `resume_offset` for later resume.

**Acceptance criteria.**

- `library:scan` on a system with a populated `storage.root` creates `games`/`game_files` rows with `cache_state = 'remote'`; when a `manifest.json` is present, `game_files.size_bytes` and `crc32`/`md5`/`sha1` are populated with `hash_source = 'manifest'`; re-scanning is idempotent (updates by `storage_key`, no duplicates).
- Enqueuing a remote file copies the manifest hash into `downloads.checksum_expected`/`checksum_algo`, downloads it with live `downloads:progress` events; pausing then resuming continues from `resume_offset` (verified by a truncated/partial `.part`).
- A successful download verifies its checksum (mandatory when expected is present), flips `game_files.cache_state` to `cached`, and creates a `cache_entries` row with `verified = 1` and a real `local_path`; a corrupted file lands in `failed`/`error` with the `.part` discarded.
- `cache:stats` reports correct `totalBytes`/`limitBytes`/`entryCount`/`pinnedBytes`; exceeding `cache.sizeLimitBytes` triggers LRU eviction that skips pinned and downloading entries.

---

## Phase 5 - Launch subsystem

**Paste-ready task:** Implement Nostalgia's game launcher: ensure the primary file is cached (downloading if needed via the Phase 4 DownloadManager), resolve the active per-system emulator, substitute launch tokens element-wise into the argv array, spawn the emulator via `child_process.spawn` with an argv array (never a concatenated string), record a `play_sessions` row, and roll up `games.play_count`/`last_played_at` on exit - emitting `launch:exited` to the renderer.

**Goal.** Pressing Play on a game downloads-then-launches (or launches immediately if already cached): the launcher resolves `{romPath}` from the cached file, spawns the configured emulator with correctly substituted arguments, tracks the session, and updates play stats on exit.

**Depends on.** Phases 0–4. (Launch resolves the rom path from `cache_entries.local_path`, which only exists once Phase 4's DownloadManager has cached the file - hence launch depends on Phase 4.)

**Files to deliver.**

- `src/main/launch/tokens.ts` - pure token resolver. Given `{ romPath, emulatorDir, systemSlug }` produces values for `{romPath}`, `{romDir}` (`dirname(romPath)`), `{romName}` (`basename(romPath)`), `{systemSlug}`, `{emulatorDir}`; substitutes **per array element** over the `string[]` template. Never builds a command string. Unknown tokens are left as literal array elements (do not throw).
- `src/main/launch/launcher.ts` - the launch path:
  - `ensureCached(gameFileId): Promise<string>` - if `game_files.cache_state === 'cached'`, returns the `cache_entries.local_path` for the row whose `cache_entries.game_file_id = gameFileId`. Otherwise it `downloadManager.enqueue(gameFileId, <elevated priority>)` and `await downloadManager.awaitCompletion(gameFileId)` (the single queued row guaranteed by `uq_downloads_active`; it never opens its own download path), then reads the now-present `cache_entries.local_path`. Calls `cache.touch(cache_key)` before returning.
  - `launch(gameId, gameFileId?)` - resolves the game's primary `game_files` row (or the given `gameFileId`), resolves the active `system_emulator` binding + `emulators` row, obtains `romPath = await ensureCached(fileId)`, resolves argv via `tokens.ts`, calls `child_process.spawn(emulator.exePath, resolvedArgvArray, { cwd: emulator.workingDir ?? dirname(emulator.exePath) })`, inserts a `play_sessions` row (`started_at`, `game_file_id`, `emulator_id`), returns `{ sessionId, pid }`. On process exit, sets `play_sessions.ended_at` + `exit_code`, increments `games.play_count`, sets `games.last_played_at`, and emits `launch:exited`.
- `src/main/db/repositories/playSessionsRepo.ts` - insert/close `play_sessions`; rollup helper updating `games.play_count` and `games.last_played_at`; a `recentSessions(limit)` read backed by `idx_play_sessions_started` for a cross-game recent feed.
- `src/main/db/repositories/launchResolverRepo.ts` - read helper joining `systems` → active `system_emulator` → `emulators` and the target `game_files` row, and resolving `cache_entries.local_path` by `game_file_id`.
- `src/main/ipc/handlers/launch.ts` - `launch:start` → `launcher.launch`.
- `src/renderer/query/useLaunch.ts` - `useLaunch()` mutation calling `launch:start`; subscribes to `launch:exited` to invalidate `['game', id]` and recent/most-played views. While `ensureCached` is downloading, the existing `downloads:progress` events drive the UI.
- `src/renderer/components/GameDetail.tsx` *(modify)* - wire the Play button to `useLaunch()`; Play on a `remote` game downloads-then-launches; disable when no active emulator is bound or no primary file is resolvable.

**Key implementation notes.**

- **Launch invariant (verbatim, canonical):** `launch:start` ensures the primary file is cached, then substitutes `{romPath}` - which resolves to `cache_entries.local_path` for the row whose `cache_entries.game_file_id` equals the launched `game_files.id` - and any other placeholders into the active `system_emulator.launch_args_template` **array element-wise**, and calls `child_process.spawn(emulator.exePath, resolvedArgvArray, { cwd: workingDir ?? dirname(exePath) })`. No command string is ever concatenated. There is no `game_files.local_path` column; the on-disk path lives only on `cache_entries.local_path`.
- `ensureCached` is the **only** way launch obtains a path. It reuses the Phase 4 queue via `awaitCompletion(gameFileId)`; it never spawns a parallel download, so `uq_downloads_active` is respected and a launch that races an in-flight download simply awaits the same row.
- `emulators.exe_path`, `emulators.working_dir`, and the resolved rom path are passed to `spawn` verbatim (opaque, may contain invisible Unicode). Do not quote, escape, or `shell: true`.
- Use only the canonical tokens: `{romPath}`, `{romDir}`, `{romName}`, `{systemSlug}`, `{emulatorDir}`.
- `play_sessions` is the write source for the denormalized `games.play_count`/`last_played_at` - the rollup must run exactly once per session close. The global `idx_play_sessions_started` (from `0002`) backs a cross-game recent-sessions feed.

**Acceptance criteria.**

- Pressing Play on a `cached` game spawns the bound emulator immediately with the exact resolved argv array (verified by a stub emulator that echoes `process.argv`); a template `["-f","{romPath}"]` yields exactly `["-f", "<verbatim cache_entries.local_path>"]`. The rom path comes from `cache_entries.local_path` for the launched file - no `game_files.local_path` is referenced anywhere.
- Pressing Play on a `remote` game enqueues+awaits the download via `ensureCached` (reusing the single `uq_downloads_active` row, surfacing `downloads:progress`), then launches with the resolved path; a stub emulator confirms the argv.
- No code path constructs a command string or uses `shell: true`.
- A `play_sessions` row is created on start and closed with `ended_at`/`exit_code` on exit; `games.play_count` increments and `games.last_played_at` updates; `launch:exited` fires and the detail view refetches.
- Play is disabled when no active `system_emulator` binding exists.

---

## Phase 6 - Metadata scraping

**Paste-ready task:** Implement Nostalgia's metadata scraping: ScreenScraper.fr primary and TheGamesDB fallback behind the `MetadataProvider`/`MetadataResolver` contracts, hash-first matching (manifest hashes or post-download hashes) with filename/title fallback, an art cache writing `media_assets`, a manual-pin lock that survives re-scrapes, and a `scrape_jobs` queue with progress events.

**Goal.** A game can be scraped: matched by hash first (using manifest or post-download hashes), falling back to filename/title; normalized details land on `games` + raw payload in `metadata`; art downloads into the assets folder indexed by `media_assets`; manual matches pin via `games.metadata_locked`; quota state is surfaced.

**Depends on.** Phases 0–5.

**Files to deliver.**

- `src/main/metadata/providers/screenScraper.ts` - `implements MetadataProvider`, `id = 'screenscraper'`. `searchByHash`, `searchByName`, `getGameDetails` → `NormalizedMetadata`, `getMedia` → `MediaRef[]`, `getRateLimitState` → `RateLimitState`. Reads credentials **in-process** from `settings` key `screenscraper.credentials` via the Phase 9 `safeStore.getSecret()` (until Phase 9 lands, accepts injected creds in a constructor for testing). Credentials are never requested over IPC.
- `src/main/metadata/providers/theGamesDb.ts` - `implements MetadataProvider`, `id = 'thegamesdb'`. Same surface; reads `thegamesdb.apiKey` in-process via `safeStore`. Fallback provider.
- `src/main/metadata/resolver.ts` - `MetadataResolver` with `chain = ['screenscraper','thegamesdb']` (overridable by `scrape.defaultChain`). `resolveByHash(HashQuery, systemSlug)` and `resolveByName(title, systemSlug)` run providers in order, recording `matchedBy` + `confidence`; `resolveManual(provider, providerGameId)` sets `matchedBy = 'manual'`, `confidence = 1`; `getQuota()` aggregates `RateLimitState[]`.
- `src/main/metadata/scrapeWorker.ts` - drains `scrape_jobs` (by `idx_scrape_jobs_state`), honoring `uq_scrape_jobs_active`. Per job:
  - gather `HashQuery` from the primary `game_files` (`crc32`/`md5`/`sha1`/`size_bytes`); these may already be present from manifest ingest (`hash_source = 'manifest'`). If hashes are missing **and** the file is `cached`, hash on disk via `hashing.ts` and persist with `hash_source = 'post_download'`;
  - run resolver hash-first then name; on success upsert `metadata` (one row per provider via `UNIQUE (game_id, provider)`);
  - **honor the manual-pin lock**: if `games.metadata_locked = 1`, the worker still refreshes the per-provider `metadata` row but does **not** denormalize over `games`. Otherwise it denormalizes `description`/`release_date`/`genre`/`players`/`rating` onto `games`;
  - download art via `mediaCache`; set job `succeeded`/`no_match`/`failed`. Emits `scrape:progress`.
- `src/main/metadata/mediaCache.ts` - downloads `MediaRef` URLs into the assets folder, computes `sha1` (always - `checksum` must be non-null so the dedupe index is usable), inserts `media_assets` rows (`type`, `local_path`, `source_url`, `provider`, `width`, `height`, `checksum`) using `INSERT ... ON CONFLICT(game_id, type, checksum) DO UPDATE` against `uq_media_assets_dedupe`. Re-running a scrape never accumulates duplicate art rows; a game may still hold many distinct `screenshot`/`fanart` rows.
- `src/main/metadata/normalize.ts` - provider payload → `NormalizedMetadata`; maps provider region/genre/players/rating into canonical shapes (`rating` normalized 0..1).
- `src/main/ipc/handlers/scrape.ts` - `scrape:enqueue|candidates|applyManual|quota`. `scrape:applyManual` sets `games.metadata_locked = 1` after applying the manual match so later automatic re-scrapes do not clobber it.
- `src/main/db/repositories/metadataRepo.ts`, `scrapeJobsRepo.ts` - typed access to `metadata` and `scrape_jobs`.
- `src/renderer/query/useScrape.ts` - `useEnqueueScrape()`, `useScrapeCandidates()`, `useApplyManual()`, `useScrapeQuota()`; subscribes to `scrape:progress` to invalidate `['game', id]`.
- `src/renderer/components/ScrapeDialog.tsx` - shows `MetadataMatch[]` candidates (with `matchedBy`/`confidence`), lets the user apply a manual match via `scrape:applyManual`.
- `src/renderer/components/GameDetail.tsx` *(modify)* - Scrape button → `scrape:enqueue`; show scrape state and quota; indicate when metadata is manually locked.

**Key implementation notes.**

- Matching order is **hash-first**: build `HashQuery` from `game_files.crc32`/`md5`/`sha1`/`size_bytes`. Account for **both** sources - `hash_source = 'manifest'` (persisted at Phase 4 ingest via `StorageProvider.stat`, available pre-download) and `hash_source = 'post_download'` (computed after caching). Only fall back to filename/title (`matchedBy = 'filename' | 'title'`) when no hash match.
- **Manual pin survives re-scrape:** `games.metadata_locked` (added in `0002`) gates `games` denormalization. `resolveManual` + `scrape:applyManual` set it to 1; the worker checks it before writing denormalized fields onto `games`. Provider-level `metadata` rows may still refresh.
- **Art dedupe is DB-enforced:** `mediaCache` always computes `sha1` and upserts against `uq_media_assets_dedupe (game_id, type, checksum)`. A null `checksum` is not allowed on the insert path.
- ScreenScraper is primary, TheGamesDB is fallback; `provider` is constrained to `screenscraper | thegamesdb` on both `metadata` and `media_assets`. `metadata.raw_json` stores the provider's untouched payload (`json_valid`).
- **Credentials are read in-process only** (`safeStore.getSecret`); the providers never receive secrets over IPC, and `settings:get` never returns the decrypted credential.
- Respect `RateLimitState.blockedUntil`/`remaining`: the worker defers jobs while a provider is throttled rather than hammering it.
- Art lands in the assets folder and is surfaced to the renderer as `asset://` URLs; `media_assets.type` is constrained to the canonical `box2d | box3d | wheel | logo | marquee | screenshot | fanart | video`.

**Acceptance criteria.**

- A game with manifest hashes scrapes by hash **before** any download (the hashes were persisted at ingest); a game cached without manifest hashes hashes on disk (`hash_source = 'post_download'`) then scrapes. Both yield `matchedBy = 'hash'` when a hash match exists.
- ScreenScraper failure/no-match falls through to TheGamesDB; if neither matches, the job ends `no_match`.
- Successful scrape upserts one `metadata` row per provider, denormalizes fields onto `games` (unless `metadata_locked = 1`), and downloads art into `media_assets` with non-null `sha1` checksums; re-running the scrape produces **no** duplicate `media_assets` rows (enforced by `uq_media_assets_dedupe`).
- A manual apply sets `matchedBy = 'manual'`, `confidence = 1`, and `games.metadata_locked = 1`; a subsequent automatic re-scrape does not overwrite the manually pinned `games` fields.
- `scrape:quota` reports per-provider `RateLimitState`; `scrape:progress` drives a live refetch.

---

## Phase 7 - Big Screen Mode + gamepad navigation

**Paste-ready task:** Build Nostalgia's Big Screen Mode: fullscreen gamepad-navigable UI using the same `@noriginmedia/norigin-spatial-navigation` integration from Phase 3, now additionally fed by a Gamepad API input layer, with on-screen button hints and zero mouse dependency, reusing the shared component library.

**Goal.** A fully gamepad-driven fullscreen experience (Xbox/DS4) with directional focus navigation, button hints, and no mouse requirement - built on the same components, spatial-nav layer, and data layer as Desktop Mode.

**Depends on.** Phases 0–6.

**Files to deliver.**

- `src/renderer/input/gamepad.ts` - Gamepad API polling loop (rAF) translating axes/buttons into directional + action events (up/down/left/right, A/confirm, B/back, X/Y, shoulders, Start/Select), with debounce + analog-stick deadzone and repeat-on-hold.
- `src/renderer/input/spatialNav.ts` *(modify)* - extend the Phase 3 integration: in addition to keyboard, bridge `gamepad.ts` directional/action events into norigin focus movement. norigin still owns focus geometry; the input modules only emit directions/actions. No new focus engine.
- `src/renderer/components/ButtonHints.tsx` - on-screen legend mapping the current `uiStore.focusContext` actions to gamepad glyphs (A = Select, B = Back, Y = Scrape, X = Download, Start = Menu).
- `src/renderer/modes/bigscreen/BigScreenShell.tsx` *(modify)* - fullscreen layout; mounts the shared `FocusProvider` + the `gamepad` loop + `ButtonHints`; requests fullscreen via the Phase 0 window action.
- `src/renderer/modes/bigscreen/BigScreenLibrary.tsx` - gamepad-navigable system rail + game grid + detail using the **same** `SystemNav`/`GameGrid`/`GameDetail` already wrapped in `Focusable` from Phase 3.
- `src/renderer/modes/bigscreen/BigScreenGameView.tsx` - focused detail view with large art (via `asset://`) and gamepad-triggered Play/Download/Scrape.
- `src/renderer/store/uiStore.ts` *(modify)* - `focusContext` describes the active screen's available actions (drives `ButtonHints`); mode toggle to/from `bigscreen` enters/exits fullscreen.
- `src/main/windows/createWindow.ts` *(modify)* - expose a fullscreen toggle for Big Screen Mode (via an existing IPC/window action), keeping the security baseline unchanged.

**Key implementation notes.**

- Do **not** hand-roll a focus engine - reuse the Phase 3 `@noriginmedia/norigin-spatial-navigation` integration and add Gamepad API input as a second event source via `gamepad.ts`. norigin owns focus geometry; `gamepad.ts` only emits directions/actions.
- Zero mouse dependency: every interactive element is reachable and actionable by gamepad (and, from Phase 3, keyboard); focus is always visible. Phase 3 components are reused unchanged through `Focusable`.
- Mode comes from `uiStore.mode`; entering `bigscreen` requests fullscreen and mounts the gamepad loop; leaving tears it down (stop polling, exit fullscreen). Keyboard navigation from Phase 3 remains available in both modes.
- Button-hint mappings are data-driven from `focusContext` so each screen advertises only valid actions; glyph set covers Xbox/DS4.

**Acceptance criteria.**

- With a gamepad connected, the user can navigate systems → games → detail and trigger Play/Download/Scrape using only the controller; focus is always visible.
- `BigScreenShell` is genuinely fullscreen; toggling back to Desktop Mode exits fullscreen and stops gamepad polling.
- `ButtonHints` updates per screen to reflect the current `focusContext` actions.
- The same `GameCard`/`GameDetail` components render in both modes with no logic fork beyond the shared `Focusable` wrapper; art renders via `asset://` under the strict CSP.

---

## Phase 8 - Saves & sync

**Paste-ready task:** Implement Nostalgia's saves tracking and sync: discover per-game save states/memory cards, manage the `saves.sync_state` lifecycle through the `StorageProvider` save-sync surface using persisted remote sync state for true conflict detection, surface a conflict-resolution UI, and emit sync progress/state events.

**Goal.** Per-game saves (savestate/memorycard/sram) are tracked locally, optionally synced via the provider's save-sync methods, with a clear `sync_state` lifecycle and explicit, false-positive-free conflict resolution.

**Depends on.** Phases 0–7.

**Files to deliver.**

- `src/main/saves/discovery.ts` - locates save files per `game`/`system` (per-system save folder logic keyed by `saves.system_id`), hashes them (`crc32`/`md5`/`sha1` via `hashing.ts`), upserts `saves` rows with `type`, `slot`, `local_path` (verbatim), `size_bytes`, and initial `sync_state = 'local_only'`.
- `src/main/saves/syncEngine.ts` - drives the `sync_state` lifecycle using `StorageProvider` save-sync methods (`listSaves`, `uploadSave`, `downloadSave`, `deleteSave?`), guarded by `getCapabilities().supportsSaveSync`. Builds a `GameRef` (with primary-file `hashes`) and compares using the **persisted last-sync state** (`saves.synced_hash`, `saves.remote_updated_at`, added in `0002`):
  - local changed iff `current sha1 != saves.synced_hash`;
  - remote changed iff `RemoteSave.updatedAt != saves.remote_updated_at`;
  - **only local changed** → `pending_upload` → `uploadSave` → store `RemoteSaveRef.remoteId` in `saves.remote_id`, set `saves.synced_hash = current sha1`, `saves.remote_updated_at = RemoteSaveRef.updatedAt`, `sync_state = 'synced'`, `last_synced_at = now`;
  - **only remote changed** → `pending_download` → `downloadSave` → update local, set `synced_hash`/`remote_updated_at` to the downloaded version, `sync_state = 'synced'`;
  - **both changed** → `conflict` (no overwrite);
  - **neither changed** → no-op (the version already held). Emits `saves:syncProgress` + `saves:syncStateChanged`.
- `src/main/saves/conflictResolver.ts` - applies a user choice (`keep: 'local' | 'remote'`) for a `conflict` save: uploads local (overwrites remote) or downloads remote (overwrites local), then sets `synced` and refreshes `synced_hash`/`remote_updated_at`/`last_synced_at`.
- `src/main/ipc/handlers/saves.ts` - `saves:list|syncGame|syncAll|resolveConflict`.
- `src/main/db/repositories/savesRepo.ts` *(modify)* - add upsert + `sync_state` transitions; read/write `synced_hash`/`remote_updated_at`; query unsynced via `idx_saves_sync_state`. `SaveDTO` is unchanged (the new columns are internal to the sync engine; the renderer does not need them).
- `src/renderer/query/useSaves.ts` - `useSaves(gameId)`, `useSyncGame()`, `useSyncAll()`, `useResolveConflict()`; subscribes to `saves:syncProgress` + `saves:syncStateChanged`.
- `src/renderer/components/SavesPanel.tsx` - lists `SaveDTO` with `syncState` badges, per-save and per-game sync actions.
- `src/renderer/components/ConflictDialog.tsx` - for `sync_state = 'conflict'`, presents local vs. remote (size/updatedAt) and calls `saves:resolveConflict` with `keep`.
- `src/renderer/components/GameDetail.tsx` *(modify)* - embed `SavesPanel`.
- `src/main/launch/launcher.ts` *(modify)* - after `launch:exited`, trigger `discovery` for that game so post-play saves are picked up.

**Key implementation notes.**

- **Conflict detection is three-way and false-positive-free** thanks to the persisted last-sync state: `conflict` is raised only when local hash diverged from `synced_hash` AND remote `updatedAt` diverged from `remote_updated_at`. A simple re-list of an unchanged remote never produces a spurious conflict.
- Saves and states are both **tracked and synced** through the same provider-agnostic `StorageProvider` save-sync surface; `LocalFolderStorageProvider` stores them under `<root>/.saves/<gameRefKey>/`.
- The `sync_state` enum is canonical: `local_only | synced | pending_upload | pending_download | conflict`. `remote_id` holds the opaque `RemoteSaveRef.remoteId`; `last_synced_at`, `remote_updated_at` are epoch ms; `synced_hash` is sha1 hex.
- `saves.local_path` is opaque/verbatim; never normalized. `saves.system_id` is the denormalized key for per-system save-folder logic.
- Conflict is surfaced, never auto-resolved by overwrite; resolution is an explicit user choice via `ConflictDialog`.

**Acceptance criteria.**

- After playing, new/changed saves are discovered and appear in `SavesPanel` with `sync_state = 'local_only'`.
- `saves:syncGame` uploads only-local-changed saves (→ `synced`, with `remote_id`/`last_synced_at`/`synced_hash`/`remote_updated_at` set), downloads only-remote-changed saves, no-ops unchanged ones, and flags both-changed ones as `conflict`; re-syncing an unchanged pair produces no spurious conflict.
- `ConflictDialog` resolves a conflict per `keep: 'local' | 'remote'` and the save lands in `synced` with refreshed sync bookkeeping.
- Sync no-ops cleanly when `supportsSaveSync` is false.

---

## Phase 9 - Polish

**Paste-ready task:** Finalize Nostalgia for ship: the full settings surface (including safeStorage-encrypted ScreenScraper/TheGamesDB credentials with redacted reads), theming via CSS tokens, consistent error/empty/loading states, Windows packaging via electron-builder (NSIS + portable), and production hardening.

**Goal.** A shippable Windows build: settings cover all reserved keys (secrets encrypted at rest and never returned decrypted over IPC), the UI has consistent error/empty/loading states and theming, and `electron-builder` produces NSIS + portable artifacts.

**Depends on.** Phases 0–8.

**Files to deliver.**

- `src/main/secrets/safeStore.ts` - `encrypt(value)` / `decrypt(blob)` via Electron `safeStorage`, plus `getSecret(key)` consumed **only in-process** (by `screenScraper.ts`/`theGamesDb.ts`). `settings:set` with `encrypted: true` stores a base64 `safeStorage` blob (`settings.encrypted = 1`). **There is no IPC channel that returns a decrypted credential**: `settings:get`/`settings:getMany` continue to redact `encrypted=1` rows (`value: null`, `encrypted: true`). Decryption never crosses IPC. Applies to `screenscraper.credentials` and `thegamesdb.apiKey`.
- `src/main/db/repositories/settingsRepo.ts` *(modify)* - route encrypted writes through `safeStore.encrypt`; keep encrypted reads redacted to the renderer; expose an in-process `getSecret` used by main-side providers only.
- `src/renderer/modes/desktop/settings/SettingsView.tsx` - settings hub editing all reserved keys: `storage.root`, `storage.providerId`, `cache.dir`, `cache.sizeLimitBytes`, `screenscraper.credentials` (encrypted, write-only), `thegamesdb.apiKey` (encrypted, write-only), `ui.defaultMode` (`desktop | bigscreen`), `scrape.defaultChain`.
- `src/renderer/modes/desktop/settings/StorageSettings.tsx` - `storage.root`/`storage.providerId` + folder pickers; `cache.dir`/`cache.sizeLimitBytes` with live `cache:stats` + manual evict/clear; a "Scan library" entry point (reuses Phase 4's `library:scan`).
- `src/renderer/modes/desktop/settings/CredentialsSettings.tsx` - write-only credential entry for ScreenScraper/TheGamesDB (fields never re-display stored secrets; show "configured" state only, derived from the redacted `{ encrypted: true }` read).
- `src/renderer/modes/desktop/settings/AppearanceSettings.tsx` - theme selection + `ui.defaultMode`.
- `src/renderer/theme/tokens.css`, `src/renderer/theme/themes.ts` - CSS custom-property theme tokens + theme switching consumed by Tailwind.
- `src/renderer/components/ErrorBoundary.tsx`, `ErrorState.tsx`, `Toast.tsx` - consistent error surfaces; TanStack Query error → toast/inline.
- `src/renderer/components/EmptyState.tsx` *(modify)* - standardized empty states across library, downloads, saves, scrape.
- `src/renderer/App.tsx` *(modify)* - read `ui.defaultMode` from settings to seed `uiStore.mode`; wrap in `ErrorBoundary`.
- `electron-builder.yml` - Windows-only targets: `nsis` + `portable`; bundle native `better-sqlite3`; app metadata/icons.
- `package.json` *(modify)* - `dist` script (`electron-vite build && electron-builder --win`); ensure native rebuild precedes packaging.
- `src/main/index.ts` / `src/main/windows/createWindow.ts` *(modify)* - production hardening: single-instance lock, disable devtools in production, default-window sizing. (CSP and `asset:` protocol already ship from Phase 0; here only tighten if a nonce strategy is adopted.)

**Key implementation notes.**

- Secrets are encrypted at rest via `safeStorage`: the DB stores only the encrypted blob (`settings.value` base64, `settings.encrypted = 1`). `CredentialsSettings` is write-only; the renderer never receives decrypted secrets. Providers read them **in-process** via `safeStore.getSecret`. The redaction rule established in Phase 1 stands: no decrypted credential ever crosses IPC.
- Theming is CSS-token driven (the tokens declared in Phase 0); no hardcoded colors in components - switching themes only swaps `:root` variables.
- The strict CSP and `asset:` protocol were delivered in Phase 0 and have been live through every phase; Phase 9 does not introduce them, only optionally hardens.
- Packaging is **Windows only**: `electron-builder` `nsis` + `portable`; no macOS/Linux targets. The native module must be rebuilt for the packaged Electron before `electron-builder` runs.
- No developer/debug UI ships: devtools disabled in production, and settings expose only product surfaces.

**Acceptance criteria.**

- Entering ScreenScraper/TheGamesDB credentials stores an encrypted blob (`settings.encrypted = 1`); restarting the app, scraping still authenticates (providers decrypt in-process); `settings:get` on those keys returns `{ encrypted: true, value: null }` and the renderer never reads back the plaintext secret.
- All reserved settings keys are editable and persist; changing `cache.sizeLimitBytes` is reflected by `cache:stats` and eviction.
- Errors surface via `ErrorBoundary`/toasts; every list has an empty state; theme switching restyles the whole app via tokens.
- `npm run dist` produces working NSIS and portable Windows artifacts with `better-sqlite3` functioning in the packaged app; production build has no devtools/debug UI and a single-instance lock; the CSP header and `asset:` protocol are active in the packaged build.

---

## Cross-phase dependency summary

| Phase | Title | Depends on |
|-------|-------|-----------|
| 0 | Scaffold (window + contracts + asset: protocol + CSP) | - |
| 1 | Data layer (migrations 0001 + 0002, repos, read IPC) | 0 |
| 2 | Systems & emulators settings | 0–1 |
| 3 | Desktop-mode library UI (incl. keyboard navigation) | 0–2 |
| 4 | StorageProvider + library ingest + DownloadManager + cache | 0–3 |
| 5 | Launch subsystem (resolves `cache_entries.local_path`) | 0–4 |
| 6 | Metadata scraping | 0–5 |
| 7 | Big Screen Mode + gamepad nav | 0–6 |
| 8 | Saves & sync | 0–7 |
| 9 | Polish | 0–8 |

No phase references files or behavior introduced in a later phase. The download/cache subsystem (Phase 4) precedes launch (Phase 5) so `{romPath}` always resolves from a real `cache_entries.local_path`. Contract files (`src/shared/contracts/*`) are authored once in Phase 0 (Part-B-verbatim plus the two documented `IpcInvokeMap` additions), and the canonical schema ships in Phase 1 as immutable `0001_init` plus the additive `0002_schema_amendments`.
