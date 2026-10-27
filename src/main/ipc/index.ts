import { shell } from 'electron';
import { z } from 'zod';
import { registerInvoke } from './registry';
import { EMULATOR_DOWNLOAD_URLS } from '@shared/contracts/emulators';
import { registerSystemsHandlers } from './handlers/systems';
import { registerEmulatorsHandlers } from './handlers/emulators';
import { registerGamesHandlers } from './handlers/games';
import { registerSettingsHandlers } from './handlers/settings';
import { registerCacheHandlers } from './handlers/cache';
import { registerLibraryHandlers } from './handlers/library';
import { registerDownloadsHandlers } from './handlers/downloads';
import { registerLaunchHandlers } from './handlers/launch';
import { registerCatalogHandlers } from './handlers/catalog';
import { registerIgdbHandlers } from './handlers/igdb';
import { registerScrapeHandlers } from './handlers/scrape';
import { registerSavesHandlers } from './handlers/saves';
import { registerWindowHandlers } from './handlers/window';
import { registerLaunchboxHandlers } from './handlers/launchbox';
import { registerSourcesHandlers } from './handlers/sources';
import { registerUpdatesHandlers } from './handlers/updates';

export interface IpcDeps {
  /** Called when the renderer completes an app:health round-trip. */
  onHealth?: () => void;
}

/** Registers all IPC handlers. */
export function registerIpc(deps: IpcDeps = {}): void {
  registerInvoke('app:health', () => {
    deps.onHealth?.();
    return { ok: true as const };
  });

  // Open a vetted external URL in the user's browser. Security: only the exact,
  // hardcoded emulator-download URLs are allowed - the renderer cannot open an
  // arbitrary URL, so this can't be abused to launch attacker-chosen links.
  const openExternalSchema = z.object({ url: z.string().url() });
  const allowed = new Set<string>(EMULATOR_DOWNLOAD_URLS);
  // Trailers (LaunchBox VideoURL) are YouTube links - allow the YouTube hosts by exact
  // host match (not an open redirect: only youtube.com/youtu.be, https only).
  const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'youtu.be', 'm.youtube.com']);
  registerInvoke('app:openExternal', async (req) => {
    const { url } = openExternalSchema.parse(req);
    let host: string | null = null;
    try {
      const u = new URL(url);
      host = u.protocol === 'https:' ? u.host : null;
    } catch {
      host = null;
    }
    if (!allowed.has(url) && !(host && YOUTUBE_HOSTS.has(host))) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });
  registerSystemsHandlers();
  registerEmulatorsHandlers();
  registerGamesHandlers();
  registerSettingsHandlers();
  registerCacheHandlers();
  registerLibraryHandlers();
  registerDownloadsHandlers();
  registerLaunchHandlers();
  registerCatalogHandlers();
  registerIgdbHandlers();
  registerScrapeHandlers();
  registerSavesHandlers();
  registerWindowHandlers();
  registerLaunchboxHandlers();
  registerSourcesHandlers();
  registerUpdatesHandlers();
}
