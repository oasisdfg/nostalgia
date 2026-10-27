import { type ReactNode } from 'react';
import { Play, Download, X, Loader2 } from 'lucide-react';
import { FocusSection } from './Focusable';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { FavoriteToggle } from './FavoriteToggle';
import { Spinner } from './Spinner';
import { DownloadProgress } from './DownloadProgress';
import { PortPlayButton } from './PortPlayButton';
import { useGameDetail } from '@renderer/query/useGameDetail';
import { useSetFavorite } from '@renderer/query/useGames';
import { useEnqueueDownload, useDownloadProgress } from '@renderer/query/useDownloads';
import { useGuardedLaunch } from '@renderer/query/useLaunch';
import { useCatalogAcquisition, useCatalogGameDetails } from '@renderer/query/useCatalog';
import { useRecompsForGame } from '@renderer/query/useRecomps';
import { useSetting, useSetSetting } from '@renderer/query/useSettings';
import { useUiStore } from '@renderer/store/uiStore';
import type { GameFileDTO } from '@shared/contracts/ipc';

function primaryFile(files: GameFileDTO[]): GameFileDTO | undefined {
  return files.find((f) => f.isPrimary) ?? files[0];
}

/** One label/value row of the metadata list (LaunchBox style: label left, value right). */
function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2">
      <span className="shrink-0 text-xs text-fg-faint">{label}</span>
      <span className="min-w-0 truncate text-right text-xs font-medium text-fg">{value}</span>
    </div>
  );
}

/**
 * The right-side game pop-out, LaunchBox style: sharp key art as a hero strip up top,
 * the game's clear logo as the title (text only as a fallback - no separate title line,
 * no console label, no screenshot strip), one big primary action, then label/value
 * metadata rows and an INFORMATION card.
 */
export function GameDetail() {
  const selectedGameId = useUiStore((s) => s.selectedGameId);
  const setSelectedGameId = useUiStore((s) => s.setSelectedGameId);
  const setFavorite = useSetFavorite();
  const launch = useGuardedLaunch();
  const enqueue = useEnqueueDownload();
  const { data, isLoading } = useGameDetail(selectedGameId);

  const game = data?.game;
  const file = data ? primaryFile(data.files) : undefined;
  const fileCached = file?.cacheState === 'cached';
  const needsAvail = game != null && !file && game.igdbId != null;
  const acq = useCatalogAcquisition(needsAvail ? game!.igdbId! : null, game?.systemId ?? 0);
  const fileDl = useDownloadProgress((s) => (file ? s.byFile[file.id] : undefined));
  const catalog = useCatalogGameDetails(game?.igdbId ?? null, game?.systemId);
  const heroUrl =
    catalog.data?.artworks?.[0] ?? catalog.data?.screenshots?.[0] ?? catalog.data?.coverUrl ?? game?.coverUrl ?? null;
  const logoUrl = catalog.data?.clearLogoUrl ?? null;
  // Native Ports linked to this game turn Play into a choice; the last pick is remembered
  // per game in `recomps.preferred` ({ [gameId]: recompId | 'emulator' }).
  const ports = useRecompsForGame(game?.id ?? null).data ?? [];
  const preferredSetting = useSetting('recomps.preferred');
  const setSetting = useSetSetting();
  const preferredMap =
    preferredSetting.data?.value && typeof preferredSetting.data.value === 'object'
      ? (preferredSetting.data.value as Record<string, string>)
      : {};
  const preferred = game ? (preferredMap[String(game.id)] ?? 'emulator') : 'emulator';
  const remember = (choice: string): void => {
    if (!game || preferred === choice) return;
    setSetting.mutate({ key: 'recomps.preferred', value: { ...preferredMap, [String(game.id)]: choice }, encrypted: false });
  };

  if (selectedGameId == null) return null;
  const close = (): void => setSelectedGameId(null);

  const fileDownloading =
    !!fileDl && (fileDl.state === 'queued' || fileDl.state === 'downloading' || fileDl.state === 'verifying');
  const onPlay = (): void => {
    if (!game) return;
    if (ports.length > 0) remember('emulator');
    launch.start({ gameId: game.id, gameFileId: file?.id, systemId: game.systemId });
  };

  const primaryButton = (g: NonNullable<typeof game>): ReactNode => {
    if (fileCached) {
      return (
        <Button
          variant={ports.length > 0 && preferred !== 'emulator' ? 'secondary' : 'primary'}
          size="lg"
          fullWidth
          icon={<Play className="h-5 w-5" fill="currentColor" />}
          disabled={launch.isPending}
          onClick={onPlay}
        >
          {launch.isPending ? 'Launching…' : ports.length > 0 ? 'Play (Emulator)' : 'Play'}
        </Button>
      );
    }
    if (file) {
      return (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          icon={fileDownloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          disabled={fileDownloading}
          onClick={() => enqueue.mutate({ gameFileId: file.id })}
        >
          {fileDl?.state === 'queued' ? 'Queued…' : fileDownloading ? 'Installing…' : 'Install'}
        </Button>
      );
    }
    if (g.igdbId != null) {
      if (acq.downloading) {
        return (
          <Button variant="primary" size="lg" fullWidth disabled icon={<Loader2 className="h-5 w-5 animate-spin" />}>
            Installing…
          </Button>
        );
      }
      if (acq.avail.isLoading) {
        return (
          <Button variant="primary" size="lg" fullWidth disabled icon={<Loader2 className="h-5 w-5 animate-spin" />}>
            Retrieving…
          </Button>
        );
      }
      if (acq.available) {
        return (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            icon={<Download className="h-5 w-5" />}
            disabled={acq.download.isPending}
            onClick={() => void acq.startDownload()}
          >
            {acq.download.isPending ? 'Starting…' : 'Install'}
          </Button>
        );
      }
    }
    return (
      <Button variant="primary" size="lg" fullWidth disabled icon={<Download className="h-5 w-5" />}>
        Unavailable
      </Button>
    );
  };

  const progressFileId = file && !fileCached && fileDownloading ? file.id : acq.downloading || acq.paused ? acq.fileId : null;

  const cat = catalog.data;
  const releaseDate = cat?.releaseDate ?? game?.releaseDate ?? null;
  const genre = cat?.genres?.length ? cat.genres.join(', ') : (game?.genre ?? null);
  const playMode = cat?.players ?? (game?.players ? `${game.players} players` : null);
  const metaRows: [string, string | null | undefined][] = [
    ['Release Date', releaseDate],
    ['Developer', cat?.developer],
    ['Publisher', cat?.publisher],
    ['Play Count', game && game.playCount > 0 ? String(game.playCount) : null],
    ['Last Played', game?.lastPlayedAt ? new Date(game.lastPlayedAt).toLocaleDateString() : null],
  ];
  const hasMeta = metaRows.some(([, v]) => v);
  const infoRows: [string, string | null | undefined][] = [
    ['Rating', cat?.esrb ?? 'Not Rated'],
    ['Genre', genre],
    ['Play Mode', playMode],
    ['Region', game?.region],
  ];

  return (
    <FocusSection className="relative flex w-96 shrink-0 flex-col overflow-hidden bg-surface shadow-e2 animate-fade-in">
      {isLoading || !game ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto">
          {/* Hero: sharp key art, cropped to a strip, fading into the panel below. */}
          <div className="relative h-48 shrink-0 bg-black">
            {heroUrl && <img src={heroUrl} alt="" className="h-full w-full object-cover" />}
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-surface to-transparent" />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
              <FavoriteToggle
                favorite={game.favorite}
                onToggle={() => {
                  const wasFileless = game.favorite && !game.hasFiles;
                  setFavorite.mutate({ id: game.id, favorite: !game.favorite });
                  if (wasFileless) close();
                }}
              />
              <IconButton icon={<X className="h-4 w-4" />} onClick={close} label="Close" />
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-4 p-5 pt-1">
            {/* The clear logo IS the title (text fallback only when a title has no logo). */}
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={game.title}
                className="mx-auto max-h-28 w-auto max-w-[16rem] object-contain drop-shadow-[0_2px_8px_rgb(0_0_0/0.85)]"
              />
            ) : (
              <h2 className="text-center text-xl font-bold leading-tight tracking-tightish">{game.title}</h2>
            )}

            <div className="flex flex-col gap-3">
              {primaryButton(game)}

              {ports.map((p) => (
                <PortPlayButton
                  key={p.manifest.id}
                  port={p}
                  primary={preferred === p.manifest.id}
                  fileName={file?.displayName ?? null}
                  onPlay={() => remember(p.manifest.id)}
                />
              ))}

              {launch.isError && (
                <p className="text-2xs text-danger">
                  {launch.error instanceof Error ? launch.error.message : 'Could not launch the game.'}
                </p>
              )}

              {progressFileId != null && <DownloadProgress gameFileId={progressFileId} />}
            </div>

            {/* Label/value metadata rows (LaunchBox style). Hidden entirely when a game
                has no metadata, so no empty card is left behind. */}
            {hasMeta && (
              <div className="divide-y divide-white/5 rounded-lg bg-white/5">
                {metaRows.map(([label, value]) => (
                  <MetaRow key={label} label={label} value={value} />
                ))}
              </div>
            )}

            <div className="rounded-lg bg-white/5">
              <h3 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Information
              </h3>
              <div className="divide-y divide-white/5">
                {infoRows.map(([label, value]) => (
                  <MetaRow key={label} label={label} value={value} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </FocusSection>
  );
}
