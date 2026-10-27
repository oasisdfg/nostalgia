import { Boxes } from 'lucide-react';
import { FocusSection, Focusable } from '@renderer/components/Focusable';
import { ConsoleLogo } from '@renderer/components/SystemIcon';
import { RailUpdatePill } from '@renderer/components/UpdatePill';
import type { SystemDTO } from '@shared/contracts/ipc';

/**
 * Vertical system rail - icon-only (the header shows the active console's name).
 * Focusing an item previews it (sets the active system so the grid updates);
 * selecting (A) dives into the grid. Bumpers also cycle systems. State reads from
 * the pill fill alone (active = accent tint, focused = surface step) - no rings.
 */
export function BigScreenRail({
  systems,
  activeSystemId,
  onPreview,
  onEnter,
  onOpenPorts,
}: {
  systems: SystemDTO[];
  activeSystemId: number | null;
  onPreview: (id: number) => void;
  onEnter: () => void;
  onOpenPorts: () => void;
}) {
  return (
    <FocusSection
      focusKey="bs-rail"
      className="flex w-32 shrink-0 flex-col gap-1 overflow-auto p-3"
    >
      {systems.map((s) => (
        <Focusable
          key={s.id}
          focusKey={`bs-rail-${s.id}`}
          ariaLabel={s.name}
          focusClassName=""
          className="rounded-lg"
          onFocusChange={(f) => {
            if (f) onPreview(s.id);
          }}
          onSelect={() => {
            onPreview(s.id); // click/A selects the system (focus-move already previews for d-pad)
            onEnter();
          }}
        >
          {(focused) => (
            <div
              title={s.name}
              className={`flex items-center justify-center rounded-lg py-3 transition-colors ${
                s.id === activeSystemId
                  ? 'bg-accent/15'
                  : focused
                    ? 'bg-surface-2'
                    : ''
              }`}
            >
              <ConsoleLogo slug={s.slug} size="rail" className={s.id === activeSystemId ? 'text-accent' : 'text-fg-muted'} />
            </div>
          )}
        </Focusable>
      ))}
      {/* Native Ports - PC ports of console games, after the consoles. */}
      <Focusable focusKey="bs-rail-ports" ariaLabel="Native Ports" focusClassName="" className="rounded-lg" onSelect={onOpenPorts}>
        {(focused) => (
          <div
            title="Native Ports"
            className={`flex flex-col items-center justify-center gap-1 rounded-lg py-3 transition-colors ${
              focused ? 'bg-surface-2 text-fg' : 'text-fg-muted'
            }`}
          >
            <Boxes className="h-7 w-7" />
            <span className="text-2xs font-medium">Ports</span>
          </div>
        )}
      </Focusable>
      {/* App self-update - only present when there's something to act on. */}
      <RailUpdatePill />
    </FocusSection>
  );
}
