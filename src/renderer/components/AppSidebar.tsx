import { type ReactNode } from 'react';
import { LayoutGrid, Compass, Boxes, Download, Settings as SettingsIcon, Tv, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { FocusSection, Focusable } from './Focusable';
import { ConsoleLogo } from './SystemIcon';
import { SidebarUpdatePill } from './UpdatePill';
import { useSystems } from '@renderer/query/useSystems';
import { useGames } from '@renderer/query/useGames';
import { useDownloadItems } from '@renderer/query/useDownloads';
import { useUiStore } from '@renderer/store/uiStore';

/**
 * Persistent left navigation: Library at the top, the per-console list below it, and
 * Settings / Big Screen / collapse pinned at the bottom. Transparent (no panel bg,
 * no borders) so the app-wide console backdrop tints it; collapses to an icon rail.
 */
export function AppSidebar() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const setMode = useUiStore((s) => s.setMode);
  const activeSystemId = useUiStore((s) => s.activeSystemId);
  const setActiveSystemId = useUiStore((s) => s.setActiveSystemId);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const { data: systems = [] } = useSystems(true);
  // Library mode lists only consoles you have games saved for (owned or in My List);
  // Browse shows every console. The set comes from the same games query the Library
  // sections render from, so the two can never disagree.
  const { data: libraryGames } = useGames({ sort: 'title', order: 'asc' });
  const librarySystemIds = new Set((libraryGames?.items ?? []).map((g) => g.systemId));
  const visibleSystems = sidebarMode === 'library' ? systems.filter((s) => librarySystemIds.has(s.id)) : systems;
  const { data: downloads = [] } = useDownloadItems();
  const activeDownloads = downloads.filter(
    (d) => d.state === 'downloading' || d.state === 'queued' || d.state === 'verifying',
  ).length;

  const row = (
    key: string,
    label: string,
    icon: ReactNode,
    active: boolean,
    onSelect: () => void,
    badge?: number,
  ): ReactNode => (
    <Focusable key={key} ariaLabel={label} focusClassName="" className="block rounded-md" onSelect={onSelect}>
      {(focused) => (
        <div
          title={collapsed ? label : undefined}
          className={`flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors ${
            collapsed ? 'justify-center' : ''
          } ${
            active
              ? 'bg-accent/15 font-medium text-fg'
              : focused
                ? 'bg-white/10 text-fg'
                : 'text-fg-muted hover:bg-white/5 hover:text-fg'
          }`}
        >
          {icon}
          {!collapsed && (
            <span className="truncate" title={label}>
              {label}
            </span>
          )}
          {!collapsed && badge != null && badge > 0 && (
            <span className="ml-auto rounded-full bg-accent px-1.5 text-2xs font-semibold tabular-nums text-accent-fg">
              {badge}
            </span>
          )}
        </div>
      )}
    </Focusable>
  );

  const boxed = (node: ReactNode, active: boolean): ReactNode => (
    <span className={`flex h-6 w-11 shrink-0 items-center justify-center ${active ? 'text-accent' : ''}`}>{node}</span>
  );

  const iconBtn = (icon: ReactNode, label: string, onClick: () => void): ReactNode => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-white/10 hover:text-fg"
    >
      {icon}
    </button>
  );

  const libraryActive = view === 'library' && activeSystemId == null && sidebarMode === 'library';
  const browseActive = sidebarMode === 'browse' && view !== 'ports';

  return (
    <FocusSection
      className={`flex shrink-0 flex-col overflow-hidden transition-[width] duration-200 ${collapsed ? 'w-20' : 'w-56'}`}
    >
      {/* Library = your saved games only (consoles without any are hidden below);
          Browse = every console, for catalog browsing. */}
      <div className="shrink-0 px-1.5 pb-1 pt-3">
        {row('library', 'Library', boxed(<LayoutGrid className="h-4 w-4" />, libraryActive), libraryActive, () => {
          setSidebarMode('library');
          setActiveSystemId(null);
          setView('library');
        })}
        {row('browse', 'Browse', boxed(<Compass className="h-4 w-4" />, browseActive), browseActive, () => {
          setSidebarMode('browse');
          setView('library');
        })}
        {row('ports', 'Native Ports', boxed(<Boxes className="h-4 w-4" />, view === 'ports'), view === 'ports', () =>
          setView('ports'),
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-1.5">
        {visibleSystems.map((s) => {
          const active = view === 'library' && activeSystemId === s.id;
          return row(
            String(s.id),
            s.name,
            <ConsoleLogo slug={s.slug} className={active ? 'text-accent' : ''} />,
            active,
            () => {
              setActiveSystemId(s.id);
              setView('library');
            },
          );
        })}
      </div>
      <div className="shrink-0 p-1.5">
        <SidebarUpdatePill collapsed={collapsed} />
        {row(
          'downloads',
          'Downloads',
          boxed(<Download className="h-4 w-4" />, view === 'downloads'),
          view === 'downloads',
          () => setView('downloads'),
          activeDownloads,
        )}
        <div className={`mt-1 flex gap-1 ${collapsed ? 'flex-col items-center' : 'items-center'}`}>
          <div className={collapsed ? '' : 'min-w-0 flex-1'}>
            {row(
              'settings',
              'Settings',
              boxed(<SettingsIcon className="h-4 w-4" />, view === 'settings'),
              view === 'settings',
              () => setView('settings'),
            )}
          </div>
          {iconBtn(<Tv className="h-5 w-5" />, 'Big Screen mode', () => setMode('bigscreen'))}
          {iconBtn(
            collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />,
            collapsed ? 'Expand sidebar' : 'Collapse sidebar',
            toggleSidebar,
          )}
        </div>
      </div>
    </FocusSection>
  );
}
