import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Boxes, RefreshCw } from 'lucide-react';
import { FocusSection, Focusable } from './Focusable';
import { IconButton } from './IconButton';
import { SearchBar } from './SearchBar';
import { Select } from './Select';
import { EmptyState } from './EmptyState';
import { CardSkeleton } from './Skeleton';
import { ConsoleLogo } from './SystemIcon';
import { SectionLabel } from './SectionLabel';
import { PortCard } from './PortCard';
import { PortDetailPage } from './PortDetailPage';
import { useConsoles, filterPorts, groupByConsole, matchesChip, CHIPS } from './portsModel';
import { useRecomps, useRecompCovers, useCheckRecompUpdates } from '@renderer/query/useRecomps';
import { useUiStore, type PortsUiState } from '@renderer/store/uiStore';
import type { RecompDTO } from '@shared/contracts/recomps';

// The Catalog's grid, verbatim, so port cards are exactly library-card sized.
const GRID = 'grid grid-cols-[repeat(auto-fill,190px)] gap-4 -mx-1.5 px-1.5 py-2.5';
const CARD_W = 190;
const GAP = 16;

const FIELD = '!bg-surface/40 !py-2 text-sm backdrop-blur-sm';

/**
 * How many 190px cards fit one row of the container (for the pinned "Ready to play" row).
 * A callback ref, so it re-attaches when the grid remounts after a detail page.
 */
function useColumns(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(6);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.floor((e.contentRect.width + GAP) / (CARD_W + GAP)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, cols];
}

/**
 * Native Ports: PC ports of console games, browsed like the Catalog - a full-width grid of
 * the original games' covers, header filters, state chips, and per-console sections. A
 * port opens its detail page; Escape / Back returns here with filters and scroll kept.
 */
export function PortsView() {
  const ui = useUiStore((s) => s.ports);
  const setUi = useUiStore((s) => s.setPortsUi);
  const { data: ports = [], isLoading } = useRecomps();
  const check = useCheckRecompUpdates();
  const consoles = useConsoles();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowRef, cols] = useColumns();
  // Covers in display order, so the top of the grid fills in first.
  const art = useRecompCovers(filterPorts(ports, ui, consoles).map((p) => p.manifest.id));

  const open = (id: string): void => setUi({ detailId: id, scrollTop: scrollRef.current?.scrollTop ?? 0 });
  const back = (): void => setUi({ detailId: null });

  // Coming back from a detail: put the grid where it was.
  const scrollTop = ui.scrollTop;
  useLayoutEffect(() => {
    if (ui.detailId == null && scrollRef.current) scrollRef.current.scrollTop = scrollTop;
  }, [ui.detailId, scrollTop]);

  // Escape returns to the grid (unless a menu is open - it closes itself first).
  useEffect(() => {
    if (ui.detailId == null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role="menu"]')) setUi({ detailId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.detailId, setUi]);

  if (ui.detailId != null) return <PortDetailPage id={ui.detailId} onBack={back} />;

  const filtered = filterPorts(ports, ui, consoles);
  const shown = filtered.filter((p) => matchesChip(p, ui.chip));
  const consoleOptions = [...new Set(ports.map((p) => p.manifest.gameFile.systemSlug))].sort(
    (a, b) => consoles.order(a) - consoles.order(b),
  );
  const readyAll = filtered.filter((p) => p.canPlay);
  // Pinned shortcut row: only in the unfiltered "All" view, one row of cards at most.
  const ready = ui.chip === 'all' && !ui.search ? readyAll.slice(0, cols) : [];

  const card = (p: RecompDTO, keyPrefix = ''): JSX.Element => (
    <PortCard key={keyPrefix + p.manifest.id} port={p} coverUrl={art[p.manifest.id]?.coverUrl ?? null} onOpen={open} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-5 py-3">
        <div className="mr-auto flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">Native Ports</h1>
          {/* The count follows the filters, so an empty-looking grid explains itself. */}
          <span className="text-sm tabular-nums text-fg-muted" aria-live="polite">
            {shown.length === ports.length ? `${ports.length} ports` : `${shown.length} of ${ports.length} ports`}
          </span>
        </div>
        <SearchBar value={ui.search} onChange={(search) => setUi({ search })} />
        <div className="flex items-center gap-1.5">
          {ui.console !== 'all' && <ConsoleLogo slug={ui.console} className="text-fg-muted" />}
          <Select value={ui.console} onChange={(e) => setUi({ console: e.target.value })} aria-label="Console" className={`w-40 ${FIELD}`}>
            <option value="all">All consoles</option>
            {consoleOptions.map((slug) => (
              <option key={slug} value={slug}>
                {consoles.name(slug)}
              </option>
            ))}
          </Select>
        </div>
        <Select
          value={ui.status}
          onChange={(e) => setUi({ status: e.target.value as PortsUiState['status'] })}
          aria-label="Status"
          className={`w-32 ${FIELD}`}
        >
          <option value="all">Any status</option>
          <option value="playable">Playable</option>
          <option value="beta">Beta</option>
        </Select>
        <Select
          value={ui.sort}
          onChange={(e) => setUi({ sort: e.target.value as PortsUiState['sort'] })}
          aria-label="Sort"
          className={`w-40 ${FIELD}`}
        >
          <option value="console">By console</option>
          <option value="name">By name</option>
          <option value="added">Recently added</option>
        </Select>
        <IconButton
          icon={<RefreshCw className={`h-4 w-4 ${check.isPending ? 'animate-spin motion-reduce:animate-none' : ''}`} />}
          label="Check for updates"
          disabled={check.isPending}
          onClick={() => check.mutate(undefined)}
        />
      </div>

      <PortChips ports={filtered} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-5 pb-6 pt-2">
        <div ref={rowRef}>
          {isLoading ? (
            <div className={GRID}>
              {Array.from({ length: 12 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState
              icon={<Boxes className="h-6 w-6" />}
              title={ports.length === 0 ? 'No ports available' : 'No ports match'}
              hint={ports.length === 0 ? undefined : 'Try another console, status or search.'}
            />
          ) : (
            <div className="space-y-6 animate-fade-in motion-reduce:animate-none">
              {ready.length > 0 && (
                <section>
                  <SectionLabel label="Ready to play" count={readyAll.length} />
                  <FocusSection className={GRID}>{ready.map((p) => card(p, 'ready-'))}</FocusSection>
                </section>
              )}
              {ui.sort === 'console' ? (
                groupByConsole(shown).map((g) => (
                  <section key={g.slug}>
                    <SectionLabel slug={g.slug} label={consoles.name(g.slug)} count={g.ports.length} />
                    <FocusSection className={GRID}>{g.ports.map((p) => card(p))}</FocusSection>
                  </section>
                ))
              ) : (
                <FocusSection className={GRID}>{shown.map((p) => card(p))}</FocusSection>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Segmented state chips (one active) on the well recipe. Empty chips hide, except All. */
export function PortChips({ ports, size = 'md' }: { ports: RecompDTO[]; size?: 'md' | 'lg' }) {
  const chip = useUiStore((s) => s.ports.chip);
  const setUi = useUiStore((s) => s.setPortsUi);
  const chips = CHIPS.map((c) => ({ ...c, count: ports.filter((p) => matchesChip(p, c.id)).length })).filter(
    (c) => c.id === 'all' || c.count > 0,
  );
  return (
    <FocusSection focusKey={size === 'lg' ? 'bs-port-chips' : undefined} className="shrink-0 px-5">
      <div className="inline-flex flex-wrap gap-1 rounded-lg bg-bg/60 p-1 shadow-inset-1">
        {chips.map((c) => (
          <Focusable
            key={c.id}
            ariaLabel={`${c.label}, ${c.count}`}
            ariaPressed={chip === c.id}
            focusClassName=""
            className="rounded-md"
            onSelect={() => setUi({ chip: c.id })}
          >
            {(focused) => (
              <span
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 transition-colors motion-reduce:transition-none ${
                  size === 'lg' ? 'py-2 text-base' : 'py-1 text-xs'
                } ${
                  chip === c.id
                    ? 'bg-surface-2 font-semibold text-fg shadow-e1'
                    : focused
                      ? 'bg-white/10 text-fg'
                      : 'text-fg-muted hover:text-fg'
                }`}
              >
                {c.label}
                <span className={`tabular-nums ${chip === c.id ? 'text-accent' : 'text-fg-muted'}`}>{c.count}</span>
              </span>
            )}
          </Focusable>
        ))}
      </div>
    </FocusSection>
  );
}
