// Metadata provider credentials - MAIN PROCESS ONLY. Decrypted in-process via
// getSecret and fed straight into the providers; never returned to the renderer.
import { getSecret } from '../secrets/safeStore';

export interface ScreenScraperCredentials {
  devId: string;
  devPassword: string;
  ssId?: string;
  ssPassword?: string;
}

export function getScreenScraperCredentials(): ScreenScraperCredentials | null {
  const raw = getSecret('screenscraper.credentials');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ScreenScraperCredentials>;
    if (!parsed.devId || !parsed.devPassword) return null;
    return {
      devId: parsed.devId,
      devPassword: parsed.devPassword,
      ssId: parsed.ssId,
      ssPassword: parsed.ssPassword,
    };
  } catch {
    return null;
  }
}

export function getTheGamesDbApiKey(): string | null {
  const key = getSecret('thegamesdb.apiKey');
  return key && key.length > 0 ? key : null;
}

export function metadataCredentialStatus(): { screenscraper: boolean; thegamesdb: boolean } {
  return { screenscraper: !!getScreenScraperCredentials(), thegamesdb: !!getTheGamesDbApiKey() };
}
