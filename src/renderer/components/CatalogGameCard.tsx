import { Focusable } from './Focusable';
import { FavoriteToggle } from './FavoriteToggle';
import { useCatalogSetFavorite } from '@renderer/query/useCatalog';
import type { CatalogListItem } from '@shared/contracts/catalog';

/**
 * Catalog cover card = just the cover art (no overlaid title/scrim). When `systemId` is
 * provided, a My List heart appears (on hover or spatial focus). No-cover titles fall back
 * to their name text so they stay identifiable.
 */
export function CatalogGameCard({
  item,
  onOpen,
  systemId,
}: {
  item: CatalogListItem;
  onOpen: (id: number) => void;
  systemId?: number;
}) {
  const setFav = useCatalogSetFavorite();
  return (
    <Focusable
      ariaLabel={item.name}
      focusClassName=""
      className="group block rounded-lg"
      onSelect={() => onOpen(item.igdbId)}
    >
      {(focused) => (
        <div
          // Flat cover art - no drop shadow, matching the library's GameCard. Accent
          // ring marks focus. No transform - scaling rasterizes the heart/year
          // overlays and they render blurry (UI-STYLE.md motion rule).
          className={`relative rounded-lg ${focused ? 'ring-2 ring-accent' : ''}`}
        >
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black">
            {item.coverUrl ? (
              <img src={item.coverUrl} alt={item.name} loading="lazy" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-lg bg-gradient-to-br from-surface-2 to-bg p-2.5">
                <span className="line-clamp-4 select-none text-center text-sm font-semibold leading-snug text-fg-faint/80">
                  {item.name}
                </span>
              </div>
            )}
            {/* Release year, top-right. Hidden until hover OR spatial focus (gamepad has no hover). */}
            {item.releaseYear && (
              <span
                className={`absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-fg/90 transition-opacity duration-150 ${
                  focused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {item.releaseYear}
              </span>
            )}
            {/* My List heart, top-left - revealed on hover/focus, or always shown when favorited. */}
            {systemId != null && (
              <div
                className={`absolute left-1.5 top-1.5 transition-opacity duration-150 ${
                  item.favorite || focused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <FavoriteToggle
                  size="sm"
                  favorite={!!item.favorite}
                  onToggle={() => setFav.mutate({ igdbId: item.igdbId, systemId, favorite: !item.favorite })}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </Focusable>
  );
}
