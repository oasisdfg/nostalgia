import { Play, Download, X, RefreshCw, FolderOpen, Undo2 } from 'lucide-react';
import { Button } from './Button';
import {
  useRecompProgress,
  useInstallRecomp,
  useCancelRecomp,
  useRollbackRecomp,
  useLaunchRecomp,
  useRevealRecompGameFile,
  isBusy,
  busyLabel,
} from '@renderer/query/useRecomps';
import type { RecompDTO } from '@shared/contracts/recomps';

/**
 * One Native Port's action on a game page: "Install <port>" (with inline progress), or
 * "Play (<port>)" once installed - plus the update action and, for ports that ask for the
 * game file themselves, a first-launch hint with a Reveal button.
 */
export function PortPlayButton({
  port,
  primary,
  fileName,
  onPlay,
}: {
  port: RecompDTO;
  /** The user's last choice for this game - drawn as the primary button. */
  primary: boolean;
  /** display_name of the game file the port needs (for the in-app picker hint). */
  fileName: string | null;
  onPlay: () => void;
}) {
  const m = port.manifest;
  const progress = useRecompProgress(m.id);
  const install = useInstallRecomp();
  const cancel = useCancelRecomp();
  const launch = useLaunchRecomp();
  const reveal = useRevealRecompGameFile();
  const rollback = useRollbackRecomp();

  if (isBusy(port)) {
    return (
      <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-fg-muted">
            {m.name}: {busyLabel(port, progress)}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg/70">
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
    );
  }

  if (port.state !== 'installed') {
    return (
      <Button
        variant={primary ? 'primary' : 'secondary'}
        size="lg"
        fullWidth
        icon={<Download className="h-5 w-5" />}
        disabled={install.isPending}
        onClick={() => install.mutate(m.id)}
      >
        Install {m.name}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Button
            variant={primary ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            icon={<Play className="h-5 w-5" fill="currentColor" />}
            disabled={launch.isPending}
            onClick={() => {
              onPlay();
              launch.mutate(m.id);
            }}
          >
            {launch.isPending ? 'Starting…' : `Play (${m.name})`}
          </Button>
        </div>
        {port.updateAvailable && (
          <Button
            variant="secondary"
            size="lg"
            icon={<RefreshCw className="h-5 w-5" />}
            title={`Update ${m.name} to ${port.latestTag}`}
            onClick={() => install.mutate(m.id)}
          >
            Update
          </Button>
        )}
      </div>
      {port.previousTag && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Undo2 className="h-3.5 w-3.5" />}
          disabled={rollback.isPending}
          onClick={() => rollback.mutate(m.id)}
        >
          Roll back {m.name} to {port.previousTag}
        </Button>
      )}
      {m.gameFile.delivery === 'in-app' && !port.fileDelivered && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-bg/60 px-3 py-2 shadow-inset-1">
          <p className="min-w-0 text-2xs text-fg-muted">
            This port asks for your game file the first time. Choose:{' '}
            <span className="font-medium text-fg">{fileName ?? m.originalTitle}</span>
          </p>
          <Button variant="ghost" size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => reveal.mutate(m.id)}>
            Reveal
          </Button>
        </div>
      )}
    </div>
  );
}
