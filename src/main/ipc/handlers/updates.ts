import { registerInvoke } from '../registry';
import { getUpdateStatus, checkNow, restartAndInstall, openReleasePage } from '../../updates/updater';

// All four channels take no request payload, so there is nothing to validate; none
// accepts a URL or path from the renderer.
export function registerUpdatesHandlers(): void {
  registerInvoke('updates:status', () => getUpdateStatus());
  registerInvoke('updates:check', () => checkNow());
  registerInvoke('updates:restart', () => restartAndInstall());
  registerInvoke('updates:openReleasePage', async () => {
    await openReleasePage();
    return { ok: true as const };
  });
}
