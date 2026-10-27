# Nostalgia

A Windows desktop emulation frontend (LaunchBox / Playnite class) built on Electron + React + TypeScript + Vite, with a local SQLite library, retro metadata scraping, and a gamepad-navigable big-screen mode.

See [CLAUDE.md](./CLAUDE.md) for the architecture and [BUILD_PLAN.md](./BUILD_PLAN.md) for the phased build.

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

## Configure

- **Settings → IGDB**: Twitch Client ID + Secret (or set `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` in a `.env` for dev) to browse the catalog.
- **Settings → Scraping**: ScreenScraper.fr + TheGamesDB credentials to scrape art/metadata for owned files.
