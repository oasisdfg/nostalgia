import { Gamepad2 } from 'lucide-react';
import { GameGrid } from './GameGrid';
import { CardSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { useGames } from '@renderer/query/useGames';
import { useSystems } from '@renderer/query/useSystems';
import { useUiStore } from '@renderer/store/uiStore';
import type { GameDTO } from '@shared/contracts/ipc';

/**
 * The all-systems Library: your favorited/owned games, split into one row per console
 * that actually has games. Grouping is by the game's `systemId` - the console it was
 * ADDED from - so a cross-platform title lands under the exact console you favorited
 * it on. No headers, backdrops, or labels: the retail case art IS the console
 * indicator (per-console libraries are reachable from the sidebar).
 */
export function LibrarySections() {
  const libraryQuery = useUiStore((s) => s.libraryQuery);
  const { data, isLoading } = useGames(libraryQuery);
  const { data: systems = [] } = useSystems(false);

  if (isLoading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,190px)] gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Gamepad2 className="h-6 w-6" />}
        title="Your library is empty"
        hint="Open a console in the sidebar to browse the catalog, then add games to My List."
      />
    );
  }

  const bySystem = new Map<number, GameDTO[]>();
  for (const g of items) {
    const group = bySystem.get(g.systemId);
    if (group) group.push(g);
    else bySystem.set(g.systemId, [g]);
  }
  // Render rows in the systems' configured order; only consoles that have games.
  const sections = systems.filter((s) => bySystem.has(s.id));

  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <GameGrid key={s.id} items={bySystem.get(s.id)!} slug={s.slug} />
      ))}
    </div>
  );
}
