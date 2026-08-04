import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Play, Pause, Wrench, AlertTriangle, RotateCcw, X, Youtube, Loader2 } from 'lucide-react';
import { useUiStore } from '@renderer/store/uiStore';
import { invoke } from '@renderer/bridge/ipc';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';
import { DownloadProgress } from './DownloadProgress';
import { FavoriteToggle } from './FavoriteToggle';
import { useCatalogGameDetails, useCatalogAcquisition, useCatalogSetFavorite } from '@renderer/query/useCatalog';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.');

export function CatalogDetailPage({
  igdbId,
  systemId,
  onBack,
}: {
  igdbId: number;
  systemId: number;
  onBack: () => void;
}) {
  const details = useCatalogGameDetails(igdbId, systemId);
  const acq = useCatalogAcquisition(igdbId, systemId);
  const data = details.data;
  const heroUrl = data ? (data.artworks[0] ?? data.screenshots[0] ?? data.coverUrl) : null;

  // Publish this game's artwork as the app-wide backdrop while the detail is open, so it
  // fills the whole window (behind the sidebar too) instead of just the content column.
  const setDetailBackdropUrl = useUiStore((s) => s.setDetailBackdropUrl);
  useEffect(() => {
    setDetailBackdropUrl(heroUrl ?? null);
    return () => setDetailBackdropUrl(null);
  }, [heroUrl, setDetailBackdropUrl]);

  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [igdbId]); // collapse the description when switching games
  const canExpand = !!data?.summary && data.summary.length > 240;
  const { available, fileId, downloaded, paused, downloadFailed, downloading, downloadId } = acq;
  const setFav = useCatalogSetFavorite();
  const favorite = acq.avail.data?.favorite ?? false;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* The game's artwork + ALL of its shading come from the shell root's window-wide
          gameBackdropStyle (see DesktopShell) - no local scrim here, so the sidebar and
          this content area share the exact same shade with no seam at the boundary. */}
      <div className="relative z-10 flex h-14 shrink-0 items-center gap-3 px-5">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>
          Back
        </Button>
      </div>
      <div className="relative z-10 min-h-0 flex-1 overflow-auto">
        {details.isLoading ? (
          <Spinner label="Loading…" />
        ) : details.isError ? (
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title="Couldn’t load this game"
            hint={errMsg(details.error)}
            action={
              <Button variant="primary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void details.refetch()}>
                Retry
              </Button>
            }
          />
        ) : !data ? (
          <EmptyState title="Game not found" hint="This title isn’t in the online catalog." />
        ) : (
          <>
            <div className="relative z-10 mx-auto max-w-4xl px-6 py-7 animate-fade-in">
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="min-w-0 flex-1">
                  {/* LaunchBox clear logo replaces the text title when available. */}
                  {data.clearLogoUrl ? (
                    <img
                      src={data.clearLogoUrl}
                      alt={data.name}
                      className="mb-1 max-h-24 max-w-sm object-contain drop-shadow-[0_2px_6px_rgb(0_0_0/0.8)]"
                    />
                  ) : (
                    <h1 className="text-2xl font-semibold tracking-tightish drop-shadow-sm">{data.name}</h1>
                  )}

                  <div className="mt-4 max-w-md">
                    <div className="flex flex-wrap items-center gap-2">
                      {downloaded ? (
                        <Button
                          variant="primary"
                          icon={<Play className="h-4 w-4" fill="currentColor" />}
                          disabled={acq.launch.isPending}
                          onClick={acq.play}
                        >
                          {acq.launch.isPending ? 'Launching…' : 'Play'}
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          icon={
                            acq.avail.isLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : downloadFailed ? (
                              <RotateCcw className="h-4 w-4" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )
                          }
                          // While availability is still resolving, the button reads "Retrieving…"
                          // (disabled) instead of a dead "Download" - so it never looks unavailable
                          // when it's just checking. Only a resolved not-available stays disabled.
                          disabled={acq.avail.isLoading || !available || acq.download.isPending || downloading || paused}
                          onClick={() => void acq.startDownload()}
                        >
                          {acq.avail.isLoading
                            ? 'Retrieving…'
                            : downloadFailed
                              ? 'Retry download'
                              : downloading
                                ? 'Downloading'
                                : available
                                  ? 'Download'
                                  : 'Unavailable'}
                        </Button>
                      )}

                      {downloading && downloadId != null && (
                        <>
                          <IconButton icon={<Pause className="h-4 w-4" />} label="Pause" onClick={() => acq.pause.mutate(downloadId)} />
                          <IconButton icon={<X className="h-4 w-4" />} label="Cancel" variant="danger" onClick={() => acq.cancel.mutate(downloadId)} />
                        </>
                      )}
                      {paused && downloadId != null && (
                        <>
                          <Button variant="secondary" icon={<Play className="h-4 w-4" />} onClick={() => acq.resume.mutate(downloadId)}>
                            Resume
                          </Button>
                          <IconButton icon={<X className="h-4 w-4" />} label="Cancel" variant="danger" onClick={() => acq.cancel.mutate(downloadId)} />
                        </>
                      )}
                      <FavoriteToggle
                        favorite={favorite}
                        onToggle={() => setFav.mutate({ igdbId, systemId, favorite: !favorite })}
                      />
                      {data.videoUrl && (
                        <Button
                          variant="secondary"
                          icon={<Youtube className="h-4 w-4" />}
                          onClick={() => void invoke('app:openExternal', { url: data.videoUrl as string })}
                        >
                          Trailer
                        </Button>
                      )}
                    </div>

                    {fileId != null && (downloading || paused) && (
                      <div className="mt-3">
                        <DownloadProgress gameFileId={fileId} />
                      </div>
                    )}

                    {acq.launch.isError && /emulator/i.test(errMsg(acq.launch.error)) && (
                      <p className="mt-2 flex items-center gap-1.5 text-2xs text-fg-faint">
                        <Wrench className="h-3.5 w-3.5" />
                        Set an emulator in Settings → Systems, then try again.
                      </p>
                    )}
                  </div>

                  {/* Description - collapsed by default; Show more expands it. */}
                  {data.summary && (
                    <div className="mt-5 max-w-2xl">
                      <p
                        className={`text-sm leading-relaxed text-fg-muted [text-shadow:0_1px_2px_rgb(0_0_0/0.8)] ${expanded ? '' : 'line-clamp-4'}`}
                      >
                        {data.summary}
                      </p>
                      {canExpand && (
                        <button
                          type="button"
                          onClick={() => setExpanded((v) => !v)}
                          className="mt-1 text-2xs font-semibold text-accent hover:underline"
                        >
                          {expanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Studio, release date, genres, players - hidden until Show more is pressed.
                      When there's no Show more toggle (short/missing summary) they'd otherwise be
                      unreachable, so show them by default in that case.
                      fg-muted + text-shadow: fg-faint washed out over bright artwork
                      backdrops (audit finding - illegible on light game art). */}
                  {(expanded || !canExpand) && (
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
                      {data.releaseDate && <span>{data.releaseDate}</span>}
                      {data.genres.length > 0 && <span>{data.genres.join(', ')}</span>}
                      {data.players && <span>{data.players}</span>}
                      {/* Prefer LaunchBox developer/publisher; fall back to IGDB companies. */}
                      {data.developer || data.publisher ? (
                        <span>{[data.developer, data.publisher].filter(Boolean).join(' · ')}</span>
                      ) : (
                        data.companies.length > 0 && <span>{data.companies.join(' · ')}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {data.screenshots.length > 0 && (
                <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">
                  {/* Uniform 16:9 tiles (object-cover) - mixed native aspect ratios would
                      otherwise render at different sizes and break the grid's rhythm. */}
                  {data.screenshots.map((s, i) => (
                    <img key={i} src={s} alt="" loading="lazy" className="aspect-video w-full rounded-md object-cover" />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
