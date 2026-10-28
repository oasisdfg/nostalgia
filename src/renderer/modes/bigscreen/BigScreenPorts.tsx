import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { FocusSection, Focusable } from '@renderer/components/Focusable';
import { Spinner } from '@renderer/components/Spinner';
import { EmptyState } from '@renderer/components/EmptyState';
import { ConsoleLogo } from '@renderer/components/SystemIcon';
import { PortChips } from '@renderer/components/PortsView';
import { PortDetailPage } from '@renderer/components/PortDetailPage';
import { useConsoles, filterPorts, groupByConsole, matchesChip, isBusyPort } from '@renderer/components/portsModel';
import { setFocus } from '@renderer/input/spatialNav';
import { GP_EVENT } from '@renderer/input/gamepad';
import { useUiStore } from '@renderer/store/uiStore';
import { useRecomps, useRecompArt, useLaunchRecomp } from '@renderer/query/useRecomps';
import type { RecompDTO } from '@shared/contracts/recomps';

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-6';
const HEADING = 'mb-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-wide text-fg-muted';

/**
 * Big Screen Native Ports: the same list as the desktop view (shared model + chips), as
 * 10-foot cards. A opens a port's page, X plays the focused port, Y opens its More menu,
 * B backs out (detail → grid → rail). Every control is spatially focusable.
 */
export function BigScreenPorts() {
  const ui = useUiStore((s) => s.ports);
  const setUi = useUiStore((s) => s.setPortsUi);
  const { data: ports = [], isLoading } = useRecomps();
  const consoles = useConsoles();
  const art = useRecompArt(ports.map((p) => p.manifest.id)).data ?? {};
  const launch = useLaunchRecomp();
  const [moreOnOpen, setMoreOnOpen] = useState(false);
  const focused = useRef<RecompDTO | null>(null);

  // Big Screen has no header filters: chips only, grouped by console.
  const all = filterPorts(ports, { search: '', console: 'all', status: 'all', sort: 'console' }, consoles);
  const shown = all.filter((p) => matchesChip(p, ui.chip));
  const detailId = ui.detailId;

  // Land on the grid when the view opens (or after closing a detail).
  useEffect(() => {
    if (detailId != null || isLoading) return;
    const r = requestAnimationFrame(() => setFocus('bs-ports'));
    return () => cancelAnimationFrame(r);
  }, [detailId, isLoading]);

  // X plays the focused port, Y opens it with More showing. (The detail page handles its
  // own X/Y while open.)
  useEffect(() => {
    if (detailId != null) return;
    const onX = (): void => {
      const p = focused.current;
      if (p?.canPlay) launch.mutate(p.manifest.id);
    };
    const onY = (): void => {
      const p = focused.current;
      if (!p) return;
      setMoreOnOpen(true);
      setUi({ detailId: p.manifest.id });
    };
    window.addEventListener(GP_EVENT.x, onX);
    window.addEventListener(GP_EVENT.y, onY);
    return () => {
      window.removeEventListener(GP_EVENT.x, onX);
      window.removeEventListener(GP_EVENT.y, onY);
    };
  }, [detailId, launch, setUi]);

  // B / Escape on a port's page goes back to the grid - before the shell's handler would
  // send focus all the way back to the rail.
  useEffect(() => {
    if (detailId == null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-port-more]')) return; // the More overlay closes itself
      e.stopImmediatePropagation();
      setMoreOnOpen(false);
      setUi({ detailId: null });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [detailId, setUi]);

  if (detailId != null) {
    return (
      <PortDetailPage
        id={detailId}
        bigScreen
        initialMore={moreOnOpen}
        onBack={() => setUi({ detailId: null })}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline gap-3 px-10 pt-8">
        <h1 className="text-3xl font-semibold">Native Ports</h1>
        <span className="text-base text-fg-muted">{ports.length} ports</span>
      </div>
      <div className="px-5 pt-4">
        <PortChips ports={all} size="lg" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto scroll-py-10 px-10 py-6">
        {isLoading ? (
          <Spinner label="Loading ports…" />
        ) : shown.length === 0 ? (
          <EmptyState title="No ports here" />
        ) : (
          <FocusSection focusKey="bs-ports" className="space-y-10">
            {groupByConsole(shown).map((g) => (
              <section key={g.slug}>
                <h2 className={HEADING}>
                  <ConsoleLogo slug={g.slug} size="rail" className="text-fg-muted" />
                  {consoles.name(g.slug)}
                </h2>
                <div className={GRID}>
                  {g.ports.map((p) => (
                    <BigScreenPortCard
                      key={p.manifest.id}
                      port={p}
                      coverUrl={art[p.manifest.id]?.coverUrl ?? null}
                      onOpen={(id) => {
                        setMoreOnOpen(false);
                        setUi({ detailId: id });
                      }}
                      onFocus={() => (focused.current = p)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </FocusSection>
        )}
      </div>
    </div>
  );
}

/** 10-foot port card: lift + scale + ring on focus (the Big Screen transform exception). */
function BigScreenPortCard({
  port,
  coverUrl,
  onOpen,
  onFocus,
}: {
  port: RecompDTO;
  coverUrl: string | null;
  onOpen: (id: string) => void;
  onFocus: () => void;
}) {
  const m = port.manifest;
  const busy = isBusyPort(port);
  return (
    <Focusable
      ariaLabel={m.name}
      focusClassName=""
      className="rounded-xl"
      onSelect={() => onOpen(m.id)}
      onFocusChange={(f) => f && onFocus()}
    >
      {(focused) => (
        <div
          className={`overflow-hidden rounded-xl transition-all duration-150 ${
            focused ? '-translate-y-1 scale-[1.04] shadow-e3 ring-2 ring-accent' : ''
          }`}
        >
          <div className="relative aspect-[3/4] w-full bg-black">
            {coverUrl ? (
              <img src={coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-2 to-bg p-3">
                <span className="line-clamp-4 select-none text-center text-xl font-semibold leading-snug text-fg-faint/80">
                  {m.originalTitle}
                </span>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute left-2 top-2">
              {busy ? (
                <span className="block h-3 w-3 animate-pulse rounded-full bg-accent" />
              ) : port.updateAvailable ? (
                <span className="block h-3 w-3 rounded-full bg-accent" />
              ) : port.canPlay ? (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-black/70 text-positive">
                  <Check className="h-4 w-4" />
                </span>
              ) : null}
            </div>
            {m.status === 'beta' && (
              <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-sm font-medium text-warning">
                Beta
              </span>
            )}
            <p className="absolute inset-x-0 bottom-0 line-clamp-2 p-3 text-base font-semibold leading-snug text-fg">{m.name}</p>
          </div>
        </div>
      )}
    </Focusable>
  );
}
