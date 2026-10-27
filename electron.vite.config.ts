import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Build-time credential baking. The repo-root `.env` (gitignored) is read HERE and its
 * IGDB values are compiled into the MAIN bundle as string literals, so a packaged build
 * works with no Settings step and no shipped .env.
 *
 * Two rules this must keep:
 *  - `define` is applied to the `main` config ONLY. Putting these in `renderer` would ship
 *    the client secret into the page bundle, which the security posture forbids outright.
 *  - The .env stays out of git. Nothing here writes a credential into a tracked file.
 *
 * A missing .env bakes empty strings — the app then falls back to Settings / process.env
 * exactly as before, so contributors without the file still get a working build.
 *
 * NOTE: a baked secret is recoverable from the packaged app (it is a plain string in
 * out/main/index.js). That is inherent to baking; see docs on rotating the Twitch app.
 */
function bakedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let text = '';
  try {
    text = readFileSync(resolve('.env'), 'utf8');
  } catch {
    /* no .env — bake empties */
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return {
    __BAKED_IGDB_CLIENT_ID__: JSON.stringify(out.IGDB_CLIENT_ID ?? ''),
    __BAKED_IGDB_CLIENT_SECRET__: JSON.stringify(out.IGDB_CLIENT_SECRET ?? ''),
  };
}

/**
 * The auto-update publish target, read from electron-builder.yml's `publish:` block so
 * owner/repo live in exactly one place. Baked into main so it can build the release-page
 * URL and point the notify-only (hand-assembled portable) build at the feed, which has no
 * app-update.yml of its own.
 */
function publishTarget(): Record<string, string> {
  const yml = readFileSync(resolve('electron-builder.yml'), 'utf8');
  // The indented lines directly under the top-level `publish:` key.
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^publish:\s*$/.test(l));
  const block: string[] = [];
  for (let i = start + 1; start >= 0 && i < lines.length && /^\s+\S/.test(lines[i]); i++) block.push(lines[i]);
  const field = (k: string): string => {
    for (const l of block) {
      const m = /^\s+([A-Za-z]+):\s*([^\s#]+)/.exec(l);
      if (m && m[1] === k) return m[2];
    }
    return '';
  };
  return {
    __UPDATE_OWNER__: JSON.stringify(field('owner')),
    __UPDATE_REPO__: JSON.stringify(field('repo')),
  };
}

export default defineConfig({
  main: {
    // electron-updater is BUNDLED into out/main rather than left external, so the
    // hand-assembled `npm run package` build (which copies only better-sqlite3 into
    // node_modules) can still load it for its notify-only update check.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater'] })],
    define: { ...bakedEnv(), ...publishTarget() },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
        },
      },
    },
  },
});
