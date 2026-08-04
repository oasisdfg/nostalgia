import { registerInvoke } from '../registry';
import { hasCredentials } from '../../catalog/credentials';
import { igdbProvider } from '../../catalog/igdbProvider';

export function registerIgdbHandlers(): void {
  registerInvoke('igdb:status', () => {
    const { hasClientId, hasClientSecret } = hasCredentials();
    return { hasClientId, hasClientSecret, configured: hasClientId && hasClientSecret };
  });
  registerInvoke('igdb:testConnection', () => igdbProvider.testConnection());
}
