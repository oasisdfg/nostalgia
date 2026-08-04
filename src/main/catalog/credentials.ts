// IGDB credential resolution - MAIN PROCESS ONLY. Never returns values to the
// renderer; never logged. Resolution order, first non-empty wins:
//   1. Settings - what the user typed (safeStorage-encrypted for the secret). A user's
//      own Twitch app must always be able to override the shipped one.
//   2. Baked-in - compiled into this bundle at build time from the repo-root .env by
//      electron.vite.config.ts, so an installed build works with no setup step.
//   3. process.env - a runtime .env, for dev without rebuilding.
import { getSecret } from '../secrets/safeStore';
import { getSetting } from '../db/repositories/settingsRepo';

// Read through a function so the `define` substitution can't be hoisted into a shared
// module-level constant that something else might later log or serialize.
const baked = {
  clientId: (): string => (typeof __BAKED_IGDB_CLIENT_ID__ === 'string' ? __BAKED_IGDB_CLIENT_ID__ : ''),
  clientSecret: (): string => (typeof __BAKED_IGDB_CLIENT_SECRET__ === 'string' ? __BAKED_IGDB_CLIENT_SECRET__ : ''),
};

export function getClientId(): string | null {
  const row = getSetting('igdb.clientId');
  const fromSettings = row && !row.encrypted && typeof row.value === 'string' ? row.value : '';
  return fromSettings || baked.clientId() || process.env.IGDB_CLIENT_ID || null;
}

export function getClientSecret(): string | null {
  const fromSecret = getSecret('igdb.clientSecret');
  return fromSecret || baked.clientSecret() || process.env.IGDB_CLIENT_SECRET || null;
}

export function hasCredentials(): { hasClientId: boolean; hasClientSecret: boolean } {
  return { hasClientId: !!getClientId(), hasClientSecret: !!getClientSecret() };
}
