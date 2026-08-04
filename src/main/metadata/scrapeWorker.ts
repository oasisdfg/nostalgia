import { broadcastEvent } from '../ipc/registry';
import { metadataResolver, resolveViaLaunchBox } from './resolver';
import { cacheMedia } from './mediaCache';
import { metadataCredentialStatus } from './credentials';
import { getStatus as launchboxStatus } from '../db/repositories/launchboxRepo';
import * as scrapeJobsRepo from '../db/repositories/scrapeJobsRepo';
import { upsertMetadata, denormalizeOntoGame } from '../db/repositories/metadataRepo';
import { getGame } from '../db/repositories/gamesRepo';
import { getPrimaryFileForGame, setHashes } from '../db/repositories/gameFilesRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getEntryByFile } from '../db/repositories/cacheRepo';
import { hashFile } from '../storage/hashing';
import type { HashQuery, ResolvedMetadata } from '@shared/contracts/metadata';

let running = false;

export function kickScrapeWorker(): void {
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    let job = scrapeJobsRepo.nextQueuedJob();
    while (job) {
      await processJob(job.id, job.game_id);
      job = scrapeJobsRepo.nextQueuedJob();
    }
  } finally {
    running = false;
  }
}

export async function processJob(jobId: number, gameId: number): Promise<void> {
  scrapeJobsRepo.setJobState(jobId, 'running');
  scrapeJobsRepo.bumpAttempts(jobId);
  broadcastEvent('scrape:progress', { jobId, gameId, state: 'running' });

  const creds = metadataCredentialStatus();
  const launchboxReady = launchboxStatus().gameCount > 0;
  if (!launchboxReady && !creds.screenscraper && !creds.thegamesdb) {
    const message =
      'No metadata source. Import the LaunchBox database (Settings → Scraping), or add ScreenScraper/TheGamesDB credentials.';
    scrapeJobsRepo.setJobState(jobId, 'failed', message);
    broadcastEvent('scrape:progress', { jobId, gameId, state: 'failed', message });
    return;
  }

  try {
    const game = getGame(gameId);
    const system = game ? getSystem(game.systemId) : null;
    const file = getPrimaryFileForGame(gameId);
    let resolved: ResolvedMetadata | null = null;

    // Hash-first (ScreenScraper). Hash on disk if missing and the file is cached.
    let hq: HashQuery | null = null;
    if (file) {
      if (!file.sha1 && !file.md5 && !file.crc32 && file.cache_state === 'cached') {
        const entry = getEntryByFile(file.id);
        if (entry) {
          const h = await hashFile(entry.local_path);
          setHashes(file.id, h, 'post_download');
          file.crc32 = h.crc32;
          file.md5 = h.md5;
          file.sha1 = h.sha1;
        }
      }
      if (file.crc32 || file.md5 || file.sha1) {
        hq = {
          crc32: file.crc32 ?? undefined,
          md5: file.md5 ?? undefined,
          sha1: file.sha1 ?? undefined,
          size: file.size_bytes ?? undefined,
        };
      }
    }

    const slug = system?.slug ?? '';
    // LaunchBox is PRIMARY (exact title+platform, local, no creds). If it has no entry,
    // fall back to ScreenScraper's hash match (most accurate), then the SS/TGDB name chain.
    if (game) resolved = await resolveViaLaunchBox(game.title, slug);
    if (!resolved && hq && creds.screenscraper) resolved = await metadataResolver.resolveByHash(hq, slug);
    if (!resolved && game) resolved = await metadataResolver.resolveByName(game.title, slug);

    if (!resolved) {
      scrapeJobsRepo.setJobState(jobId, 'no_match');
      broadcastEvent('scrape:progress', { jobId, gameId, state: 'no_match' });
      return;
    }

    upsertMetadata({
      gameId,
      provider: resolved.match.provider,
      providerGameId: resolved.match.providerGameId,
      matchedBy: resolved.match.matchedBy,
      matchConfidence: resolved.match.confidence,
      raw: resolved.details,
    });
    denormalizeOntoGame(gameId, resolved.details); // honors metadata_locked
    await cacheMedia(gameId, resolved.match.provider, resolved.media);

    scrapeJobsRepo.setJobState(jobId, 'succeeded');
    broadcastEvent('scrape:progress', { jobId, gameId, state: 'succeeded' });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Scrape failed.';
    scrapeJobsRepo.setJobState(jobId, 'failed', message);
    broadcastEvent('scrape:progress', { jobId, gameId, state: 'failed', message });
  }
}
