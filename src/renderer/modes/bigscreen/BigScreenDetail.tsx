import { useEffect, useState } from 'react';
import { Download, Play, Pause, X, RotateCcw, Wrench, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@renderer/components/Button';
import { Spinner } from '@renderer/components/Spinner';
import { EmptyState } from '@renderer/components/EmptyState';
import { DownloadProgress } from '@renderer/components/DownloadProgress';
import { useCatalogGameDetails, useCatalogAcquisition } from '@renderer/query/useCatalog';
import { setFocus } from '@renderer/input/spatialNav';

const ACTION = 'bs-detail-action';
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.');

/** Full-screen detail for the 10-foot UI. Reuses the shared acquisition lifecycle.
 *  Layout: the key art fills the page, the clear logo (or title) sits big and
 *  centered with the actions right under it - no cover column, no saves panel. */
export function BigScreenDetail({ igdbId, systemId }: { igdbId: number; systemId: number }) {
  const details = useCatalogGameDetails(igdbId, systemId);
  const acq = useCatalogAcquisition(igdbId, systemId);
  const data = details.data;
  const { available, fileId, downloaded, paused, downloadFailed, downloading, downloadId, status } = acq;
  const toneClass = {
    muted: 'text-fg-muted',
    accent: 'text-accent',
    danger: 'text-danger',
    positive: 'text-positive',
  }[status.tone];

  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [igdbId]); // collapse the description when switching games
  const canExpand = !!data?.summary && data.summary.length > 240;

  // Keep controller focus on the current primary action as it changes.
  useEffect(() => {
    const r = requestAnimationFrame(() => setFocus(ACTION));
    return () => cancelAnimationFrame(r);
  }, [downloaded, paused, downloading, downloadFailed, data]);

  if (details.isLoading) return <Spinner label="Loading…" />;
  if (details.isError)
    return <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="Couldn’t load this game" hint={errMsg(details.error)} />;
  if (!data) return <EmptyState title="Game not found" />;

  const heroUrl = data.artworks[0] ?? data.screenshots[0] ?? data.coverUrl;
  const checking = acq.avail.isLoading;

  return (
    <div className="relative h-full overflow-auto">
      {/* Full-bleed key art behind the whole page, dimmed just enough for legible text. */}
      {heroUrl && (
        <div className="pointer-events-none absolute inset-0">
          <img src={heroUrl} alt="" className="h-full w-full object-cover opacity-45" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-bg/25" />
        </div>
      )}
      <div className="relative mx-auto max-w-4xl px-12 py-12 animate-fade-in">
        {/* The game's identity, front and center. */}
        {data.clearLogoUrl ? (
          <img
            src={data.clearLogoUrl}
            alt={data.name}
            className="mx-auto max-h-52 max-w-2xl object-contain drop-shadow-[0_4px_12px_rgb(0_0_0/0.85)]"
          />
        ) : (
          <h1 className="text-center text-5xl font-semibold tracking-tightish drop-shadow-[0_2px_8px_rgb(0_0_0/0.85)]">
            {data.name}
          </h1>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {downloaded ? (
            <Button
              size="lg"
              variant="primary"
              focusKey={ACTION}
              icon={<Play className="h-5 w-5" fill="currentColor" />}
              disabled={acq.launch.isPending}
              onClick={acq.play}
            >
              {acq.launch.isPending ? 'Launching…' : 'Play'}
            </Button>
          ) : downloading ? (
            <>
              <Button
                size="lg"
                variant="secondary"
                focusKey={ACTION}
                icon={<Pause className="h-5 w-5" />}
                disabled={downloadId == null}
                onClick={() => downloadId != null && acq.pause.mutate(downloadId)}
              >
                Pause
              </Button>
              <Button
                size="lg"
                variant="danger"
                icon={<X className="h-5 w-5" />}
                disabled={downloadId == null}
                onClick={() => downloadId != null && acq.cancel.mutate(downloadId)}
              >
                Cancel
              </Button>
            </>
          ) : paused ? (
            <>
              <Button
                size="lg"
                variant="primary"
                focusKey={ACTION}
                icon={<Play className="h-5 w-5" />}
                disabled={downloadId == null}
                onClick={() => downloadId != null && acq.resume.mutate(downloadId)}
              >
                Resume
              </Button>
              <Button
                size="lg"
                variant="danger"
                icon={<X className="h-5 w-5" />}
                disabled={downloadId == null}
                onClick={() => downloadId != null && acq.cancel.mutate(downloadId)}
              >
                Cancel
              </Button>
            </>
          ) : (
            // The button IS the availability status: Checking → Download/Unavailable.
            <Button
              size="lg"
              variant="primary"
              focusKey={ACTION}
              icon={
                checking ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : downloadFailed ? (
                  <RotateCcw className="h-5 w-5" />
                ) : (
                  <Download className="h-5 w-5" />
                )
              }
              disabled={checking || !available || acq.download.isPending}
              onClick={() => void acq.startDownload()}
            >
              {checking ? 'Checking' : downloadFailed ? 'Retry download' : available ? 'Download' : 'Unavailable'}
            </Button>
          )}
        </div>

        {status.text && (
          <p className={`mt-4 flex items-center justify-center gap-2 text-base ${toneClass}`}>
            {status.tone === 'danger' && <AlertTriangle className="h-4 w-4" />}
            {status.text}
          </p>
        )}

        {fileId != null && (downloading || paused) && (
          <div className="mx-auto mt-5 max-w-lg">
            <DownloadProgress gameFileId={fileId} />
          </div>
        )}

        {acq.launch.isError && /emulator/i.test(errMsg(acq.launch.error)) && (
          <p className="mt-2 flex items-center justify-center gap-2 text-base text-fg-faint">
            <Wrench className="h-4 w-4" />
            Set an emulator in Desktop Mode → Settings → Systems.
          </p>
        )}

        {data.summary && (
          <div className="mx-auto mt-10 max-w-3xl">
            <p className={`text-lg leading-relaxed text-fg-muted ${expanded ? '' : 'line-clamp-6'}`}>{data.summary}</p>
            {canExpand && (
              <Button size="md" variant="ghost" className="mt-2" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Show less' : 'Show more'}
              </Button>
            )}
          </div>
        )}

        {/* Release date, genres, players - hidden until Show more is pressed. When there's no
            Show more toggle (short/missing summary) they'd otherwise be unreachable, so show
            them by default in that case. */}
        {(expanded || !canExpand) && (
          <div className="mx-auto mt-4 flex max-w-3xl flex-wrap gap-x-6 gap-y-1 text-lg text-fg-muted">
            {data.releaseDate && <span>{data.releaseDate}</span>}
            {data.genres.length > 0 && <span>{data.genres.join(', ')}</span>}
            {data.players && <span>{data.players}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
