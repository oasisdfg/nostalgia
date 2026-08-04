import { X, AlertTriangle, FolderCog, Puzzle, Info } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { useDismissReminder } from '@renderer/query/useLaunch';
import { useLaunchEmulator } from '@renderer/query/useLaunch';
import type { CompatStatus, LaunchPreflight, PreflightReason } from '@shared/contracts/ipc';

/** Rating -> accent treatment. Only 'Playable' is reassuring; the rest warrant attention. */
const STATUS_TONE: Record<CompatStatus, string> = {
  Playable: 'text-accent',
  Ingame: 'text-warning',
  Intro: 'text-warning',
  Loadable: 'text-danger',
  Nothing: 'text-danger',
  Unknown: 'text-fg-muted',
};

const REASON_ICON: Record<PreflightReason, typeof Info> = {
  compat: AlertTriangle,
  patches: Puzzle,
  'config-elsewhere': FolderCog,
  'config-overridden': FolderCog,
};

function reasonText(reason: PreflightReason, pf: LaunchPreflight): { title: string; body: string } {
  switch (reason) {
    case 'compat':
      return {
        title: `Rated "${pf.status}" on the RPCS3 compatibility list`,
        body: `${pf.statusText} Creating a custom configuration for this game in RPCS3 usually resolves it.`,
      };
    case 'patches':
      return {
        title: 'Patches are available but none are enabled',
        body: 'RPCS3 ships patches for this title (frame-rate, cutscene and rendering fixes). Enable them in RPCS3 under Manage → Game Patches.',
      };
    case 'config-elsewhere':
      return {
        title: `A custom configuration exists in "${pf.configElsewhere}"`,
        body: 'RPCS3 only reads per-game configs from the install it is running, so that configuration will be ignored here. Recreate it in this install, or point Nostalgia at that emulator instead.',
      };
    case 'config-overridden':
      return {
        title: 'Launch arguments override the per-game configuration',
        body: 'This console\'s launch arguments pass --config, which makes RPCS3 ignore per-game custom configurations. Remove it in Settings → Systems so custom configs apply again.',
      };
  }
}

/**
 * Advisory pre-launch setup reminder for PS3 titles. Purely informational - every path out
 * of it (including the close button) leaves the user able to play. See `launch:preflight`.
 */
export function LaunchPreflightDialog({
  preflight,
  gameId,
  systemId,
  onProceed,
  onClose,
}: {
  preflight: LaunchPreflight;
  gameId: number;
  systemId?: number;
  onProceed: () => void;
  onClose: () => void;
}) {
  const dismiss = useDismissReminder();
  const openEmulator = useLaunchEmulator();

  const playAndForget = (): void => {
    dismiss.mutate({ gameId });
    onProceed();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg bg-overlay shadow-e3 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h3 className="text-sm font-semibold text-fg">Before you play</h3>
          <IconButton icon={<X className="h-4 w-4" />} onClick={onClose} label="Close" />
        </div>

        <div className="space-y-4 p-4 pt-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className={`font-semibold ${STATUS_TONE[preflight.status]}`}>{preflight.status}</span>
            {preflight.serial && <span className="text-2xs text-fg-faint">{preflight.serial}</span>}
            {preflight.stale && <span className="text-2xs text-fg-faint">· cached rating</span>}
          </div>

          <div className="space-y-2.5">
            {preflight.reasons.map((reason) => {
              const Icon = REASON_ICON[reason];
              const { title, body } = reasonText(reason, preflight);
              return (
                <div key={reason} className="rounded-md bg-bg/60 shadow-inset-1 p-3">
                  <div className="flex items-start gap-2.5">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-fg">{title}</p>
                      <p className="text-2xs leading-relaxed text-fg-muted">{body}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-2xs leading-relaxed text-fg-faint">
            Set this up inside RPCS3 — right-click the game in its list to create a custom configuration. Nostalgia
            applies it automatically on the next launch.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={onProceed} focusKey="preflight-play">
              Play anyway
            </Button>
            {systemId != null && (
              <Button
                variant="secondary"
                disabled={openEmulator.isPending}
                onClick={() => openEmulator.mutate({ systemId })}
              >
                Open RPCS3
              </Button>
            )}
            <Button variant="ghost" onClick={playAndForget}>
              Don&apos;t remind me for this game
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
