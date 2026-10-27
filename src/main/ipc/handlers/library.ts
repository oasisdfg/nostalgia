import { z } from 'zod';
import { registerInvoke } from '../registry';
import { autoLink } from '../../recomps/linker';
import { scanLibrary } from '../../storage/ingest';
import { scanSystemFolder } from '../../storage/folderScan';
import { removeGameFromLibrary, uninstallGame } from '../../storage/downloadManager';
import { listForBoxartUpgrade } from '../../db/repositories/gamesRepo';
import { getSystem } from '../../db/repositories/systemsRepo';
import { getSetting, setSetting } from '../../db/repositories/settingsRepo';
import { boxFrontAssetUrl } from '../../launchbox/enrich';
import { replaceCover, hasLaunchboxCover } from '../../metadata/mediaCache';

// Bump when the box-front picking logic changes (e.g. v2 added the Greatest-Hits
// reissue screen) so the next run re-evaluates games that were upgraded by an
// older picker instead of skipping them.
// v3: PS3 HD re-releases now prefer their Collection entry's retail scans, and a stale
// wrong-platform cover (PSP Chains of Olympus had picked up the PS3 art) re-resolves.
// v4: square PSN storefront tiles are rejected as box fronts, and the collection scan is
// only a FALLBACK - so a title with a real case scan of its own keeps it instead of
// sharing one cover with the other half of its collection.
// v5: the square-tile rejection is limited to portrait-case consoles. It had been
// discarding every US cartridge-era cover (a GBA box IS square), leaving Pokémon FireRed /
// LeafGreen / Sapphire showing their Japanese art; this also re-resolves the PSP Chains of
// Olympus cover, which v4 fixed in code but skipped because v4 was already stamped.
const BOXART_VERSION = 5;

const scanSchema = z.object({ systemId: z.number().int(), prefix: z.string().optional() });
const scanFolderSchema = z.object({ systemId: z.number().int() });
const removeSchema = z.object({ gameId: z.number().int() });

export function registerLibraryHandlers(): void {
  // A scan can bring in a game a Native Port needs - re-run auto-link afterwards.
  registerInvoke('library:scan', async (req) => {
    const p = scanSchema.parse(req);
    const result = await scanLibrary(p.systemId, p.prefix);
    void autoLink().catch(() => undefined);
    return result;
  });
  registerInvoke('library:scanFolder', async (req) => {
    const result = await scanSystemFolder(scanFolderSchema.parse(req).systemId);
    void autoLink().catch(() => undefined);
    return result;
  });
  registerInvoke('library:remove', async (req) => {
    const p = removeSchema.parse(req);
    await removeGameFromLibrary(p.gameId);
    return { ok: true as const };
  });
  registerInvoke('library:uninstall', async (req) => {
    const p = removeSchema.parse(req);
    await uninstallGame(p.gameId);
    return { ok: true as const };
  });

  // One-shot cover upgrade: replace each game's cover with the LaunchBox retail case
  // front where a match exists. Idempotent (skips games already carrying a LaunchBox
  // cover); a no-op when the LaunchBox DB isn't imported. Best-effort per game so one
  // failed image fetch never aborts the pass.
  registerInvoke('library:upgradeBoxart', async () => {
    const verRow = getSetting('library.boxartVersion');
    const current = verRow && !verRow.encrypted && typeof verRow.value === 'number' ? verRow.value : 0;
    const force = current < BOXART_VERSION; // picker changed → re-evaluate everything once
    let upgraded = 0;
    for (const g of listForBoxartUpgrade()) {
      if (!force && hasLaunchboxCover(g.id)) continue;
      const slug = getSystem(g.systemId)?.slug;
      if (!slug) continue;
      const url = await boxFrontAssetUrl(g.title, slug).catch(() => null);
      if (!url) continue;
      await replaceCover(g.id, url);
      upgraded++;
    }
    setSetting('library.boxartVersion', BOXART_VERSION);
    return { upgraded };
  });
}
