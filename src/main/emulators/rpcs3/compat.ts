// Client for the RPCS3 compatibility list (https://rpcs3.net/compatibility).
//
// The site exposes a small JSON API: ?api=v1&g=<query>, whose `results` object is keyed by
// SERIAL. Querying a serial returns every serial sharing that title's wiki entry (all the
// regional SKUs), so we look up our exact serial in the result set rather than taking the
// first hit.
//
// Ratings are cached in `compat_entries` INCLUDING misses ('Unknown'), so an uncovered
// serial does not re-hit the network on every launch. Network failure is never fatal: the
// caller falls back to the cached row, or to no reminder at all.
// MAIN PROCESS ONLY - the renderer never makes network calls (see the security posture).
import { getCompat, upsertCompat, COMPAT_STATUSES, type CompatStatus } from '../../db/repositories/compatRepo';

const PROVIDER = 'rpcs3';
const API = 'https://rpcs3.net/compatibility?api=v1&g=';
/** Re-check a cached rating after this long; the list is updated continuously. */
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const TIMEOUT_MS = 8000;

interface ApiResult {
  title?: string;
  status?: string;
  'alternative-title'?: string | null;
}

interface ApiResponse {
  return_code?: number;
  results?: Record<string, ApiResult>;
}

function normalizeStatus(raw: string | undefined): CompatStatus {
  const hit = COMPAT_STATUSES.find((s) => s.toLowerCase() === (raw ?? '').toLowerCase());
  return hit ?? 'Unknown';
}

/**
 * Returns the compatibility rating for a serial, from cache when fresh, else from the API.
 * Never throws - on any failure it returns the stale cached row, or an 'Unknown' entry.
 */
export async function getCompatibility(
  serial: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<{ status: CompatStatus; title: string | null; checkedAt: number; stale: boolean }> {
  const cached = getCompat(PROVIDER, serial);
  const fresh = cached && Date.now() - cached.checked_at < TTL_MS;
  if (cached && fresh && !opts.forceRefresh) {
    return { status: cached.status, title: cached.title, checkedAt: cached.checked_at, stale: false };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let json: ApiResponse;
    try {
      const res = await fetch(API + encodeURIComponent(serial), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`compat API ${res.status}`);
      json = (await res.json()) as ApiResponse;
    } finally {
      clearTimeout(timer);
    }

    // return_code 0 = hits, 1 = no result for the query. Anything else is an API-side error
    // and must not be cached as a definitive 'Unknown'.
    if (json.return_code !== 0 && json.return_code !== 1) throw new Error(`compat API code ${json.return_code}`);

    const hit = json.results?.[serial];
    const status = json.return_code === 0 && hit ? normalizeStatus(hit.status) : 'Unknown';
    const title = hit?.title ?? null;
    const checkedAt = Date.now();
    upsertCompat({ provider: PROVIDER, title_id: serial, status, title, checked_at: checkedAt });
    return { status, title, checkedAt, stale: false };
  } catch {
    // Offline or API trouble: prefer a stale rating over nothing, and do NOT cache a miss.
    if (cached) return { status: cached.status, title: cached.title, checkedAt: cached.checked_at, stale: true };
    return { status: 'Unknown', title: null, checkedAt: 0, stale: true };
  }
}

/** Statuses that mean the title will not simply work: worth telling the user before launch. */
export function isProblemStatus(status: CompatStatus): boolean {
  return status === 'Ingame' || status === 'Intro' || status === 'Loadable' || status === 'Nothing';
}

/** Short human-readable meaning of each rating, for the pre-launch dialog. */
export function describeStatus(status: CompatStatus): string {
  switch (status) {
    case 'Playable':
      return 'Runs start to finish with no major issues.';
    case 'Ingame':
      return 'Boots and plays, but has glitches or crashes. A custom configuration usually helps.';
    case 'Intro':
      return 'Gets past the menus but does not reach gameplay.';
    case 'Loadable':
      return 'Shows only a black screen or basic output.';
    case 'Nothing':
      return 'Does not boot at all.';
    default:
      return 'Not listed on the RPCS3 compatibility list.';
  }
}
