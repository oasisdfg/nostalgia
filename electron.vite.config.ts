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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: bakedEnv(),
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
