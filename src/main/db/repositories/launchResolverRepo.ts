import { getGame } from './gamesRepo';
import { getSystem } from './systemsRepo';
import { getFileRow, getPrimaryFileForGame } from './gameFilesRepo';
import { getActiveSystemEmulator } from './systemEmulatorRepo';
import { getEmulator } from './emulatorsRepo';

export interface LaunchContext {
  gameId: number;
  gameFileId: number;
  systemSlug: string;
  /** opaque, verbatim */
  exePath: string;
  workingDir: string | null;
  emulatorId: number;
  template: string[];
}

/**
 * Joins game -> system -> active emulator binding -> emulator and resolves the
 * target file. Throws a user-facing error when no emulator is bound or no file
 * is resolvable. Does NOT resolve the rom path (that lives on cache_entries and
 * is obtained by the launcher via ensureCached).
 */
export function resolveLaunch(gameId: number, gameFileId?: number): LaunchContext {
  const game = getGame(gameId);
  if (!game) throw new Error('Game not found.');
  const system = getSystem(game.systemId);
  if (!system) throw new Error('System not found.');

  const file = gameFileId != null ? getFileRow(gameFileId) : getPrimaryFileForGame(gameId);
  if (!file) throw new Error('No file to launch for this game.');

  const binding = getActiveSystemEmulator(game.systemId);
  if (!binding) throw new Error(`No emulator is configured for ${system.name}. Set one in Settings.`);
  const emulator = getEmulator(binding.emulatorId);
  if (!emulator) throw new Error('The configured emulator no longer exists.');

  const template = binding.launchArgsTemplate.length > 0 ? binding.launchArgsTemplate : emulator.defaultArgsTemplate;

  return {
    gameId,
    gameFileId: file.id,
    systemSlug: system.slug,
    exePath: emulator.exePath,
    workingDir: emulator.workingDir,
    emulatorId: emulator.id,
    template,
  };
}
