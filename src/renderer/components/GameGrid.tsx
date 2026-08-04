import { useState, useRef, useEffect, useCallback, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Eye, Info, Download, PackageMinus, Trash2, Loader2, ChevronLeft, ChevronRight, MonitorPlay } from 'lucide-react';
import { FocusSection } from './Focusable';
import { GameCard } from './GameCard';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { useRemoveGame, useUninstallGame } from '@renderer/query/useGames';
import { useCatalogDownload, useCatalogAvailability } from '@renderer/query/useCatalog';
import { useLaunchEmulator } from '@renderer/query/useLaunch';
import { useUiStore } from '@renderer/store/uiStore';
import type { GameDTO } from '@shared/contracts/ipc';

interface MenuState {
  x: number;
  y: number;
  game: GameDTO;
  confirmRemove: boolean;
}

/** Edge scroll arrow - transparent (no background, even on hover); brightens on hover. */
function ScrollArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      className={`absolute bottom-0 top-0 z-20 flex w-12 items-center justify-center text-fg/70 opacity-0 transition-[color,opacity] hover:text-fg pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 ${
        side === 'left' ? 'left-0 justify-start pl-1' : 'right-0 justify-end pr-1'
      }`}
    >
      <Icon className="h-9 w-9 drop-shadow-[0_1px_5px_rgb(0_0_0/0.9)]" />
    </button>
  );
}

/** One console's games. Default: a single horizontally-scrolling row (no scrollbar -
 *  hover-revealed arrow buttons page through it). `wrap`: a wrapping grid of the SAME
 *  190px cards, for the per-console Library page. Context menu is shared by both. */
export function GameGrid({ items, wrap = false, slug }: { items: GameDTO[]; wrap?: boolean; slug?: string }) {
  const setSelectedGameId = useUiStore((s) => s.setSelectedGameId);
  const openCatalogDetail = useUiStore((s) => s.openCatalogDetail);
  const removeGame = useRemoveGame();
  const uninstall = useUninstallGame();
  const catalogDownload = useCatalogDownload();
  const launchEmulator = useLaunchEmulator();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 4);
  }, []);
  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [items, updateArrows]);
  const page = (dir: number): void =>
    scrollRef.current?.scrollBy({ left: dir * scrollRef.current.clientWidth * 0.85, behavior: 'smooth' });

  // Click-drag panning for the scrollbar-less rows: press anywhere on the row and
  // slide horizontally. Becomes a drag only past a small threshold, so plain clicks
  // still open cards; after a real drag the click that follows pointerup is
  // swallowed in the capture phase so the card under the cursor doesn't open.
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !scrollRef.current) return;
    drag.current = { down: true, startX: e.clientX, startLeft: scrollRef.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d.down || !el) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
    }
    if (d.moved) el.scrollLeft = d.startLeft - dx;
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d.moved && scrollRef.current?.hasPointerCapture(e.pointerId)) {
      scrollRef.current.releasePointerCapture(e.pointerId);
    }
    d.down = false; // keep `moved` set: the click suppressor below consumes + resets it
  };
  const onClickCapture = (e: MouseEvent<HTMLDivElement>): void => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  // Only a file-less favorite needs an availability check to decide whether "Install" shows.
  const menuGame = menu?.game;
  const menuAvail = useCatalogAvailability(
    menuGame && !menuGame.hasFiles && menuGame.igdbId != null ? menuGame.igdbId : null,
    menuGame?.systemId ?? 0,
  );

  const open = (g: GameDTO): void => setSelectedGameId(g.id);
  const openMenu = (e: MouseEvent, game: GameDTO): void =>
    setMenu({ x: e.clientX, y: e.clientY, game, confirmRemove: false });

  const menuItems = (m: MenuState): ContextMenuItem[] => {
    const g = m.game;
    const out: ContextMenuItem[] = [{ label: 'Open', icon: <Eye className="h-4 w-4" />, onClick: () => open(g) }];
    if (g.igdbId != null) {
      out.push({
        label: 'Details',
        icon: <Info className="h-4 w-4" />,
        onClick: () => openCatalogDetail(g.systemId, g.igdbId!),
      });
    }
    if (g.hasFiles) {
      out.push({
        label: 'Uninstall',
        icon: <PackageMinus className="h-4 w-4" />,
        onClick: () => uninstall.mutate({ gameId: g.id }),
      });
    } else if (g.igdbId != null) {
      // Install appears only once a real download is confirmed for this title.
      if (menuAvail.isLoading) {
        out.push({ label: 'Checking…', icon: <Loader2 className="h-4 w-4 animate-spin" />, disabled: true, onClick: () => {} });
      } else if (menuAvail.data?.available) {
        out.push({
          label: 'Install',
          icon: <Download className="h-4 w-4" />,
          onClick: () => catalogDownload.mutate({ igdbId: g.igdbId!, systemId: g.systemId }),
        });
      }
    }
    // Opens the console's emulator on its own - BIOS setup, controller mapping, save-state
    // management. Independent of whether this game's file is present.
    out.push({
      label: 'Open emulator',
      icon: <MonitorPlay className="h-4 w-4" />,
      onClick: () => launchEmulator.mutate({ systemId: g.systemId }),
    });
    out.push(
      m.confirmRemove
        ? {
            label: 'Click again to remove',
            icon: <Trash2 className="h-4 w-4" />,
            danger: true,
            onClick: () => removeGame.mutate({ gameId: g.id }),
          }
        : {
            label: 'Remove from library',
            icon: <Trash2 className="h-4 w-4" />,
            danger: true,
            keepOpen: true,
            onClick: () => setMenu((s) => (s ? { ...s, confirmRemove: true } : s)),
          },
    );
    return out;
  };

  const cards = items.map((g) => (
    <div key={g.id} className="shrink-0">
      <GameCard game={g} artUrl={g.coverUrl} onOpen={() => open(g)} onContextMenu={openMenu} slug={slug} />
    </div>
  ));

  return (
    <>
      {wrap ? (
        // Wrapping flex (not a fixed grid): cards are natural-aspect case art with
        // per-console widths, so columns can't be fixed. px/py give the hover scale +
        // drop shadow breathing room; -mx cancels the px so cases stay left-aligned
        // with the toolbar/headers (same trick as the rows).
        <FocusSection className="-mx-1.5 flex flex-wrap gap-4 px-1.5 py-2.5 animate-fade-in">
          {cards}
        </FocusSection>
      ) : (
        <div className="group/row relative">
          <div
            ref={scrollRef}
            onScroll={updateArrows}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onClickCapture={onClickCapture}
            onDragStart={(e) => e.preventDefault()}
            // scrollbar-width:none is what actually hides it - the app sets `* { scrollbar-width: thin }`
            // globally, and in modern Chromium that OVERRIDES ::-webkit-scrollbar, so the pseudo alone
            // was ignored. Arrows (ScrollArrow) replace the scrollbar.
            // -mx-1.5 cancels the FocusSection's px-1.5 breathing room so the first cover
            // still left-aligns with the section header above it.
            className="-mx-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* py-2.5/px-1.5: room for the card's hover scale + drop shadow so neither
                clips against the row's overflow-x-auto box. */}
            <FocusSection className="flex gap-4 px-1.5 py-2.5 animate-fade-in">{cards}</FocusSection>
          </div>
          {canLeft && <ScrollArrow side="left" onClick={() => page(-1)} />}
          {canRight && <ScrollArrow side="right" onClick={() => page(1)} />}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
    </>
  );
}
