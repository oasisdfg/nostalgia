import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { join, normalize, sep, extname } from 'node:path';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

/** Must be called BEFORE app `ready`. */
export function registerAssetSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'asset',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
    },
  ]);
}

export interface AssetRoots {
  assets: string;
  cache: string;
}

/**
 * Serves local images/media to the renderer through `asset://`, so opaque
 * on-disk paths stay in main and the renderer never gets `file://` disk access.
 * `asset://assets/<rel>` -> assets folder; `asset://cache/<rel>` -> cache dir.
 * Read-only, with path-traversal containment.
 */
export function registerAssetProtocol(roots: AssetRoots): void {
  protocol.handle('asset', async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('bad request', { status: 400 });
    }

    const root = url.host === 'assets' ? roots.assets : url.host === 'cache' ? roots.cache : null;
    if (!root) return new Response('unknown asset root', { status: 404 });

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = normalize(join(root, rel));

    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    if (target !== root && !target.startsWith(rootWithSep)) {
      return new Response('forbidden', { status: 403 });
    }

    try {
      const data = await readFile(target);
      return new Response(new Uint8Array(data), { headers: { 'content-type': mimeFor(target) } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}
