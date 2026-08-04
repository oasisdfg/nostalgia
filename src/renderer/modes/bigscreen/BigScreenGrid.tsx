import { useEffect, useRef, useState } from 'react';
import { Plug, Gamepad2, ChevronLeft, ChevronRight } from 'lucide-react';
import { FocusSection } from '@renderer/components/Focusable';
import { Button } from '@renderer/components/Button';
import { CardSkeleton } from '@renderer/components/Skeleton';
import { EmptyState } from '@renderer/components/EmptyState';
import { useCatalogList } from '@renderer/query/useCatalog';
import { useGames } from '@renderer/query/useGames';
import { useIgdbStatus } from '@renderer/query/useIgdb';
import { BigScreenCard } from './BigScreenCard';
import type { CatalogListItem } from '@shared/contracts/catalog';
import type { GameDTO } from '@shared/contracts/ipc';

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-6';
const HEADING = 'mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted';

/** Library/My List rows reuse the catalog card; games without an igdbId can't open the
 *  igdbId-keyed detail page, so their open is a no-op (guarded in onOpen below). */
const toCatalogItem = (g: GameDTO): CatalogListItem => ({
  igdbId: g.igdbId ?? 0,
  name: g.title,
  coverUrl: g.coverUrl ?? null,
  releaseYear: g.releaseDate ? Number(g.releaseDate.slice(0, 4)) || null : null,
  favorite: g.favorite,
});

/** The oversized catalog grid for one system: the user's own games first, then the
 *  full catalog with next/previous page controls. */
export function BigScreenGrid({ systemId, onOpen }: { systemId: number; onOpen: (igdbId: number) => void }) {
  const status = useIgdbStatus();
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [systemId]);
  // Paging with the mouse leaves the container scrolled to the bottom buttons -
  // snap back to the top of the grid whenever the page (or system) flips.
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'nearest' });
  }, [page, systemId]);
  const list = useCatalogList(systemId, '', page, 'popular', '');
  const myGames = useGames({ systemId, sort: 'title', order: 'asc' });
  const mine = myGames.data?.items ?? [];

  if (status.data && !status.data.configured) {
    return (
      <EmptyState
        icon={<Plug className="h-6 w-6" />}
        title="Connect IGDB to browse the catalog"
        hint="Add your IGDB credentials in Desktop Mode → Settings → IGDB."
      />
    );
  }
  if (list.isLoading) {
    return (
      <div className={`${GRID} p-8`}>
        {Array.from({ length: 12 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (list.isError) return <EmptyState title="Couldn’t load the catalog" hint={(list.error as Error).message} />;
  if (!(list.data?.supported ?? true)) return <EmptyState title="No catalog for this platform" />;
  const items = list.data?.items ?? [];
  const hasMore = list.data?.hasMore ?? false;
  if (items.length === 0 && mine.length === 0 && page === 0) {
    return <EmptyState icon={<Gamepad2 className="h-6 w-6" />} title="No games here yet" />;
  }

  return (
    <FocusSection focusKey="bs-grid" className="p-8 animate-fade-in">
      <div ref={topRef} />
      {mine.length > 0 && (
        <div className="mb-10">
          <h2 className={HEADING}>My games</h2>
          <div className={GRID}>
            {mine.map((g) => (
              <BigScreenCard
                key={`mine-${g.id}`}
                item={toCatalogItem(g)}
                onOpen={(id) => id > 0 && onOpen(id)}
              />
            ))}
          </div>
        </div>
      )}

      <h2 className={HEADING}>All games</h2>
      <div className={GRID}>
        {items.map((it) => (
          <BigScreenCard key={it.igdbId} item={it} onOpen={onOpen} />
        ))}
      </div>

      {(page > 0 || hasMore) && (
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button
            size="lg"
            variant="secondary"
            icon={<ChevronLeft className="h-5 w-5" />}
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="min-w-16 text-center text-base tabular-nums text-fg-muted">Page {page + 1}</span>
          <Button
            size="lg"
            variant="secondary"
            icon={<ChevronRight className="h-5 w-5" />}
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </FocusSection>
  );
}
