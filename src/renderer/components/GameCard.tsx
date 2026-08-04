import { type MouseEvent } from 'react';
import { DownloadCloud } from 'lucide-react';
import { Focusable } from './Focusable';
import { useUiStore } from '@renderer/store/uiStore';
import type { GameDTO } from '@shared/contracts/ipc';

interface GameCardProps {
  game: GameDTO;
  artUrl?: string | null;
  onOpen: (id: number) => void;
  onContextMenu?: (e: MouseEvent, game: GameDTO) => void;
  /** Console slug - picks the card height for that console's case shape. */
  slug?: string;
}

// Card height per console. Squarer/landscape boxes (DS, GBA, SNES, N64) rendered at
// the DVD-case height balloon to huge areas - shorter heights keep every row's
// footprint visually comparable.
const CASE_HEIGHT: Record<string, string> = {
  ds: 'h-52',
  '3ds': 'h-52',
  gba: 'h-48',
  snes: 'h-44',
  n64: 'h-44',
};

/**
 * A library game card = the box art AT ITS NATURAL SHAPE: fixed height, width from the
 * image's own aspect ratio - a PS3 case is tall, a SNES box is wide, a DS case is
 * narrow, and none of them get black bars or crops. The case art itself carries the
 * console branding, so there's no frame/label chrome. Games with no cover fall back
 * to a portrait card with their title text.
 */
export function GameCard({ game, artUrl, onOpen, onContextMenu, slug }: GameCardProps) {
  const setFocusedGame = useUiStore((s) => s.setFocusedGame);
  const releaseYear = game.releaseDate ? game.releaseDate.slice(0, 4) : null;
  const heightClass = (slug && CASE_HEIGHT[slug]) || 'h-64';
  return (
    <Focusable
      ariaLabel={game.title}
      focusClassName=""
      className="group block w-fit rounded-lg"
      onSelect={() => onOpen(game.id)}
      onFocusChange={(f) => {
        if (f) setFocusedGame({ id: game.id, favorite: game.favorite });
      }}
    >
      {(focused) => (
        <div
          onContextMenu={onContextMenu ? (e) => onContextMenu(e, game) : undefined}
          // Flat box art - no drop shadow. Accent ring marks focus for gamepad nav.
          // No transform - scaling rasterizes the overlay badges and they render
          // blurry (UI-STYLE.md motion rule).
          className={`relative w-fit rounded-lg ${focused ? 'ring-2 ring-accent' : ''}`}
        >
          <div className={`relative ${heightClass} w-fit overflow-hidden rounded-lg`}>
            {artUrl ? (
              <img src={artUrl} alt={game.title} loading="lazy" className="h-full w-auto" />
            ) : (
              <div className="flex h-full w-48 items-center justify-center rounded-lg bg-gradient-to-br from-surface-2 to-bg p-2.5">
                <span className="line-clamp-4 select-none text-center text-sm font-semibold leading-snug text-fg-faint/80">
                  {game.title}
                </span>
              </div>
            )}
            {/* Not-downloaded cloud glyph, bottom-right (its own backdrop keeps it legible). */}
            {!game.hasFiles && (
              <span
                className="absolute bottom-1.5 right-1.5 rounded bg-black/70 p-1 text-fg/80"
                title="Not downloaded"
              >
                <DownloadCloud className="h-3.5 w-3.5" />
              </span>
            )}
            {/* Release year, top-right - revealed on hover OR spatial focus (no layout shift). */}
            {releaseYear && (
              <span
                className={`absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-fg/90 transition-opacity duration-150 ${
                  focused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {releaseYear}
              </span>
            )}
          </div>
        </div>
      )}
    </Focusable>
  );
}
