// Pre-launch readiness check for PS3 titles.
//
// Answers one question: "will this game actually run well if I press Play right now?"
// Three things make the answer no, and all are things only the user can fix inside RPCS3:
//   1. the compatibility list rates it below Playable and there is no per-game config
//   2. patches exist for it in patch.yml but none are enabled
//   3. a per-game config exists in a DIFFERENT RPCS3 install than the one we launch
//
// (3) is the silent one. RPCS3 resolves config/custom_configs/config_<SERIAL>.yml relative
// to the install being run, so a config created in another copy is simply invisible - the
// game boots with default settings and no error. Worth surfacing explicitly.
//
// Everything here is advisory and best-effort: any failure yields "no reminder" and the
// launch proceeds untouched. MAIN PROCESS ONLY.
import { resolveLaunch } from '../../db/repositories/launchResolverRepo';
import { getEntryByFile } from '../../db/repositories/cacheRepo';
import { getFileRow, setTitleId } from '../../db/repositories/gameFilesRepo';
import { getGame } from '../../db/repositories/gamesRepo';
import { listEmulators } from '../../db/repositories/emulatorsRepo';
import { readPs3Serial } from '../../storage/ps3serial';
import { getCompatibility, isProblemStatus, describeStatus } from './compat';
import { hasCustomConfig, hasEnabledPatches, loadPatchedSerials, resolveRpcs3Paths } from './install';
import type { LaunchPreflight, PreflightReason } from '@shared/contracts/ipc';

const NONE: LaunchPreflight = {
  needsSetup: false,
  serial: null,
  status: 'Unknown',
  statusText: '',
  stale: false,
  hasCustomConfig: false,
  hasPatches: false,
  hasEnabledPatches: false,
  configElsewhere: null,
  reasons: [],
};

/**
 * Resolves the title's serial, preferring the value already recorded on the file row and
 * falling back to reading PARAM.SFO from the cached bytes. Deliberately does NOT trigger a
 * download: an uncached game has nothing to inspect, and spending gigabytes to render a
 * dialog would be absurd. Persists whatever it learns so later launches are instant.
 */
async function resolveSerial(gameFileId: number): Promise<string | null> {
  const file = getFileRow(gameFileId);
  if (!file) return null;
  if (file.title_id) return file.title_id;

  const entry = getEntryByFile(gameFileId);
  if (!entry) return null; // not cached yet - nothing on disk to read
  const serial = await readPs3Serial(entry.local_path);
  if (serial) setTitleId(gameFileId, serial);
  return serial;
}

/**
 * Runs the readiness check for a game. Returns a payload with `needsSetup: false` for
 * anything that is not a PS3 title, has no resolvable serial, or is already configured.
 */
export async function preflight(gameId: number, gameFileId?: number): Promise<LaunchPreflight> {
  try {
    const ctx = resolveLaunch(gameId, gameFileId);
    if (ctx.systemSlug !== 'ps3') return NONE;

    const serial = await resolveSerial(ctx.gameFileId);
    if (!serial) return NONE;

    const paths = await resolveRpcs3Paths(ctx.exePath);
    const [compat, ownConfig, patched, enabled] = await Promise.all([
      getCompatibility(serial),
      hasCustomConfig(paths, serial),
      loadPatchedSerials(paths),
      hasEnabledPatches(paths, serial),
    ]);
    const hasPatches = patched.has(serial);

    // Only look elsewhere when THIS install has no config - that is the confusing case.
    let configElsewhere: string | null = null;
    if (!ownConfig) {
      for (const emu of listEmulators()) {
        if (emu.exePath === ctx.exePath) continue;
        if (!/rpcs3/i.test(emu.exePath)) continue;
        const other = await resolveRpcs3Paths(emu.exePath);
        if (await hasCustomConfig(other, serial)) {
          configElsewhere = emu.name;
          break;
        }
      }
    }

    // `--config <path>` puts RPCS3 in config-override mode, which bypasses the per-game
    // custom config entirely. The shipped template does not pass it, but the per-system
    // launch template is user-editable, so a hand-edit could silently disable every custom
    // config with no visible error.
    const configOverridden = ctx.template.some((arg) => arg === '--config' || arg.startsWith('--config='));

    const reasons: PreflightReason[] = [];
    if (configOverridden) reasons.push('config-overridden');
    if (configElsewhere) reasons.push('config-elsewhere');
    if (isProblemStatus(compat.status) && !ownConfig) reasons.push('compat');
    if (hasPatches && !enabled) reasons.push('patches');

    // Already set up: a per-game config plus patches enabled (or none to enable) means the
    // user has done the work, so stay quiet regardless of the rating. An overridden config
    // does NOT count as set up - that is the case where the config is silently ignored.
    const configured = ownConfig && (!hasPatches || enabled) && !configOverridden;
    const dismissed = getGame(gameId)?.launchReminderDismissed === true;

    return {
      needsSetup: reasons.length > 0 && !configured && !dismissed,
      serial,
      status: compat.status,
      statusText: describeStatus(compat.status),
      stale: compat.stale,
      hasCustomConfig: ownConfig,
      hasPatches,
      hasEnabledPatches: enabled,
      configElsewhere,
      reasons,
    };
  } catch {
    return NONE; // advisory only - never let a preflight problem block a launch
  }
}
