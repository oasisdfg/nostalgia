import { Check } from 'lucide-react';
import { Focusable } from './Focusable';
import { ConsoleLogo } from './SystemIcon';
import { invoke } from '@renderer/bridge/ipc';
import {
  useInstallRecomp,
  useCancelRecomp,
  useLaunchRecomp,
  useRecompProgress,
  useRecompBuildStatus,
  busyFraction,
} from '@renderer/query/useRecomps';
import { cardAction, CARD_ACTION_LABEL, isBusyPort, type CardAction } from './portsModel';
import type { RecompDTO } from '@shared/contracts/recomps';

/** Runs a card's one action. 'link' has no direct action - it opens the detail page. */
export function usePortCardAction(onOpen: (id: string) => void): (port: RecompDTO, action?: CardAction) => void {
  const install = useInstallRecomp();
  const cancel = useCancelRecomp();
  const launch = useLaunchRecomp();
  return (port, action = cardAction(port)) => {
    const id = port.manifest.id;
    switch (action) {
      case 'play':
        launch.mutate(id);
        break;
      case 'cancel':
        cancel.mutate(id);
        break;
      case 'get':
        void invoke('app:openExternal', { url: port.manifest.homepage });
        break;
      case 'install':
      case 'build':
      case 'retry':
        install.mutate(id);
        break;
      case 'link':
        onOpen(id);
        break;
    }
  };
}

/** A small ring for an in-flight install/build (pulses when there's no percentage). */
function ProgressRing({ fraction }: { fraction: number | null }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-black/70">
      <svg viewBox="0 0 18 18" className={`h-4 w-4 -rotate-90 ${fraction == null ? 'animate-pulse' : ''}`}>
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" className="stroke-white/20" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-accent transition-all"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (fraction ?? 0.25))}
        />
      </svg>
    </span>
  );
}

/**
 * A Native Port in the grid - library-card sized (190px wide, 3:4): the ORIGINAL game's box
 * art with the port name over the UI-STYLE scrim. One state glyph at most (busy ring,
 * update dot, or ready check), a Beta chip only for beta ports, and one action pill
 * revealed on hover OR spatial focus. Selecting the card opens its detail page.
 */
export function PortCard({
  port,
  coverUrl,
  onOpen,
  onFocus,
}: {
  port: RecompDTO;
  coverUrl: string | null;
  onOpen: (id: string) => void;
  onFocus?: (id: string) => void;
}) {
  const m = port.manifest;
  const busy = isBusyPort(port);
  const progress = useRecompProgress(m.id);
  const build = useRecompBuildStatus(m.id);
  const fraction = busy ? busyFraction(port, progress, build) : null;
  const action = cardAction(port);
  const act = usePortCardAction(onOpen);

  return (
    <Focusable
      ariaLabel={m.name}
      focusClassName=""
      className="group block rounded-lg"
      onSelect={() => onOpen(m.id)}
      onFocusChange={(f) => f && onFocus?.(m.id)}
    >
      {(focused) => (
        // No transform (it rasterizes the overlay text) - the accent ring marks focus.
        <div className={`relative rounded-lg ${focused ? 'ring-2 ring-accent' : ''}`}>
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black">
            {coverUrl ? (
              <img src={coverUrl} alt="" loading="lazy" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-lg bg-gradient-to-br from-surface-2 to-bg p-2.5 pb-14">
                <span className="line-clamp-4 select-none text-center text-sm font-semibold leading-snug text-fg-faint/80">
                  {m.originalTitle}
                </span>
              </div>
            )}

            {/* Seamless card edge + legibility for the name (UI-STYLE scrim recipe). */}
            <div className="pointer-events-none absolute -inset-px rounded-[13px] bg-gradient-to-t from-black/95 via-black/35 to-transparent [box-shadow:inset_0_0_4px_2px_rgb(0_0_0/0.25)]" />

            {/* One state glyph, only when there's something to say. */}
            <div className="absolute left-1.5 top-1.5">
              {busy ? (
                <ProgressRing fraction={fraction} />
              ) : port.updateAvailable ? (
                <span className="block h-2.5 w-2.5 rounded-full bg-accent" title="Update available" />
              ) : port.canPlay ? (
                <span className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-positive" title="Ready to play">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
            {m.status === 'beta' && (
              <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-2xs font-medium text-warning">
                Beta
              </span>
            )}

            <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
              {/* The one action - hover or spatial focus (the gamepad has no hover). */}
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation(); // act directly; selecting the card opens the detail
                  act(port, action);
                }}
                className={`w-full truncate rounded-full px-3 py-1 text-2xs font-semibold transition-opacity duration-150 ${
                  action === 'play' ? 'bg-accent text-accent-fg' : 'bg-white/15 text-fg backdrop-blur-sm hover:bg-white/25'
                } ${focused ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'}`}
              >
                {CARD_ACTION_LABEL[action]}
              </button>
              <div className="flex items-center gap-1.5">
                <span
                  className={`min-w-0 flex-1 truncate font-semibold text-fg ${focused ? 'text-xs' : 'text-2xs group-hover:text-xs'}`}
                >
                  {m.name}
                </span>
                <ConsoleLogo slug={m.gameFile.systemSlug} size="chip" className="text-fg-muted" />
              </div>
            </div>

            {/* Thin progress line along the bottom edge while busy. */}
            {busy && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/60">
                {fraction == null ? (
                  <div className="h-full w-full animate-pulse bg-accent/40" />
                ) : (
                  <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(fraction * 100)}%` }} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Focusable>
  );
}
