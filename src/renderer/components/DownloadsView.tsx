import { Download, Pause, Play, X, RotateCcw } from 'lucide-react';
import { FocusSection } from './Focusable';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';
import { SystemIcon } from './SystemIcon';
import {
  useDownloadItems,
  useDownloadProgress,
  usePauseDownload,
  useResumeDownload,
  useCancelDownload,
} from '@renderer/query/useDownloads';
import { useGuardedLaunch } from '@renderer/query/useLaunch';
import { formatSize } from '@renderer/query/useCatalog';
import type { DownloadItemDTO, DownloadState } from '@shared/contracts/ipc';

const STATE_LABEL: Record<DownloadState, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  verifying: 'Verifying',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
};

function formatRate(bps: number): string {
  if (bps <= 0) return '';
  const mb = bps / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bps / 1024)} KB/s`;
}
function formatEta(remaining: number, bps: number): string {
  if (bps <= 0 || remaining <= 0) return '';
  const s = Math.round(remaining / bps);
  if (s < 60) return `${s}s left`;
  if (s < 3600) return `${Math.round(s / 60)}m left`;
  return `${(s / 3600).toFixed(1)}h left`;
}

/**
 * One download row. Reads live progress from the global store (keyed by gameFileId,
 * fed by the throttled download events) and falls back to the list snapshot, so a
 * download started on a detail page keeps reporting here even after that page is gone.
 */
function DownloadRow({ item }: { item: DownloadItemDTO }) {
  const live = useDownloadProgress((st) => st.byFile[item.gameFileId]);
  const pause = usePauseDownload();
  const resume = useResumeDownload();
  const cancel = useCancelDownload();
  const launch = useGuardedLaunch();

  const state: DownloadState = live?.state ?? item.state;
  const total = live?.bytesTotal ?? item.bytesTotal ?? item.sizeBytes ?? null;
  const received = live?.bytesReceived ?? item.bytesReceived;
  const fraction = live?.fraction ?? (total ? received / total : null);
  const pct = fraction != null ? Math.round(fraction * 100) : null;
  const bps = live?.bytesPerSecond ?? 0;
  const remaining = total != null ? total - received : 0;

  const active = state === 'downloading' || state === 'queued' || state === 'verifying';
  const failed = state === 'failed';
  const completed = state === 'completed';
  // Determinate only when we actually have a percentage; queued/verifying with no
  // bytes yet shows an indeterminate pulse rather than a misleading fixed fill.
  const indeterminate = pct == null && active;

  // Right-hand stats, joined by ' · ' so an empty field never leaves a stray separator.
  const stats = [
    total != null ? `${formatSize(received)} / ${formatSize(total)}` : '',
    formatRate(bps),
    bps > 0 && remaining > 0 ? formatEta(remaining, bps) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex min-h-[8.5rem] items-center gap-5 rounded-lg bg-surface/40 p-4">
      {/* Cached covers are full-size LaunchBox scans (760×1073 up to 1526×2172), so the
          softness was never the source - it was squeezing one into ~65px wide. Rendering
          bigger cuts the downscale ratio, and the box keeps the ~0.706 case aspect so
          object-cover crops essentially nothing. */}
      <div className="h-[6.75rem] w-[4.75rem] shrink-0 overflow-hidden rounded-md bg-surface-2 shadow-e1">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt=""
            // Decoding off the main thread keeps a long list of multi-MB scans from
            // janking the row as it paints.
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-fg-faint">
            <SystemIcon slug={item.systemSlug} className="h-8 w-8" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Completed rows are just the title + Play: the console name, the checkmark and
            the "Ready to play · size" line were noise on a row that is already, by being
            under COMPLETED, obviously ready. */}
        <p className="truncate text-base font-semibold text-fg">{item.title}</p>
        {!completed && (
          <>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-fg-muted">
              <span className={`min-w-0 truncate ${failed ? 'text-danger' : ''}`}>
                {!failed && <span className="text-fg-faint">{item.systemName} · </span>}
                {failed ? (item.error ?? 'Download failed') : STATE_LABEL[state]}
                {pct != null && !failed ? ` · ${pct}%` : ''}
              </span>
              {stats && <span className="shrink-0 tabular-nums">{stats}</span>}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              {indeterminate ? (
                <div className="h-full w-full animate-pulse rounded-full bg-accent/40" />
              ) : (
                <div
                  className={`h-full rounded-full transition-all ${failed ? 'bg-danger' : 'bg-accent'}`}
                  style={{ width: pct != null ? `${pct}%` : '0%' }}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {active && <IconButton icon={<Pause className="h-4 w-4" />} label="Pause" onClick={() => pause.mutate(item.id)} />}
        {state === 'paused' && (
          <IconButton icon={<Play className="h-4 w-4" />} label="Resume" onClick={() => resume.mutate(item.id)} />
        )}
        {failed && (
          <IconButton icon={<RotateCcw className="h-4 w-4" />} label="Retry" onClick={() => resume.mutate(item.id)} />
        )}
        {completed ? (
          <Button
            variant="primary"
            size="lg"
            // A filled glyph at 20px with no stroke: lucide's default 2px stroke ON TOP of
            // a solid fill is what made the small triangle read as fuzzy/haloed.
            icon={<Play className="h-5 w-5" fill="currentColor" strokeWidth={0} />}
            disabled={launch.isPending}
            onClick={() => launch.start({ gameId: item.gameId, gameFileId: item.gameFileId })}
          >
            {launch.isPending ? 'Launching…' : 'Play'}
          </Button>
        ) : (
          <IconButton icon={<X className="h-4 w-4" />} label="Cancel" variant="danger" onClick={() => cancel.mutate(item.id)} />
        )}
      </div>
    </div>
  );
}

/** Steam-like download manager: all active + completed downloads, controllable from one place. */
export function DownloadsView() {
  const { data, isLoading } = useDownloadItems();
  const items = data ?? [];
  const active = items.filter((i) => i.state !== 'completed');
  const completed = items.filter((i) => i.state === 'completed');

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <h1 className="mb-5 text-lg font-semibold">Downloads</h1>
        {isLoading ? (
          <Spinner label="Loading downloads…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Download className="h-6 w-6" />}
            title="No downloads"
            hint="Pick a game in a console's library and choose Download - it appears here and keeps going while you browse."
          />
        ) : (
          <>
            {active.length > 0 && (
              <FocusSection className="space-y-3 animate-fade-in">
                {active.map((i) => (
                  <DownloadRow key={i.id} item={i} />
                ))}
              </FocusSection>
            )}
            {completed.length > 0 && (
              <>
                <h2 className="mb-2 mt-7 text-xs font-semibold uppercase tracking-wide text-fg-faint">Completed</h2>
                <FocusSection className="space-y-3">
                  {completed.map((i) => (
                    <DownloadRow key={i.id} item={i} />
                  ))}
                </FocusSection>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
