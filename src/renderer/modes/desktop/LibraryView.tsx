import { Toolbar } from '@renderer/components/Toolbar';
import { LibrarySections } from '@renderer/components/LibrarySections';
import { GameDetail } from '@renderer/components/GameDetail';
import { CatalogView } from '@renderer/components/CatalogView';
import { LibraryConsoleView } from '@renderer/components/LibraryConsoleView';
import { useLibraryShortcuts } from '@renderer/input/shortcuts';
import { useUiStore } from '@renderer/store/uiStore';

/**
 * Library content only - the persistent system/Library/Settings sidebar lives in
 * DesktopShell (AppSidebar), and the active-console accent is applied there too.
 * A selected console opens as YOUR games (Library mode) or the full catalog (Browse).
 */
export function LibraryView() {
  useLibraryShortcuts();
  const activeSystemId = useUiStore((s) => s.activeSystemId);
  const sidebarMode = useUiStore((s) => s.sidebarMode);

  if (activeSystemId != null) {
    return (
      <div className="h-full min-h-0">
        {sidebarMode === 'browse' ? (
          <CatalogView key={activeSystemId} systemId={activeSystemId} />
        ) : (
          <LibraryConsoleView key={activeSystemId} systemId={activeSystemId} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center px-5">
          <Toolbar />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
          <LibrarySections />
        </div>
      </div>
      <GameDetail />
    </div>
  );
}
