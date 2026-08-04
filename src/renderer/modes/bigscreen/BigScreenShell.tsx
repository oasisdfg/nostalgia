import { useEffect, useState, useCallback, useRef } from 'react';
import { useUiStore } from '@renderer/store/uiStore';
import { useSystems } from '@renderer/query/useSystems';
import { useDownloadEvents } from '@renderer/query/useDownloads';
import { useLaunchEvents } from '@renderer/query/useLaunch';
import { useScrapeEvents } from '@renderer/query/useScrape';
import { useSavesEvents } from '@renderer/query/useSaves';
import { invoke } from '@renderer/bridge/ipc';
import { FocusProvider, setFocus, getCurrentFocusKey, doesFocusableExist } from '@renderer/input/spatialNav';
import { startGamepad, GP_EVENT } from '@renderer/input/gamepad';
import { ButtonHints, type ButtonHint } from '@renderer/components/ButtonHints';
import { BigScreenBrowse } from './BigScreenBrowse';
import { BigScreenDetail } from './BigScreenDetail';
import { BigScreenMenu } from './BigScreenMenu';

/** Move spatial focus on the next frame, after the target has mounted/registered. */
const focusSoon = (key: string): void => {
  requestAnimationFrame(() => setFocus(key));
};

export function BigScreenShell() {
  useDownloadEvents();
  useLaunchEvents();
  useScrapeEvents();
  useSavesEvents();

  const setMode = useUiStore((s) => s.setMode);
  const activeSystemId = useUiStore((s) => s.activeSystemId);
  const setActiveSystemId = useUiStore((s) => s.setActiveSystemId);
  const { data: systems = [] } = useSystems(true);

  const [view, setView] = useState<'browse' | 'detail'>('browse');
  const [selectedIgdbId, setSelectedIgdbId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Latest state for the long-lived window event handlers.
  const stateRef = useRef({ view, menuOpen, systems, activeSystemId });
  stateRef.current = { view, menuOpen, systems, activeSystemId };

  // Land on a console so a catalog grid is visible immediately.
  useEffect(() => {
    if (activeSystemId == null && systems.length > 0) setActiveSystemId(systems[0].id);
  }, [activeSystemId, systems, setActiveSystemId]);

  // Real OS fullscreen + gamepad polling for the lifetime of Big Screen.
  useEffect(() => {
    void invoke('window:setFullscreen', { fullscreen: true });
    const stop = startGamepad();
    focusSoon('bs-rail');
    return () => {
      stop();
      void invoke('window:setFullscreen', { fullscreen: false });
    };
  }, []);

  // Bumpers cycle systems; Start/Guide toggles the menu.
  useEffect(() => {
    const jump = (delta: number): void => {
      const { systems: list, activeSystemId: cur } = stateRef.current;
      if (list.length === 0) return;
      const idx = list.findIndex((s) => s.id === cur);
      const next = list[(Math.max(0, idx) + delta + list.length) % list.length];
      setActiveSystemId(next.id);
      setView('browse');
      setSelectedIgdbId(null);
      focusSoon(`bs-rail-${next.id}`);
    };
    const onPrev = (): void => jump(-1);
    const onNext = (): void => jump(1);
    const onMenu = (): void => {
      const st = stateRef.current;
      if (st.menuOpen) {
        setMenuOpen(false);
        // Restore focus to what's actually mounted under the menu - the rail only
        // exists in browse; focusing it from detail left spatial focus on the
        // unmounted menu button and the d-pad went dead.
        focusSoon(st.view === 'detail' ? 'bs-detail-action' : 'bs-rail');
      } else {
        setMenuOpen(true);
      }
    };
    window.addEventListener(GP_EVENT.prevSystem, onPrev);
    window.addEventListener(GP_EVENT.nextSystem, onNext);
    window.addEventListener(GP_EVENT.menu, onMenu);
    return () => {
      window.removeEventListener(GP_EVENT.prevSystem, onPrev);
      window.removeEventListener(GP_EVENT.nextSystem, onNext);
      window.removeEventListener(GP_EVENT.menu, onMenu);
    };
  }, [setActiveSystemId]);

  // Focus recovery: if the focused node unmounted (grid page flip, a view/menu
  // transition, a refetch replacing cards), spatial nav is left pointing at nothing
  // and every d-pad press silently no-ops - the "controller randomly stops working"
  // bug. On any nav key, check the current focus still exists and re-seat it on the
  // active view's root if not (worst case the recovering press is consumed and the
  // next one navigates normally).
  useEffect(() => {
    const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']);
    const recover = (e: KeyboardEvent): void => {
      if (!NAV_KEYS.has(e.key)) return;
      const current = getCurrentFocusKey();
      if (current && doesFocusableExist(current)) return;
      const st = stateRef.current;
      setFocus(st.menuOpen ? 'bs-menu' : st.view === 'detail' ? 'bs-detail-action' : 'bs-grid');
    };
    window.addEventListener('keydown', recover, true);
    return () => window.removeEventListener('keydown', recover, true);
  }, []);

  // B / Escape: close the menu, else back out of detail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const st = stateRef.current;
      if (st.menuOpen) {
        setMenuOpen(false);
        focusSoon(st.view === 'detail' ? 'bs-detail-action' : 'bs-rail');
      } else if (st.view === 'detail') {
        setView('browse');
        setSelectedIgdbId(null);
        focusSoon('bs-grid');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openDetail = useCallback((igdbId: number) => {
    setSelectedIgdbId(igdbId);
    setView('detail');
  }, []);
  const enterGrid = useCallback(() => focusSoon('bs-grid'), []);
  const exit = useCallback(() => setMode('desktop'), [setMode]);

  // The header is gone (10-foot canvas is all content), so the ☰ hint doubles as the
  // mouse path into the menu - it's clickable.
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const hints: ButtonHint[] = menuOpen
    ? [
        { glyph: 'A', label: 'Select', tone: 'bg-positive/20 text-positive' },
        { glyph: 'B', label: 'Close', tone: 'bg-danger/20 text-danger' },
      ]
    : view === 'detail'
      ? [
          { glyph: '✛', label: 'Move' },
          { glyph: 'A', label: 'Select', tone: 'bg-positive/20 text-positive' },
          { glyph: 'B', label: 'Back', tone: 'bg-danger/20 text-danger' },
          { glyph: '☰', label: 'Menu', onClick: openMenu },
        ]
      : [
          { glyph: '✛', label: 'Move' },
          { glyph: 'A', label: 'Open', tone: 'bg-positive/20 text-positive' },
          { glyph: 'LB', label: 'Prev' },
          { glyph: 'RB', label: 'Next system' },
          { glyph: '☰', label: 'Menu', onClick: openMenu },
        ];

  return (
    <FocusProvider>
      <div className="relative flex h-screen flex-col bg-bg text-fg">
        <div className="min-h-0 flex-1">
          {view === 'detail' && selectedIgdbId != null && activeSystemId != null ? (
            <BigScreenDetail igdbId={selectedIgdbId} systemId={activeSystemId} />
          ) : (
            <BigScreenBrowse
              systems={systems}
              activeSystemId={activeSystemId}
              onPreview={setActiveSystemId}
              onEnterGrid={enterGrid}
              onOpen={openDetail}
            />
          )}
        </div>

        <ButtonHints hints={hints} />
        {menuOpen && (
          <BigScreenMenu
            onResume={() => {
              setMenuOpen(false);
              focusSoon(view === 'detail' ? 'bs-detail-action' : 'bs-rail');
            }}
            onExit={exit}
          />
        )}
      </div>
    </FocusProvider>
  );
}
