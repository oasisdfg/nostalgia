import { useDownloadProgress } from '@renderer/query/useDownloads';

function formatRate(bps: number): string {
  if (bps <= 0) return '';
  const mb = bps / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bps / 1024)} KB/s`;
}

export function DownloadProgress({ gameFileId }: { gameFileId: number }) {
  const info = useDownloadProgress((s) => s.byFile[gameFileId]);
  if (!info || info.state === 'completed' || info.state === 'canceled') return null;

  const pct = info.fraction != null ? Math.round(info.fraction * 100) : null;
  const failed = info.state === 'failed';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-2xs text-fg-muted">
        <span className="capitalize">{info.state ?? 'downloading'}</span>
        <span>
          {pct != null ? `${pct}%` : ''} {formatRate(info.bytesPerSecond)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all ${failed ? 'bg-danger' : 'bg-accent'}`}
          // A queued download hasn't moved a byte - show an empty bar, not the 40%
          // indeterminate placeholder (which read as phantom progress).
          style={{ width: pct != null ? `${pct}%` : info.state === 'queued' ? '0%' : '40%' }}
        />
      </div>
    </div>
  );
}
