import { z } from 'zod';
import { registerInvoke } from '../registry';
import { launch, launchEmulatorForSystem } from '../../launch/launcher';
import { preflight } from '../../emulators/rpcs3/preflight';
import { setLaunchReminderDismissed } from '../../db/repositories/gamesRepo';

const schema = z.object({ gameId: z.number().int(), gameFileId: z.number().int().optional() });
const emulatorSchema = z.object({ systemId: z.number().int() });
const gameSchema = z.object({ gameId: z.number().int() });

export function registerLaunchHandlers(): void {
  registerInvoke('launch:start', (req) => {
    const p = schema.parse(req);
    return launch(p.gameId, p.gameFileId);
  });
  registerInvoke('launch:emulator', (req) => launchEmulatorForSystem(emulatorSchema.parse(req).systemId));
  registerInvoke('launch:preflight', (req) => {
    const p = schema.parse(req);
    return preflight(p.gameId, p.gameFileId);
  });
  registerInvoke('launch:dismissReminder', (req) => setLaunchReminderDismissed(gameSchema.parse(req).gameId, true));
}
