import { registerInvoke, broadcastEvent } from '../registry';
import { importLaunchbox } from '../../launchbox/importer';
import { getStatus } from '../../db/repositories/launchboxRepo';

// One import at a time (it's a ~100MB download + large parse). A second call while one is
// running just reports the in-flight state rather than starting a duplicate.
let importing = false;

export function registerLaunchboxHandlers(): void {
  registerInvoke('launchbox:status', () => ({ ...getStatus(), importing }));

  registerInvoke('launchbox:import', async () => {
    if (importing) return { gameCount: getStatus().gameCount };
    importing = true;
    let lastEmit = 0;
    try {
      const count = await importLaunchbox((p) => {
        // Throttle to ~4 Hz per the progress-event convention; always send the terminal 'done'.
        const now = Date.now();
        if (p.phase !== 'done' && now - lastEmit < 250) return;
        lastEmit = now;
        broadcastEvent('launchbox:importProgress', {
          phase: p.phase,
          fraction: p.phase === 'downloading' ? (p.received ?? null) : null,
          games: p.games ?? null,
        });
      });
      return { gameCount: count };
    } finally {
      importing = false;
    }
  });
}
