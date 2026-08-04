import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
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
  return out;
}

let loaded = false;

/** Loads a repo-root .env (dev fallback) into process.env without overwriting existing vars. */
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const candidates = [join(process.cwd(), '.env'), join(app.getAppPath(), '.env')];
  for (const path of candidates) {
    try {
      const parsed = parseEnv(readFileSync(path, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch {
      /* no .env at this location */
    }
  }
}
