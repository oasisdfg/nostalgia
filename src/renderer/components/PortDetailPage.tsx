import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Play,
  Download,
  Hammer,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Undo2,
  FileText,
  Trash2,
  X,
  Check,
} from 'lucide-react';
import { Button } from './Button';
import { Badge } from './Badge';
import { EmptyState } from './EmptyState';
import { FocusSection, Focusable } from './Focusable';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { PortProgress } from './PortProgress';
import { PortSettings, PortSettingsCycle, portSettingOptions } from './PortSettings';
import { useConsoles, isBusyPort, METHOD_LABEL } from './portsModel';
import { invoke } from '@renderer/bridge/ipc';
import { well } from '@renderer/theme/classes';
import { setFocus } from '@renderer/input/spatialNav';
import { GP_EVENT } from '@renderer/input/gamepad';
import { useUiStore } from '@renderer/store/uiStore';
import { useSystems } from '@renderer/query/useSystems';
import { useGames } from '@renderer/query/useGames';
import {
  useRecomps,
  useRecompArt,
  useInstallRecomp,
  useCancelRecomp,
  useLaunchRecomp,
  useRollbackRecomp,
  useUninstallRecomp,
  useLinkRecomp,
  useUnlinkRecomp,
  usePickRecompFiles,
  useClearRecompPicked,
  useLocateRecompExe,
  useRevealRecompInstall,
  useRevealRecompBuildLog,
} from '@renderer/query/useRecomps';
import type { RecompDTO } from '@shared/contracts/recomps';

/**
 * A Native Port's page, modelled on CatalogDetailPage: the original game's art fills the app
 * backdrop, the cover sits left, and a raised panel holds what the user acts on - one primary
 * button chosen by state, the "Your copy" block, settings, and everything else under More.
 * Desktop uses a mouse context menu for More; Big Screen gets a focusable overlay (Y), and X
 * plays.
 */
export function PortDetailPage({
  id,
  onBack,
  bigScreen = false,
  initialMore = false,
}: {
  id: string;
  onBack: () => void;
  bigScreen?: boolean;
  /** Big Screen: open with the More menu showing (Y on a grid card). */
  initialMore?: boolean;
}) {
  const { data: ports } = useRecomps();
  const port = ports?.find((p) => p.manifest.id === id);
  const art = useRecompArt([id]).data?.[id];
  const coverUrl = art?.coverUrl ?? null;

  const setDetailBackdropUrl = useUiStore((s) => s.setDetailBackdropUrl);
  const backdrop = art?.heroUrl ?? art?.coverUrl ?? null;
  useEffect(() => {
    setDetailBackdropUrl(backdrop);
    return () => setDetailBackdropUrl(null);
  }, [backdrop, setDetailBackdropUrl]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {!bigScreen && (
        <div className="relative z-10 flex h-14 shrink-0 items-center gap-3 px-5">
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>
            Back
          </Button>
        </div>
      )}
      <div className="relative z-10 min-h-0 flex-1 overflow-auto">
        {!port ? (
          <EmptyState title="Port not found" />
        ) : (
          <PortDetailBody port={port} coverUrl={coverUrl} bigScreen={bigScreen} initialMore={initialMore} />
        )}
      </div>
    </div>
  );
}

function PortDetailBody({
  port,
  coverUrl,
  bigScreen,
  initialMore,
}: {
  port: RecompDTO;
  coverUrl: string | null;
  bigScreen: boolean;
  initialMore: boolean;
}) {
  const m = port.manifest;
  const consoles = useConsoles();
  const consoleName = consoles.name(m.gameFile.systemSlug);
  const busy = isBusyPort(port);
  const installed = port.state === 'installed';
  const external = m.assetKind === 'external' && !m.build;

  const install = useInstallRecomp();
  const cancel = useCancelRecomp();
  const launch = useLaunchRecomp();
  const rollback = useRollbackRecomp();
  const uninstall = useUninstallRecomp();
  const locate = useLocateRecompExe();
  const revealInstall = useRevealRecompInstall();
  const buildLog = useRevealRecompBuildLog();
  const clearPicked = useClearRecompPicked();

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [bsMenu, setBsMenu] = useState(bigScreen && initialMore);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  const size = bigScreen ? 'lg' : 'md';
  const openProject = (): void => void invoke('app:openExternal', { url: m.homepage });

  const moreItems: ContextMenuItem[] = [
    { label: 'Project page', icon: <ExternalLink className="h-4 w-4" />, onClick: openProject },
  ];
  if (installed) {
    moreItems.push({ label: 'Show files', icon: <FolderOpen className="h-4 w-4" />, onClick: () => revealInstall.mutate(m.id) });
  }
  if (installed && port.previousTag) {
    moreItems.push({
      label: `Roll back to ${port.previousTag}`,
      icon: <Undo2 className="h-4 w-4" />,
      onClick: () => rollback.mutate(m.id),
    });
  }
  if (m.build) moreItems.push({ label: 'Show build log', icon: <FileText className="h-4 w-4" />, onClick: () => buildLog.mutate(m.id) });
  if (port.pickedName) {
    moreItems.push({ label: 'Clear picked files', icon: <X className="h-4 w-4" />, onClick: () => clearPicked.mutate(m.id) });
  }
  if (installed) {
    moreItems.push({
      label: external ? 'Forget this install' : 'Uninstall',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      onClick: () => setConfirmUninstall(true),
    });
  }

  // Big Screen: X plays, Y opens More.
  useEffect(() => {
    if (!bigScreen) return;
    const onX = (): void => {
      if (port.canPlay) launch.mutate(m.id);
    };
    const onY = (): void => setBsMenu(true);
    window.addEventListener(GP_EVENT.x, onX);
    window.addEventListener(GP_EVENT.y, onY);
    return () => {
      window.removeEventListener(GP_EVENT.x, onX);
      window.removeEventListener(GP_EVENT.y, onY);
    };
  }, [bigScreen, port.canPlay, m.id, launch]);

  // Land controller focus on the primary action when the page opens on Big Screen.
  useEffect(() => {
    if (!bigScreen) return;
    const r = requestAnimationFrame(() => setFocus('port-primary'));
    return () => cancelAnimationFrame(r);
  }, [bigScreen, m.id]);

  // One primary button, chosen by state.
  let primary: ReactNode;
  if (busy) {
    primary = (
      <div className="flex items-center gap-3">
        <PortProgress port={port} size={bigScreen ? 'lg' : 'sm'} />
        <Button focusKey="port-primary" size={size} variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => cancel.mutate(m.id)}>
          Cancel
        </Button>
      </div>
    );
  } else if (installed) {
    primary = (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          focusKey="port-primary"
          size={size}
          variant="primary"
          icon={<Play className="h-4 w-4" fill="currentColor" />}
          disabled={!port.canPlay || launch.isPending}
          title={port.canPlay ? undefined : `Link your copy of ${m.originalTitle} first`}
          onClick={() => launch.mutate(m.id)}
        >
          {launch.isPending ? 'Starting…' : 'Play'}
        </Button>
        {port.updateAvailable && (
          <Button
            size={size}
            variant="secondary"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => (external ? openProject() : install.mutate(m.id))}
          >
            {external ? 'New version on project page' : m.build ? 'Rebuild with the latest code' : `Update to ${port.latestTag}`}
          </Button>
        )}
      </div>
    );
  } else if (external) {
    primary = (
      <div className="flex flex-wrap items-center gap-2">
        <Button focusKey="port-primary" size={size} variant="primary" icon={<ExternalLink className="h-4 w-4" />} onClick={openProject}>
          Get from project page
        </Button>
        <Button size={size} variant="secondary" icon={<FolderOpen className="h-4 w-4" />} onClick={() => locate.mutate(m.id)}>
          Locate exe…
        </Button>
      </div>
    );
  } else {
    primary = (
      <Button
        focusKey="port-primary"
        size={size}
        variant="primary"
        icon={m.build ? <Hammer className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        disabled={install.isPending}
        onClick={() => install.mutate(m.id)}
      >
        {port.state === 'failed' ? 'Try again' : m.build ? 'Build' : 'Install'}
      </Button>
    );
  }

  const facts = [
    METHOD_LABEL[m.method],
    port.installedTag && installed ? `Installed ${port.installedTag}` : null,
    port.latestTag ? `Latest ${port.latestTag}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-7 animate-fade-in md:flex-row md:items-start">
      <div className={`shrink-0 overflow-hidden rounded-lg bg-black shadow-e2 ${bigScreen ? 'w-72' : 'w-56'} aspect-[3/4]`}>
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-2 to-bg p-4">
            <span className="text-center text-base font-semibold text-fg-faint/80">{m.originalTitle}</span>
          </div>
        )}
      </div>

      <FocusSection className="min-w-0 flex-1 space-y-5 rounded-xl bg-surface/85 p-6 shadow-e2 backdrop-blur">
        <div>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className={`${bigScreen ? 'text-3xl' : 'text-2xl'} font-semibold tracking-tightish`}>{m.name}</h1>
              <p className={`mt-1 ${bigScreen ? 'text-base' : 'text-sm'} text-fg-muted`}>
                {m.originalTitle} · {consoleName}
              </p>
            </div>
            {m.status === 'beta' && <Badge tone="warning">Beta</Badge>}
          </div>
          <p className={`mt-3 ${bigScreen ? 'text-base' : 'text-sm'} text-fg-muted`}>{m.summary}</p>
          <p className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 ${bigScreen ? 'text-sm' : 'text-2xs'} text-fg-muted`}>
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </p>
          {m.build && !installed && <p className="mt-2 text-2xs text-fg-faint">Needs {m.build.requirements}</p>}
        </div>

        <YourCopy port={port} consoleName={consoleName} bigScreen={bigScreen} />

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {primary}
            <span ref={moreRef} className="ml-auto">
              <Button
                size={size}
                variant="ghost"
                icon={<MoreHorizontal className="h-4 w-4" />}
                onClick={() => {
                  if (bigScreen) return setBsMenu(true);
                  const r = moreRef.current?.getBoundingClientRect();
                  setMenu({ x: r ? r.left : 0, y: r ? r.bottom + 4 : 0 });
                }}
              >
                More
              </Button>
            </span>
          </div>
          {port.lastError && !busy && <p className={`${bigScreen ? 'text-sm' : 'text-2xs'} text-danger`}>{port.lastError}</p>}
          {launch.isError && (
            <p className="text-2xs text-danger">{launch.error instanceof Error ? launch.error.message : "Couldn't start it."}</p>
          )}
          {confirmUninstall && (
            <div className={`${well} flex flex-wrap items-center justify-between gap-3 px-3 py-2`}>
              <p className="text-2xs text-fg">
                {external
                  ? `Forget where ${m.name} is installed? Its files stay where they are.`
                  : `Uninstall ${m.name}? Your game and its saves stay.`}
              </p>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmUninstall(false)}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setConfirmUninstall(false);
                    uninstall.mutate(m.id);
                  }}
                >
                  {external ? 'Forget' : 'Uninstall'}
                </Button>
              </span>
            </div>
          )}
        </div>

        {portSettingOptions(m).length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Settings</h2>
            {bigScreen ? <PortSettingsCycle manifest={m} /> : <PortSettings manifest={m} />}
          </div>
        )}
      </FocusSection>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={moreItems} onClose={() => setMenu(null)} />}
      {bsMenu && <BigScreenMore items={moreItems} onClose={() => setBsMenu(false)} />}
    </div>
  );
}

/** "Your copy": the linked library game or picked files - or how to provide one. */
function YourCopy({ port, consoleName, bigScreen }: { port: RecompDTO; consoleName: string; bigScreen: boolean }) {
  const m = port.manifest;
  const { data: systems = [] } = useSystems(false);
  const system = systems.find((s) => s.slug === m.gameFile.systemSlug);
  const { data: games } = useGames({ systemId: system?.id ?? -1, sort: 'title', order: 'asc' });
  const linked = games?.items.find((g) => g.id === port.linkedGameId) ?? null;
  const link = useLinkRecomp();
  const unlink = useUnlinkRecomp();
  const pick = usePickRecompFiles();
  const clearPicked = useClearRecompPicked();
  const [changing, setChanging] = useState(false);
  const text = bigScreen ? 'text-base' : 'text-xs';
  const verified = port.gameReady === 'verified';

  const textButton = (label: string, onClick: () => void): ReactNode => (
    <Focusable ariaLabel={label} onSelect={onClick} className="inline-flex rounded">
      <span className={`cursor-pointer font-semibold text-accent hover:underline ${text}`}>{label}</span>
    </Focusable>
  );

  const showPicker = port.gameReady === 'missing' || changing;
  const libraryGames = m.gameFile.source === 'library' ? (games?.items ?? []) : [];

  return (
    <div className={`${well} space-y-2 px-4 py-3`}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Your copy</h2>
      {port.linkedGameId != null && !changing ? (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${text}`}>
          <span className="min-w-0 text-fg">
            {verified && <Check className="mr-1 inline h-3.5 w-3.5 text-positive" />}
            Uses your copy of <span className="font-medium">{linked?.title ?? m.originalTitle}</span>
            {!verified && <span className="text-fg-muted"> · unverified dump</span>}
          </span>
          {textButton('Change', () => setChanging(true))}
          {textButton('Unlink', () => unlink.mutate(m.id))}
        </div>
      ) : port.pickedName && !changing ? (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${text}`}>
          <span className="min-w-0 truncate text-fg">
            {verified && <Check className="mr-1 inline h-3.5 w-3.5 text-positive" />}
            <span className="font-medium">{port.pickedName}</span>
            {!verified && <span className="text-fg-muted"> · unverified dump</span>}
          </span>
          {textButton('Change', () => pick.mutate(m.id))}
          {textButton('Unlink', () => clearPicked.mutate(m.id))}
        </div>
      ) : null}

      {showPicker && (
        <div className="space-y-2">
          <p className={`${text} text-fg-muted`}>
            Needs your {consoleName} copy of {m.originalTitle}
          </p>
          {libraryGames.length > 0 && (
            <FocusSection className="max-h-48 overflow-auto">
              {libraryGames.map((g) => (
                <Focusable
                  key={g.id}
                  ariaLabel={g.title}
                  focusClassName=""
                  className="block rounded-md"
                  onSelect={() => link.mutate({ id: m.id, gameId: g.id }, { onSuccess: () => setChanging(false) })}
                >
                  {(focused) => (
                    <div
                      className={`truncate rounded-md px-2 py-1.5 ${text} transition-colors ${
                        focused ? 'bg-white/10 text-fg' : 'text-fg-muted hover:bg-white/5 hover:text-fg'
                      }`}
                    >
                      {g.title}
                    </div>
                  )}
                </Focusable>
              ))}
            </FocusSection>
          )}
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${text}`}>
            {textButton(libraryGames.length > 0 ? 'or choose files…' : 'Choose files…', () =>
              pick.mutate(m.id, { onSuccess: () => setChanging(false) }),
            )}
            {m.gameFile.pickHint && <span className="text-fg-faint">{m.gameFile.pickHint}</span>}
            {changing && textButton('Keep current', () => setChanging(false))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Big Screen "More": a focusable overlay list (the desktop context menu is mouse-only). */
function BigScreenMore({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const r = requestAnimationFrame(() => setFocus('port-more'));
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
      requestAnimationFrame(() => setFocus('port-primary'));
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <div data-port-more className="absolute inset-0 z-50 grid place-items-center bg-black/70">
      <FocusSection focusKey="port-more" className="w-80 rounded-2xl bg-overlay p-6 shadow-e3 animate-pop-in">
        <h2 className="mb-4 text-xl font-semibold">More</h2>
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <Button
              key={it.label}
              size="lg"
              variant={it.danger ? 'danger' : 'secondary'}
              fullWidth
              icon={it.icon}
              onClick={() => {
                it.onClick();
                onClose();
              }}
            >
              {it.label}
            </Button>
          ))}
        </div>
      </FocusSection>
    </div>
  );
}
