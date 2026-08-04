import { z } from 'zod';
import { registerInvoke } from '../registry';
import { enqueueScrapeJob } from '../../db/repositories/scrapeJobsRepo';
import { kickScrapeWorker } from '../../metadata/scrapeWorker';
import { metadataResolver, searchCandidates } from '../../metadata/resolver';
import { upsertMetadata, denormalizeOntoGame, setMetadataLocked } from '../../db/repositories/metadataRepo';
import { cacheMedia } from '../../metadata/mediaCache';
import { getGame } from '../../db/repositories/gamesRepo';
import { getSystem } from '../../db/repositories/systemsRepo';
import type { MetadataMatch } from '@shared/contracts/metadata';

const idSchema = z.object({ gameId: z.number().int() });
const manualSchema = z.object({
  gameId: z.number().int(),
  provider: z.enum(['screenscraper', 'thegamesdb']),
  providerGameId: z.string(),
});

export function registerScrapeHandlers(): void {
  registerInvoke('scrape:enqueue', (req) => {
    const { gameId } = idSchema.parse(req);
    const jobId = enqueueScrapeJob(gameId, metadataResolver.chain);
    kickScrapeWorker();
    return { jobId };
  });

  registerInvoke('scrape:candidates', async (req): Promise<MetadataMatch[]> => {
    const { gameId } = idSchema.parse(req);
    const game = getGame(gameId);
    if (!game) return [];
    const system = getSystem(game.systemId);
    return searchCandidates(game.title, system?.slug ?? '');
  });

  registerInvoke('scrape:applyManual', async (req) => {
    const p = manualSchema.parse(req);
    const resolved = await metadataResolver.resolveManual(p.provider, p.providerGameId);
    if (!resolved) throw new Error('Could not load the selected match.');
    upsertMetadata({
      gameId: p.gameId,
      provider: resolved.match.provider,
      providerGameId: resolved.match.providerGameId,
      matchedBy: 'manual',
      matchConfidence: 1,
      raw: resolved.details,
    });
    denormalizeOntoGame(p.gameId, resolved.details, true); // force, then pin
    setMetadataLocked(p.gameId, true);
    await cacheMedia(p.gameId, resolved.match.provider, resolved.media);
    const game = getGame(p.gameId);
    if (!game) throw new Error('Game not found after applying metadata.');
    return game;
  });

  registerInvoke('scrape:quota', () => metadataResolver.getQuota());
}
