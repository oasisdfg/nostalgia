import { useState, useEffect } from 'react';
import { Trash2, Scissors, Database, Download, RefreshCw, Info, ExternalLink } from 'lucide-react';
import { useSetting, useSetSetting } from '@renderer/query/useSettings';
import { useCacheStats } from '@renderer/query/useCacheStats';
import { useEvictCache, useClearCache } from '@renderer/query/useCache';
import { useLaunchboxStatus, useLaunchboxImport, useLaunchboxProgress } from '@renderer/query/useLaunchbox';
import {
  useUpdateStatus,
  useCheckForUpdates,
  useRestartToUpdate,
  useOpenReleasePage,
} from '@renderer/query/useUpdates';
import { useToasts } from '@renderer/components/Toast';
import { Card } from '@renderer/components/Card';
import { FormField } from '@renderer/components/FormField';
import { Input } from '@renderer/components/Input';
import { Select } from '@renderer/components/Select';
import { Button } from '@renderer/components/Button';
import { FolderPicker } from '@renderer/components/forms/FolderPicker';

const GB = 1024 ** 3;
const fmtGb = (bytes: number): string => (bytes / GB).toFixed(2);

export function GeneralSettings() {
  const storageRoot = useSetting('storage.root');
  const cacheDir = useSetting('cache.dir');
  const cacheLimit = useSetting('cache.sizeLimitBytes');
  const defaultMode = useSetting('ui.defaultMode');
  const setSetting = useSetSetting();
  const stats = useCacheStats();
  const evict = useEvictCache();
  const clear = useClearCache();

  const [root, setRoot] = useState('');
  const [cdir, setCdir] = useState('');
  const [limitGb, setLimitGb] = useState('20');

  useEffect(() => {
    if (typeof storageRoot.data?.value === 'string') setRoot(storageRoot.data.value);
  }, [storageRoot.data]);
  useEffect(() => {
    if (typeof cacheDir.data?.value === 'string') setCdir(cacheDir.data.value);
  }, [cacheDir.data]);
  useEffect(() => {
    if (typeof cacheLimit.data?.value === 'number') setLimitGb(String(cacheLimit.data.value / GB));
  }, [cacheLimit.data]);

  const mode = typeof defaultMode.data?.value === 'string' ? defaultMode.data.value : 'desktop';
  const used = stats.data?.totalBytes ?? 0;
  const limit = stats.data?.limitBytes ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  // Folder fields persist on selection (no per-field Save). Local state updates
  // immediately for instant feedback; the OS-dialog path is stored verbatim.
  const pickRoot = (folderPath: string): void => {
    setRoot(folderPath);
    setSetting.mutate({ key: 'storage.root', value: folderPath, encrypted: false });
  };
  const pickCacheDir = (folderPath: string): void => {
    setCdir(folderPath);
    setSetting.mutate({ key: 'cache.dir', value: folderPath, encrypted: false });
  };

  return (
    <div className="grid auto-rows-fr grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="Storage">
        <div className="space-y-4">
          <FormField label="Game files folder">
            <FolderPicker value={root} onChange={pickRoot} placeholder="Where your game files live" />
          </FormField>
          <FormField label="Cache folder" hint="Where downloaded games are cached. Defaults to Documents\Nostalgia\cache.">
            <FolderPicker value={cdir} onChange={pickCacheDir} placeholder="Defaults to Documents\Nostalgia\cache" />
          </FormField>
        </div>
      </Card>

      <Card title="Cache">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-2xs text-fg-muted">
              <span>
                {fmtGb(used)} GB used{limit > 0 ? ` of ${fmtGb(limit)} GB` : ''} · {stats.data?.entryCount ?? 0} files
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex items-end gap-3">
            <FormField label="Size limit (GB)" className="w-32">
              <Input value={limitGb} onChange={(e) => setLimitGb(e.target.value)} inputMode="decimal" />
            </FormField>
            <Button
              variant="secondary"
              onClick={() =>
                setSetting.mutate({
                  key: 'cache.sizeLimitBytes',
                  value: Math.round((Number(limitGb) || 0) * GB),
                  encrypted: false,
                })
              }
            >
              Save
            </Button>
            <Button
              variant="ghost"
              icon={<Scissors className="h-4 w-4" />}
              onClick={() => evict.mutate(undefined)}
              disabled={evict.isPending}
            >
              Evict
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => clear.mutate()}
              disabled={clear.isPending}
            >
              Clear
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Appearance">
        <FormField label="Start in" className="max-w-xs">
          <Select
            value={mode}
            onChange={(e) => setSetting.mutate({ key: 'ui.defaultMode', value: e.target.value, encrypted: false })}
          >
            <option value="desktop">Desktop Mode</option>
            <option value="bigscreen">Big Screen Mode</option>
          </Select>
        </FormField>
      </Card>

      <LaunchboxCard />

      <AboutCard />
    </div>
  );
}

/**
 * LaunchBox metadata is imported during first-run onboarding; this card lets the user
 * refresh it later (the set is updated periodically upstream).
 */
function LaunchboxCard() {
  const status = useLaunchboxStatus();
  const doImport = useLaunchboxImport();
  const progress = useLaunchboxProgress();
  const importing = doImport.isPending || (status.data?.importing ?? false) || progress != null;

  const statusText = (): string => {
    if (progress?.phase === 'downloading')
      return `Downloading… ${progress.fraction != null ? Math.round(progress.fraction * 100) + '%' : ''}`;
    if (progress?.phase === 'importing')
      return `Importing… ${progress.games != null ? progress.games.toLocaleString() + ' games' : ''}`;
    if (status.data?.importedAt)
      return `${status.data.gameCount.toLocaleString()} games · updated ${new Date(status.data.importedAt).toLocaleDateString()}`;
    return 'Not imported yet.';
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Database className="h-4 w-4 text-accent" />
          Game metadata database
        </span>
      }
      description="Community metadata (clear logos, ratings, ESRB, players, co-op, developer/publisher, trailers) merged into the catalog."
    >
      <div className="space-y-3">
        <p className="text-2xs text-fg-muted">{statusText()}</p>
        <Button
          variant="secondary"
          icon={<Download className="h-4 w-4" />}
          disabled={importing}
          onClick={() => doImport.mutate()}
        >
          {importing ? 'Importing…' : status.data?.importedAt ? 'Re-import' : 'Download metadata'}
        </Button>
        {doImport.isError && (
          <p className="text-2xs text-danger">
            {doImport.error instanceof Error ? doImport.error.message : 'Import failed.'}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Version + self-update. Updates are mandatory (no on/off switch); this card only lets
 * the user check early and restart into a downloaded update.
 */
function AboutCard() {
  const { data: status } = useUpdateStatus();
  const check = useCheckForUpdates();
  const restart = useRestartToUpdate();
  const openPage = useOpenReleasePage();
  const push = useToasts((s) => s.push);

  const busy = check.isPending || status?.state === 'checking';
  const pending = status?.state === 'available' || status?.state === 'downloading' || status?.state === 'downloaded';

  const statusText = (): string => {
    if (!status) return '';
    if (status.mode === 'disabled') return 'Updates are off in this build.';
    switch (status.state) {
      case 'checking':
        return 'Checking for updates…';
      case 'downloading':
        return `Downloading version ${status.version ?? ''}… ${Math.round((status.fraction ?? 0) * 100)}%`;
      case 'downloaded':
        return `Version ${status.version ?? ''} is ready to install.`;
      case 'available':
        return status.mode === 'notify'
          ? `Version ${status.version ?? ''} is available. This copy can't update itself - download the new version from the release page.`
          : `Version ${status.version ?? ''} is available.`;
      case 'not-available':
        return "You're on the latest version.";
      case 'error':
        return status.error ?? 'Update check failed.';
      default:
        return '';
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 text-accent" />
          About
        </span>
      }
      description="Nostalgia keeps itself up to date. Updates download in the background and install when you close the app."
    >
      <div className="space-y-3">
        <div className="space-y-1 text-2xs text-fg-muted">
          <p>
            Version <span className="font-medium text-fg">{status?.currentVersion ?? ''}</span>
            {status?.checkedAt ? ` · last checked ${new Date(status.checkedAt).toLocaleString()}` : ''}
          </p>
          {statusText() && <p className={status?.state === 'error' ? 'text-danger' : ''}>{statusText()}</p>}
        </div>
        {status?.state === 'downloading' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round((status.fraction ?? 0) * 100)}%` }}
            />
          </div>
        )}
        {pending && status?.releaseNotes && (
          <div className="max-h-40 overflow-auto whitespace-pre-line rounded-md bg-bg/60 px-3 py-2 text-2xs text-fg-muted shadow-inset-1">
            {status.releaseNotes}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {status?.mode !== 'disabled' && (
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              disabled={busy || status?.state === 'downloading' || status?.state === 'downloaded'}
              onClick={() => check.mutate()}
            >
              {busy ? 'Checking…' : 'Check for updates'}
            </Button>
          )}
          {status?.mode === 'auto' && status.state === 'downloaded' && (
            <Button
              variant="primary"
              icon={<RefreshCw className="h-4 w-4" />}
              disabled={restart.isPending}
              onClick={() =>
                restart.mutate(undefined, {
                  onSuccess: (r) => {
                    if (!r.ok)
                      push(`${r.reason ?? "Can't restart right now."} It'll install when you close Nostalgia.`, 'info');
                  },
                })
              }
            >
              Restart now
            </Button>
          )}
          {status?.mode === 'notify' && status.state === 'available' && (
            <Button variant="primary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => openPage.mutate()}>
              Open download page
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
