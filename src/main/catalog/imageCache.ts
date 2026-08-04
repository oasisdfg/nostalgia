import { app } from 'electron';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { ImageSize } from './igdbClient';
import { igdbImageUrl } from './igdbClient';

function igdbAssetsDir(): string {
  return join(app.getPath('userData'), 'assets', 'igdb');
}

function launchboxAssetsDir(): string {
  return join(app.getPath('userData'), 'assets', 'launchbox');
}

/**
 * Downloads a LaunchBox image (from images.launchbox-app.com/<fileName>) into the assets
 * folder once and returns an asset:// URL. `fileName` is opaque (has its own spaces/slashes),
 * so the on-disk name is a hash of it - the renderer only ever sees the asset:// URL.
 */
export async function cacheLaunchboxImage(fileName: string): Promise<string> {
  return (await cacheLaunchboxImageFile(fileName)).url;
}

/** Like cacheLaunchboxImage, but also returns the on-disk path (main-internal - for
 *  pixel inspection like the Greatest-Hits band detector; never sent to the renderer). */
export async function cacheLaunchboxImageFile(fileName: string): Promise<{ url: string; path: string }> {
  const safe = createHash('sha1').update(fileName).digest('hex').slice(0, 24) + (extname(fileName) || '.png');
  const dest = join(launchboxAssetsDir(), safe);
  const url = `asset://assets/launchbox/${encodeURIComponent(safe)}`;
  try {
    await access(dest);
    return { url, path: dest };
  } catch {
    /* not cached yet */
  }
  await mkdir(launchboxAssetsDir(), { recursive: true });
  const remote = 'https://images.launchbox-app.com/' + fileName.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(remote);
  if (!res.ok) throw new Error(`launchbox image fetch failed (HTTP ${res.status})`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return { url, path: dest };
}

/**
 * Downloads an IGDB CDN image into the assets folder (once) and returns an
 * asset:// URL. Remote images are fetched in main only; the renderer never hits
 * images.igdb.com (CSP), it only ever sees the asset:// URL.
 */
export async function cacheIgdbImage(imageId: string, size: ImageSize): Promise<string> {
  const file = `${imageId}_${size}.jpg`;
  const dest = join(igdbAssetsDir(), file);
  const url = `asset://assets/igdb/${encodeURIComponent(file)}`;
  try {
    await access(dest);
    return url;
  } catch {
    /* not cached yet */
  }
  await mkdir(igdbAssetsDir(), { recursive: true });
  const res = await fetch(igdbImageUrl(imageId, size));
  if (!res.ok) throw new Error(`image fetch failed (HTTP ${res.status})`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return url;
}
