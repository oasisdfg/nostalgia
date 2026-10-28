import { net } from 'electron';
import type { RecompManifest } from '@shared/contracts/recomps';
import { getInstall, upsertInstall } from '../db/repositories/recompsRepo';
import { getSetting } from '../db/repositories/settingsRepo';
import { listManifests } from './registry';

// The port's GitHub release resolver. MAIN PROCESS ONLY - the renderer never sees a URL.

const STARTUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface ReleaseAsset {
  name: string;
  url: string; // browser_download_url
  size: number;
}

export interface ResolvedRelease {
  tag: string;
  assets: ReleaseAsset[];
  /** SHA256SUMS / *.sha256 sibling, when the release publishes one. */
  checksumAsset: ReleaseAsset | null;
  etag: string | null;
}

/** Tiny glob → RegExp: `*` any run, `?` one char, everything else literal. Case-insensitive. */
export function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
}

export function pickAsset(names: string[], assetMatch: string): string | null {
  const re = globToRegExp(assetMatch);
  return names.find((n) => re.test(n)) ?? null;
}

/** A tag becomes a directory name, so it must be a plain path segment. */
export function isSafeTag(tag: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(tag) && tag !== '.' && tag !== '..';
}

export class GithubError extends Error {}

interface GhRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/**
 * GET /repos/<repo>/releases/latest. With an etag, a 304 resolves to `null` (unchanged).
 * Throws GithubError with a human message on failure - never the raw response.
 */
export async function fetchLatestRelease(repo: string, etag?: string | null): Promise<ResolvedRelease | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Nostalgia',
  };
  if (etag) headers['If-None-Match'] = etag;
  let res: Response;
  try {
    res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  } catch {
    throw new GithubError("Couldn't reach GitHub.");
  }
  if (res.status === 304) return null;
  if (res.status === 403 || res.status === 429) throw new GithubError('GitHub is limiting requests. Try again later.');
  if (res.status === 404) throw new GithubError('This port has no published release.');
  if (!res.ok) throw new GithubError(`GitHub returned an error (${res.status}).`);
  const body = (await res.json()) as GhRelease;
  return toResolved(body, res.headers.get('etag'));
}

function toResolved(body: GhRelease, etag: string | null): ResolvedRelease {
  const assets: ReleaseAsset[] = body.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
  const checksumAsset =
    assets.find((a) => a.name === 'SHA256SUMS' || a.name.toLowerCase() === 'sha256sums.txt') ??
    assets.find((a) => a.name.toLowerCase().endsWith('.sha256')) ??
    null;
  return { tag: body.tag_name, assets, checksumAsset, etag };
}

/** The release's asset for a manifest (null when none matches assetMatch). */
export function assetFor(release: ResolvedRelease, manifest: RecompManifest): ReleaseAsset | null {
  if (!manifest.assetMatch) return null; // a build-from-source port has no release asset
  const name = pickAsset(
    release.assets.map((a) => a.name),
    manifest.assetMatch,
  );
  return release.assets.find((a) => a.name === name) ?? null;
}

/**
 * A build-from-source port's "version" is the newest commit on its default branch (short
 * sha). Same conditional-request rules as releases. Resolves null on 304.
 */
export async function fetchLatestCommit(repo: string, etag?: string | null): Promise<{ tag: string; etag: string | null } | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'Nostalgia' };
  if (etag) headers['If-None-Match'] = etag;
  let res: Response;
  try {
    res = await net.fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, { headers });
  } catch {
    throw new GithubError("Couldn't reach GitHub.");
  }
  if (res.status === 304) return null;
  if (res.status === 403 || res.status === 429) throw new GithubError('GitHub is limiting requests. Try again later.');
  if (!res.ok) throw new GithubError(`GitHub returned an error (${res.status}).`);
  const body = (await res.json()) as { sha: string }[];
  if (!body[0]?.sha) throw new GithubError('This port has no source code yet.');
  return { tag: body[0].sha.slice(0, 7), etag: res.headers.get('etag') };
}

/** Refreshes one port's cached latest_tag (conditional request; keeps the cache on failure). */
export async function checkPort(manifest: RecompManifest): Promise<void> {
  const row = getInstall(manifest.id);
  try {
    const etag = row?.latest_tag ? row.etag : null;
    const release = manifest.build
      ? await fetchLatestCommit(manifest.repo, etag)
      : await fetchLatestRelease(manifest.repo, etag);
    if (release) {
      upsertInstall(manifest.id, { latest_tag: release.tag, etag: release.etag, latest_checked_at: Date.now() });
    } else {
      upsertInstall(manifest.id, { latest_checked_at: Date.now() });
    }
    // Clear a stale check error, but never one left by a failed install.
    if (row?.last_error && row.state !== 'failed') upsertInstall(manifest.id, { last_error: null });
  } catch (e) {
    if (row?.state === 'failed') return;
    upsertInstall(manifest.id, { last_error: e instanceof GithubError ? e.message : "Couldn't check for updates." });
  }
}

/** Checks every port (or one), sequentially - a handful of requests, well under the limit. */
export async function checkPorts(id?: string): Promise<void> {
  for (const m of listManifests()) {
    if (id && m.id !== id) continue;
    await checkPort(m);
  }
}

/** Startup check: at most once every 6 h per port, and only when recomps.autoCheck isn't off. */
export async function checkPortsAtStartup(): Promise<void> {
  const auto = getSetting('recomps.autoCheck');
  if (auto && auto.value === false) return;
  const now = Date.now();
  for (const m of listManifests()) {
    const row = getInstall(m.id);
    if (row?.latest_checked_at && now - row.latest_checked_at < STARTUP_CHECK_INTERVAL_MS) continue;
    await checkPort(m);
  }
}
