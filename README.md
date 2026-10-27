# Nostalgia

A Windows desktop emulation frontend (LaunchBox / Playnite class) built on Electron + React + TypeScript + Vite, with a local SQLite library, retro metadata scraping, and a gamepad-navigable big-screen mode.

## Develop

```sh
npm install      # installs deps and rebuilds better-sqlite3 for Electron (postinstall)
npm run dev      # launch the app with HMR
npm run typecheck
npm run build    # build main/preload/renderer into out/
npm run preview  # run the built app
```

`better-sqlite3` is fetched as a **prebuilt** binary for Electron's ABI (see `.npmrc` + `scripts/fetch-native.mjs`), so no local C++ toolchain is required - just Node 18+.

## Package

```sh
npm run package  # portable build -> dist/win-unpacked/Nostalgia.exe (no signing tools needed)
npm run dist     # NSIS installer + portable via electron-builder
```

`npm run dist` requires **Windows Developer Mode** (Settings → Privacy & security → For developers) or an elevated terminal - electron-builder's bundled `winCodeSign` archive contains symlinks whose extraction needs the symlink-creation privilege. The portable build (`npm run package`) has no such requirement.

## Releases & updates

```sh
npm run release  # bumps the patch version, tags vX.Y.Z, and pushes the tag
```

Pushing a `v*.*.*` tag runs `.github/workflows/release.yml`, which builds on `windows-latest` and publishes the NSIS installer, `latest.yml`, the `.blockmap`, and the portable exe to GitHub Releases (`publish` in `electron-builder.yml`).

- **Installed copies update themselves.** The NSIS install checks ~10 s after launch and every 4 hours, downloads in the background, and installs when you quit (or on **Restart to update**; that's refused while a game or download is running). Expect one UAC prompt, since the app installs per-machine. Your data in `Documents\Nostalgia` isn't touched.
- **Portable builds only notify.** The portable exe and `npm run package` can't replace themselves, so they show "Version X available" with a link to the release page.
- Updates are mandatory; there is no user setting. For development and testing only, `NOSTALGIA_DISABLE_UPDATES=1` turns the updater off (it's also off under `npm run dev` and `NOSTALGIA_SMOKE=1`).
- The release repo must be **public**: the app reads releases anonymously and never embeds a token. Optional repo secrets `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` bake the catalog credentials into release builds.

## Configure

- **Settings → IGDB**: Twitch Client ID + Secret (or set `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` in a `.env` for dev) to browse the catalog.
- **Settings → Scraping**: ScreenScraper.fr + TheGamesDB credentials to scrape art/metadata for owned files.
