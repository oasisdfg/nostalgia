import { useEffect, useState, type ReactNode } from 'react';
import { Search, ChevronLeft, ChevronRight, Plug } from 'lucide-react';
import { FocusSection } from './Focusable';
import { CatalogGameCard } from './CatalogGameCard';
import { CatalogDetailPage } from './CatalogDetailPage';
import { CardSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Select } from './Select';
import { useCatalogList } from '@renderer/query/useCatalog';
import { useIgdbStatus } from '@renderer/query/useIgdb';
import { useUiStore } from '@renderer/store/uiStore';
import { CATALOG_FILTER_OPTIONS, type CatalogSort } from '@shared/contracts/catalog';

// Fixed 190px columns + the same breathing room as the Library grids, so catalog cards
// render at EXACTLY the same size as library cards (they used to stretch via minmax).
// -mx-1.5 cancels the px-1.5 hover-scale room so covers stay aligned with the toolbar.
const GRID = 'grid grid-cols-[repeat(auto-fill,190px)] gap-4 -mx-1.5 px-1.5 py-2.5';

const SORT_OPTIONS: { value: CatalogSort; label: string }[] = [
  { value: 'popular', label: 'Popular' },
  { value: 'releaseDate', label: 'Release date' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'exclusives', label: 'Exclusives' },
];

export function CatalogView({ systemId }: { systemId: number }) {
  const setView = useUiStore((s) => s.setView);
  const catalogDetailIgdbId = useUiStore((s) => s.catalogDetailIgdbId);
  const clearCatalogDetail = useUiStore((s) => s.clearCatalogDetail);
  const [search, setSearch] = useState('');
  // Debounced copy of the search box: each distinct value hits the IGDB API in main
  // (a network call + cover fetches), so wait for a typing pause instead of querying
  // per keystroke. The input itself stays on the instant `search` state.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<CatalogSort>('popular');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const status = useIgdbStatus();
  const list = useCatalogList(systemId, debouncedSearch, page, sort, filter);

  // Fresh view per console: switching systems resets search/sort/filter/paging.
  useEffect(() => {
    setSearch('');
    setPage(0);
    setSort('popular');
    setFilter('');
    setSelected(null);
  }, [systemId]);

  // Home deep-link: open the requested catalog detail once, then clear the pending target.
  useEffect(() => {
    if (catalogDetailIgdbId != null) {
      setSelected(catalogDetailIgdbId);
      clearCatalogDetail();
    }
  }, [catalogDetailIgdbId, clearCatalogDetail]);

  const notConfigured = status.data && !status.data.configured;
  const supported = list.data?.supported ?? true;

  let body: ReactNode;
  if (notConfigured) {
    body = (
      <EmptyState
        icon={<Plug className="h-6 w-6" />}
        title="Connect IGDB to browse the catalog"
        hint="Add your IGDB (Twitch) credentials in Settings → IGDB to list games for each platform."
        action={
          <Button variant="primary" onClick={() => setView('settings')}>
            Open Settings
          </Button>
        }
      />
    );
  } else if (!supported) {
    body = <EmptyState title="No catalog for this platform" hint="This system isn't mapped to an IGDB platform." />;
  } else if (list.isLoading) {
    body = (
      <div className={GRID}>
        {Array.from({ length: 12 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <EmptyState title="Couldn't load the catalog" hint={(list.error as Error).message} />;
  } else {
    const items = list.data?.items ?? [];
    body =
      items.length === 0 ? (
        <EmptyState title="No results" hint="Try a different search." />
      ) : (
        <FocusSection className={`${GRID} animate-fade-in`}>
          {items.map((it) => (
            <CatalogGameCard key={it.igdbId} item={it} onOpen={setSelected} systemId={systemId} />
          ))}
        </FocusSection>
      );
  }

  const canPage = supported && !notConfigured;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {selected != null ? (
        <CatalogDetailPage igdbId={selected} systemId={systemId} onBack={() => setSelected(null)} />
      ) : (
        <>
          <div className="flex h-14 shrink-0 items-center gap-3 px-5">
            {canPage && (
              <div className="flex items-center gap-2">
                <Select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as CatalogSort);
                    setPage(0);
                  }}
                  aria-label="Sort games"
                  className="w-36 !bg-surface/40 !py-2 text-sm backdrop-blur-sm"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <Select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(0);
                  }}
                  aria-label="Filter by genre"
                  className="w-36 !bg-surface/40 !py-2 text-sm backdrop-blur-sm"
                >
                  <option value="">All genres</option>
                  {CATALOG_FILTER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {canPage && (page > 0 || list.data?.hasMore) && (
                <div className="flex items-center gap-1">
                  {page > 0 && (
                    <IconButton
                      icon={<ChevronLeft className="h-4 w-4" />}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      label="Previous page"
                    />
                  )}
                  {list.data?.hasMore && (
                    <IconButton
                      icon={<ChevronRight className="h-4 w-4" />}
                      onClick={() => setPage((p) => p + 1)}
                      label="Next page"
                    />
                  )}
                </div>
              )}
              <div className="relative w-64 max-w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search this platform…"
                  className="w-full rounded-md bg-black/25 shadow-inset-1 py-2 pl-9 pr-3 text-sm text-fg outline-none backdrop-blur-sm transition-colors placeholder:text-fg-faint focus:bg-black/40 focus:ring-1 focus:ring-accent/60"
                />
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-5">{body}</div>
        </>
      )}
    </div>
  );
}
