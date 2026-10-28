import { useEffect, useState } from 'react';
import { Play, Download, RefreshCw, Undo2, X, Link2 } from 'lucide-react';
import { FocusSection } from '@renderer/components/Focusable';
import { Button } from '@renderer/components/Button';
import { Badge } from '@renderer/components/Badge';
import { Spinner } from '@renderer/components/Spinner';
import { ConsoleLogo } from '@renderer/components/SystemIcon';
import { PortSettingsCycle } from '@renderer/components/PortSettings';
import { PortProgress } from '@renderer/components/PortProgress';
import { setFocus } from '@renderer/input/spatialNav';
import { useSystems } from '@renderer/query/useSystems';
import { useGames } from '@renderer/query/useGames';
import {
  useRecomps,
  useInstallRecomp,
  useCancelRecomp,
  useRollbackRecomp,
  useLaunchRecomp,
  useLinkRecomp,
  isBusy,
  installLabel,
} from '@renderer/query/useRecomps';
import type { RecompDTO } from '@shared/contracts/recomps';

/**
 * Big Screen Native Ports: one large card per port, every action a focusable button
 * (A selects, B backs out to the rail). No mouse needed anywhere.
 */
export function BigScreenPorts() {
  const { data: ports = [], isLoading } = useRecomps();

  useEffect(() => {
    const r = requestAnimationFrame(() => setFocus('bs-ports'));
    return () => cancelAnimationFrame(r);
  }, []);

  return (
    <div className="h-full overflow-auto scroll-py-10">
      <div className="mx-auto max-w-5xl px-10 py-8">
        <h1 className="mb-6 text-3xl font-semibold">Native Ports</h1>
        {isLoading ? (
          <Spinner label="Loading ports…" />
        ) : (
          <FocusSection focusKey="bs-ports" className="flex flex-col gap-5">
            {ports.map((p) => (
              <PortRow key={p.manifest.id} port={p} />
            ))}
          </FocusSection>
        )}
      </div>
    </div>
  );
}

function PortRow({ port }: { port: RecompDTO }) {
  const m = port.manifest;
  const { data: systems = [] } = useSystems();
  const system = systems.find((s) => s.slug === m.gameFile.systemSlug);
  const { data: games } = useGames({ systemId: system?.id ?? -1, sort: 'title', order: 'asc' });
  const linked = games?.items.find((g) => g.id === port.linkedGameId) ?? null;
  const install = useInstallRecomp();
  const cancel = useCancelRecomp();
  const rollback = useRollbackRecomp();
  const launch = useLaunchRecomp();
  const link = useLinkRecomp();
  const [picking, setPicking] = useState(false);
  const busy = isBusy(port);
  const installed = port.state === 'installed';

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-e1">
      <div className="flex items-center gap-4">
        <ConsoleLogo slug={m.gameFile.systemSlug} size="rail" className="text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-2xl font-semibold">{m.name}</h2>
            <Badge tone={m.status === 'playable' ? 'positive' : 'warning'}>{m.status}</Badge>
            {port.updateAvailable && <Badge tone="accent">Update available</Badge>}
          </div>
          <p className="mt-1 text-base text-fg-muted">
            {linked ? `Uses your copy of ${linked.title}` : `Needs your ${system?.name ?? ''} copy of ${m.originalTitle}`}
          </p>
        </div>
      </div>

      {busy && <PortProgress port={port} size="lg" />}
      {m.build && !installed && !busy && <p className="text-base text-fg-faint">Needs {m.build.requirements}</p>}
      {port.lastError && !busy && <p className="text-base text-danger">{port.lastError}</p>}

      <div className="flex flex-wrap gap-3">
        {busy ? (
          <Button size="lg" variant="secondary" icon={<X className="h-5 w-5" />} onClick={() => cancel.mutate(m.id)}>
            Cancel
          </Button>
        ) : installed ? (
          linked ? (
            <Button
              size="lg"
              variant="primary"
              icon={<Play className="h-5 w-5" fill="currentColor" />}
              disabled={launch.isPending}
              onClick={() => launch.mutate(m.id)}
            >
              {launch.isPending ? 'Starting…' : 'Play'}
            </Button>
          ) : null
        ) : (
          <Button size="lg" variant="primary" icon={<Download className="h-5 w-5" />} onClick={() => install.mutate(m.id)}>
            {installLabel(port)}
          </Button>
        )}
        {!linked && (
          <Button size="lg" variant="secondary" icon={<Link2 className="h-5 w-5" />} onClick={() => setPicking((v) => !v)}>
            Link a game
          </Button>
        )}
        {installed && port.updateAvailable && !busy && (
          <Button size="lg" variant="secondary" icon={<RefreshCw className="h-5 w-5" />} onClick={() => install.mutate(m.id)}>
            {m.build ? 'Rebuild with the latest code' : `Update to ${port.latestTag}`}
          </Button>
        )}
        {installed && port.previousTag && !busy && (
          <Button size="lg" variant="secondary" icon={<Undo2 className="h-5 w-5" />} onClick={() => rollback.mutate(m.id)}>
            Roll back to {port.previousTag}
          </Button>
        )}
      </div>

      {picking && !linked && (
        <div className="flex flex-wrap gap-3">
          {(games?.items ?? []).length === 0 ? (
            <p className="text-base text-fg-faint">No games for this console in your library yet.</p>
          ) : (
            games!.items.map((g) => (
              <Button
                key={g.id}
                size="lg"
                variant="ghost"
                onClick={() => link.mutate({ id: m.id, gameId: g.id }, { onSuccess: () => setPicking(false) })}
              >
                {g.title}
              </Button>
            ))
          )}
        </div>
      )}

      {installed && <PortSettingsCycle manifest={m} />}
    </div>
  );
}
