import { Focusable } from '@renderer/components/Focusable';
import type { CatalogListItem } from '@shared/contracts/catalog';

/** Oversized catalog card for the 10-foot grid. Focus lifts + scales + accent-rings it. */
export function BigScreenCard({
  item,
  focusKey,
  onOpen,
}: {
  item: CatalogListItem;
  focusKey?: string;
  onOpen: (igdbId: number) => void;
}) {
  return (
    <Focusable
      ariaLabel={item.name}
      focusKey={focusKey}
      focusClassName=""
      className="rounded-xl"
      onSelect={() => onOpen(item.igdbId)}
    >
      {(focused) => (
        // Seamless art card: no reserved border (a transparent 2px border renders as a
        // hairline at fractional DPI). Focus affordance = lift + accent ring + shadow;
        // at rest the cover art ends flat at its own edge (no drop shadow).
        <div
          className={`overflow-hidden rounded-xl transition-all duration-150 ${
            focused ? '-translate-y-1 scale-[1.04] shadow-e3 ring-2 ring-accent' : ''
          }`}
        >
          <div className="relative aspect-[3/4] w-full bg-black">
            {item.coverUrl ? (
              <img src={item.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-2 to-bg p-3">
                <span className="line-clamp-4 select-none text-center text-xl font-semibold leading-snug text-fg-faint/80">
                  {item.name}
                </span>
              </div>
            )}
            {/* Title scrim only on the focused card (or when there's no cover art to
                carry the identity) - a permanent scrim dims every cover in the grid. */}
            {item.coverUrl && (
              <>
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent transition-opacity duration-150 ${
                    focused ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <div
                  className={`absolute inset-x-0 bottom-0 p-3 transition-opacity duration-150 ${
                    focused ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <p className="line-clamp-2 text-base font-semibold leading-snug text-fg">{item.name}</p>
                  {item.releaseYear && <p className="mt-0.5 text-sm text-fg-muted">{item.releaseYear}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Focusable>
  );
}
