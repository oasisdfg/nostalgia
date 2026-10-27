// Build-time constants injected by electron.vite.config.ts's `define` (MAIN bundle only).
// Empty string when the repo-root .env is absent at build time.
declare const __BAKED_IGDB_CLIENT_ID__: string;
declare const __BAKED_IGDB_CLIENT_SECRET__: string;
// electron-builder.yml `publish.owner` / `publish.repo` (the auto-update feed).
declare const __UPDATE_OWNER__: string;
declare const __UPDATE_REPO__: string;
