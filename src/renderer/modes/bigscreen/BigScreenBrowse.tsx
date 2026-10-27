import { EmptyState } from '@renderer/components/EmptyState';
import { getPlatformTheme, consoleAccentVars } from '@renderer/theme/consoleTheme';
import { BigScreenRail } from './BigScreenRail';
import { BigScreenGrid } from './BigScreenGrid';
import type { SystemDTO } from '@shared/contracts/ipc';

/** Rail + oversized grid. The active console's accent tints the whole view. */
export function BigScreenBrowse({
  systems,
  activeSystemId,
  onPreview,
  onEnterGrid,
  onOpen,
  onOpenPorts,
}: {
  systems: SystemDTO[];
  activeSystemId: number | null;
  onPreview: (id: number) => void;
  onEnterGrid: () => void;
  onOpen: (igdbId: number) => void;
  onOpenPorts: () => void;
}) {
  const activeSlug = systems.find((s) => s.id === activeSystemId)?.slug;
  const accentVars = consoleAccentVars(getPlatformTheme(activeSlug));

  return (
    <div className="flex h-full min-h-0" style={accentVars}>
      <BigScreenRail systems={systems} activeSystemId={activeSystemId} onPreview={onPreview} onEnter={onEnterGrid} onOpenPorts={onOpenPorts} />
      {/* scroll-py: spatial-nav focus uses scrollIntoView(nearest), which otherwise
          parks the focused card's lifted/scaled edge flush against the clip edge -
          the padding keeps a margin so the top row is never clipped. */}
      <div className="min-w-0 flex-1 overflow-auto scroll-py-10">
        {activeSystemId != null ? (
          <BigScreenGrid systemId={activeSystemId} onOpen={onOpen} />
        ) : (
          <EmptyState title="Choose a system" hint="Pick a console on the left to browse its games." />
        )}
      </div>
    </div>
  );
}
