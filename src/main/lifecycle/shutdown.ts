import { closeDb } from '../db/connection';
import { shutdownAria2 } from '../storage/aria2/daemon';

let done = false;

/**
 * The app's quit-time cleanup: stop the aria2 daemon and close the DB. Shared by
 * `before-quit` and the update installer (which runs it BEFORE handing off to
 * quitAndInstall, whose own app.quit() then fires before-quit again) - so it runs once.
 */
export function shutdownOnce(): void {
  if (done) return;
  done = true;
  shutdownAria2();
  closeDb();
}
