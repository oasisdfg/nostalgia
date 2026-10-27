import { useState } from 'react';
import { Boxes, Play, Download, RefreshCw, X, ExternalLink, FolderOpen, Trash2, Link2, Unlink, Check } from 'lucide-react';
import { FocusSection, Focusable } from './Focusable';
import { Button } from './Button';
import { Badge } from './Badge';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';
import { ConsoleLogo } from './SystemIcon';
import { invoke } from '@renderer/bridge/ipc';
import { well } from '@renderer/theme/classes';
import { useSystems } from '@renderer/query/useSystems';
import { useGames } from '@renderer/query/useGames';
import {
  useRecomps,
  useRecompProgress,
  useInstallRecomp,
  useCancelRecomp,
  useUninstallRecomp,
  useLinkRecomp,
  useUnlinkRecomp,
  useLaunchRecomp,
  useRevealRecompInstall,
  useCheckRecompUpdates,
  isBusy,
  busyLabel,
} from '@renderer/query/useRecomps';
import type { RecompDTO } from '@shared/contracts/recomps';

/**
 * Native Ports: fan-made PC builds of console games that run from the user's own copy.
 * One card per registry entry - install state, the linked library game, and actions.
 */
export function PortsView() {
  const { data: ports = [], isLoading } = useRecomps();
  const check = useCheckRecompUpdates();

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Native Ports</h1>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              PC versions of console games, built by fans. Each one runs from your own copy of the original game and
              becomes a second way to play it.
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<RefreshCw className={`h-4 w-4 ${check.isPending ? 'animate-spin' : ''}`} />}
            disabled={check.isPending}
            onClick={() => check.mutate(undefined)}
          >
            {check.isPending ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>
        {isLoading ? (
          <Spinner label="Loading ports…" />
        ) : ports.length === 0 ? (
          <EmptyState icon={<Boxes className="h-6 w-6" />} title="No ports available" />
        ) : (
          <FocusSection className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {ports.map((p) => (
              <PortCard key={p.manifest.id} port={p} />
            ))}
          </FocusSection>
        )}
      </div>
    </div>
  );
}

function PortCard({ port }: { port: RecompDTO }) {
  const m = port.manifest;
  const { data: systems = [] } = useSystems();
  const system = systems.find((s) => s.slug === m.gameFile.systemSlug);
  const { data: games } = useGames({ systemId: system?.id ?? -1, sort: 'title', order: 'asc' });
  const linked = games?.items.find((g) => g.id === port.linkedGameId) ?? null;
  const progress = useRecompProgress(m.id);
  const install = useInstallRecomp();
  const cancel = useCancelRecomp();
  const uninstall = useUninstallRecomp();
  const unlink = useUnlinkRecomp();
  const launch = useLaunchRecomp();
  const reveal = useRevealRecompInstall();
  const [picking, setPicking] = useState(false);

  const busy = isBusy(port);
  const installed = port.state === 'installed';

  const primary = busy ? (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-fg-muted">{busyLabel(port, progress)}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
          {port.state === 'verifying' ? (
            <div className="h-full w-full animate-pulse rounded-full bg-accent/40" />
          ) : (
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }}
            />
          )}
        </div>
      </div>
      <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => cancel.mutate(m.id)}>
        Cancel
      </Button>
    </div>
  ) : installed ? (
    <Button
      variant="primary"
      icon={<Play className="h-4 w-4" fill="currentColor" />}
      disabled={port.linkedGameId == null || launch.isPending}
      title={port.linkedGameId == null ? `Link your copy of ${m.originalTitle} first` : undefined}
      onClick={() => launch.mutate(m.id)}
    >
      {launch.isPending ? 'Starting…' : 'Play'}
    </Button>
  ) : (
    <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => install.mutate(m.id)}>
      {port.state === 'failed' ? 'Try again' : 'Install'}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-surface p-5 shadow-e1">
      <div className="flex items-start gap-3">
        <ConsoleLogo slug={m.gameFile.systemSlug} className="mt-0.5 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-fg">{m.name}</h2>
            <Badge tone={m.status === 'playable' ? 'positive' : 'warning'}>{m.status}</Badge>
            {port.updateAvailable && <Badge tone="accent">Update available</Badge>}
          </div>
          <p className="mt-0.5 text-2xs text-fg-faint">
            {m.originalTitle}
            {installed && port.installedTag ? ` · ${port.installedTag}` : ''}
          </p>
        </div>
      </div>

      <p className="text-sm text-fg-muted">{m.summary}</p>

      {/* The game it runs from: linked (and whether the dump is a known-good one), or a prompt. */}
      <div className={`${well} px-3 py-2 text-2xs`}>
        {linked ? (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-fg">
              {port.fileVerified && <Check className="mr-1 inline h-3.5 w-3.5 text-positive" />}
              Uses your copy of <span className="font-medium">{linked.title}</span>
            </span>
            <Button variant="ghost" size="sm" icon={<Unlink className="h-3.5 w-3.5" />} onClick={() => unlink.mutate(m.id)}>
              Unlink
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-fg-muted">
              Needs your {system?.name ?? m.gameFile.systemSlug} copy of {m.originalTitle}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<Link2 className="h-3.5 w-3.5" />}
              onClick={() => setPicking((v) => !v)}
            >
              Link a game…
            </Button>
          </div>
        )}
        {picking && !linked && (
          <GamePicker
            recompId={m.id}
            games={games?.items ?? []}
            onDone={() => setPicking(false)}
          />
        )}
      </div>

      {port.lastError && !busy && <p className="text-2xs text-danger">{port.lastError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {installed && port.updateAvailable && !busy && (
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => install.mutate(m.id)}>
            Update to {port.latestTag}
          </Button>
        )}
        <Button
          variant="ghost"
          icon={<ExternalLink className="h-4 w-4" />}
          onClick={() => void invoke('app:openExternal', { url: m.homepage })}
        >
          Project page
        </Button>
        {installed && !busy && (
          <>
            <Button variant="ghost" icon={<FolderOpen className="h-4 w-4" />} onClick={() => reveal.mutate(m.id)}>
              Show files
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              disabled={uninstall.isPending}
              onClick={() => uninstall.mutate(m.id)}
            >
              Uninstall
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Manual link: pick the game from the library games on the port's console. */
function GamePicker({
  recompId,
  games,
  onDone,
}: {
  recompId: string;
  games: { id: number; title: string }[];
  onDone: () => void;
}) {
  const link = useLinkRecomp();
  if (games.length === 0) {
    return <p className="mt-2 text-fg-faint">No games for this console in your library yet.</p>;
  }
  return (
    <FocusSection className="mt-2 max-h-48 overflow-auto">
      {games.map((g) => (
        <Focusable
          key={g.id}
          ariaLabel={g.title}
          focusClassName=""
          className="block rounded-md"
          onSelect={() => link.mutate({ id: recompId, gameId: g.id }, { onSuccess: onDone })}
        >
          {(focused) => (
            <div
              className={`truncate rounded-md px-2 py-1.5 text-xs transition-colors ${
                focused ? 'bg-white/10 text-fg' : 'text-fg-muted hover:bg-white/5 hover:text-fg'
              }`}
            >
              {g.title}
            </div>
          )}
        </Focusable>
      ))}
    </FocusSection>
  );
}
