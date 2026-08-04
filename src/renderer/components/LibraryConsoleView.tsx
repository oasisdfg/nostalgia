import { Gamepad2 } from 'lucide-react';
import { Toolbar } from './Toolbar';
import { GameGrid } from './GameGrid';
import { GameDetail } from './GameDetail';
import { CardSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { useGames } from '@renderer/query/useGames';
import { useSystems } from '@renderer/query/useSystems';
import { useUiStore } from '@renderer/store/uiStore';

/**
 * Library mode, one console per page: only the games YOU have saved for this console
 * (owned or in My List), as a wrapping grid of the same cards the Library rows use,
 * with the pop-out on the right. The console's backdrop/accent come from DesktopShell
 * (keyed by activeSystemId) exactly like the Browse catalog pages.
 */
export function LibraryConsoleView({ systemId }: { systemId: number }) {
  const libraryQuery = useUiStore((s) => s.libraryQuery);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const { data, isLoading } = useGames({ ...libraryQuery, systemId });
  const { data: systems = [] } = useSystems(false);
  const slug = systems.find((s) => s.id === systemId)?.slug;
  const items = data?.items ?? [];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center px-5">
          <Toolbar />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
          {isLoading ? (
            <div className="-mx-1.5 grid grid-cols-[repeat(auto-fill,190px)] gap-4 px-1.5 py-2.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Gamepad2 className="h-6 w-6" />}
              title="No games for this console yet"
              hint="Browse its catalog and add games to My List, or install one."
              action={
                <Button variant="primary" onClick={() => setSidebarMode('browse')}>
                  Browse catalog
                </Button>
              }
            />
          ) : (
            <GameGrid items={items} wrap slug={slug} />
          )}
        </div>
      </div>
      <GameDetail />
    </div>
  );
}
