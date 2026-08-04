import { getDb } from '../connection';
import type { MetadataProviderId } from '@shared/contracts/metadata';

export type ScrapeJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'no_match';

export interface ScrapeJobRow {
  id: number;
  game_id: number;
  state: ScrapeJobState;
  provider_chain: string;
  attempts: number;
  last_error: string | null;
}

/** Enqueues (or reuses) a non-terminal job for a game. uq_scrape_jobs_active enforces one. */
export function enqueueScrapeJob(gameId: number, providerChain: MetadataProviderId[]): number {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM scrape_jobs WHERE game_id = ? AND state IN ('queued','running')")
    .get(gameId) as { id: number } | undefined;
  if (existing) return existing.id;
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO scrape_jobs (game_id, state, provider_chain, attempts, created_at, updated_at)
       VALUES (?, 'queued', ?, 0, ?, ?)`,
    )
    .run(gameId, JSON.stringify(providerChain), now, now);
  return Number(info.lastInsertRowid);
}

export function nextQueuedJob(): ScrapeJobRow | undefined {
  return getDb()
    .prepare(
      "SELECT id, game_id, state, provider_chain, attempts, last_error FROM scrape_jobs WHERE state = 'queued' ORDER BY id LIMIT 1",
    )
    .get() as ScrapeJobRow | undefined;
}

export function setJobState(id: number, state: ScrapeJobState, lastError?: string | null): void {
  getDb()
    .prepare('UPDATE scrape_jobs SET state = ?, last_error = ?, updated_at = ? WHERE id = ?')
    .run(state, lastError ?? null, Date.now(), id);
}

export function bumpAttempts(id: number): void {
  getDb().prepare('UPDATE scrape_jobs SET attempts = attempts + 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
}
