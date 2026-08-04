import { useEffect, useRef, useState } from 'react';
import { KeyRound, Database, Download, CheckCircle2, ArrowRight } from 'lucide-react';
import { useLaunchboxStatus, useLaunchboxImport, useLaunchboxProgress } from '@renderer/query/useLaunchbox';
import { useArchiveStatus, useSaveArchiveCredentials } from '@renderer/query/useSources';
import { useSetSetting } from '@renderer/query/useSettings';
import { Button } from '@renderer/components/Button';
import { Input } from '@renderer/components/Input';
import { FormField } from '@renderer/components/FormField';
import { panel } from '@renderer/theme/classes';

/**
 * First-run gate (blocking). Two required steps, both derived from live status so the
 * wizard advances/unmounts on its own once each is satisfied:
 *   1. archive.org S3 keys - unlocks the Redump download sets.
 *   2. LaunchBox metadata import - must FULLY complete before the app unlocks.
 * App.tsx renders this instead of the shell while either requirement is unmet.
 */
export function OnboardingWizard() {
  const archive = useArchiveStatus();
  const launchbox = useLaunchboxStatus();
  const setSetting = useSetSetting();
  const configured = archive.data?.configured ?? false;
  const imported = launchbox.data?.importedAt != null;
  // Step 0 until keys are configured, then step 1 (import). When both are done the
  // parent stops rendering this component entirely.
  const step = configured ? 1 : 0;

  // Both requirements met -> write the one-time flag (once), which flips App's gate.
  const finished = useRef(false);
  useEffect(() => {
    if (configured && imported && !finished.current) {
      finished.current = true;
      setSetting.mutate({ key: 'setup.completed', value: true, encrypted: false });
    }
  }, [configured, imported, setSetting]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 p-6">
      <div className="w-full max-w-lg">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-fg">Welcome to Nostalgia</h1>
          <p className="mt-1.5 text-sm text-fg-muted">A couple of one-time steps before your library is ready.</p>
        </header>

        <div className="mb-5 flex items-center justify-center gap-2">
          <StepDot index={0} current={step} label="Account keys" done={configured} />
          <span className="h-px w-8 bg-surface-2" />
          <StepDot index={1} current={step} label="Metadata" />
        </div>

        {step === 0 ? <KeysStep /> : <ImportStep />}
      </div>
    </div>
  );
}

function StepDot({ index, current, label, done }: { index: number; current: number; label: string; done?: boolean }) {
  const active = index === current;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-2xs font-semibold ${
          done
            ? 'bg-positive text-bg'
            : active
              ? 'bg-accent text-bg'
              : 'bg-surface-2 text-fg-faint'
        }`}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
      </span>
      <span className={`text-2xs font-medium ${active ? 'text-fg' : 'text-fg-faint'}`}>{label}</span>
    </div>
  );
}

/** Step 1 - archive.org S3 credentials. Saving flips archiveStatus.configured, which advances the wizard. */
function KeysStep() {
  const save = useSaveArchiveCredentials();
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');

  const onSave = (): void => {
    if (!key.trim() || !secret.trim()) return;
    save.mutate({ key: key.trim(), secret: secret.trim() });
  };

  return (
    <div className={`${panel} p-5`}>
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-fg">archive.org account keys</h2>
      </div>
      <p className="mb-4 text-2xs leading-relaxed text-fg-muted">
        These unlock the complete Redump download sets (PS3, PS2, Xbox, Xbox 360). Generate a free pair at{' '}
        <span className="text-fg">archive.org/account/s3.php</span>. The secret is encrypted at rest and never shown
        again.
      </p>
      <div className="space-y-4">
        <FormField label="Access key">
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="archive.org S3 access key" />
        </FormField>
        <FormField label="Secret key">
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="archive.org S3 secret key"
          />
        </FormField>
        <Button
          variant="primary"
          icon={<ArrowRight className="h-4 w-4" />}
          disabled={!key.trim() || !secret.trim() || save.isPending}
          onClick={onSave}
        >
          {save.isPending ? 'Saving…' : 'Save & continue'}
        </Button>
        {save.isError && (
          <p className="text-2xs text-danger">
            {save.error instanceof Error ? save.error.message : 'Could not save keys.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Step 2 - LaunchBox import. Must fully complete; the parent unmounts the wizard once importedAt is set. */
function ImportStep() {
  const status = useLaunchboxStatus();
  const doImport = useLaunchboxImport();
  const progress = useLaunchboxProgress();
  const importing = doImport.isPending || (status.data?.importing ?? false) || progress != null;

  const statusText = (): string => {
    if (progress?.phase === 'downloading')
      return `Downloading… ${progress.fraction != null ? Math.round(progress.fraction * 100) + '%' : ''}`;
    if (progress?.phase === 'importing')
      return `Importing… ${progress.games != null ? progress.games.toLocaleString() + ' games' : ''}`;
    if (importing) return 'Starting…';
    return 'Ready to download (~100 MB).';
  };
  const pct = progress?.phase === 'downloading' && progress.fraction != null ? Math.round(progress.fraction * 100) : null;

  return (
    <div className={`${panel} p-5`}>
      <div className="mb-2 flex items-center gap-2">
        <Database className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-fg">Game metadata database</h2>
      </div>
      <p className="mb-4 text-2xs leading-relaxed text-fg-muted">
        A rich community metadata set - clear logos, community ratings, ESRB, players, co-op, developer/publisher, and
        trailers - merged into the catalog. This one-time download must finish before you continue.
      </p>
      <div className="space-y-3">
        <p className="text-2xs text-fg-muted">{statusText()}</p>
        {pct != null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
        <Button
          variant="primary"
          icon={<Download className="h-4 w-4" />}
          disabled={importing}
          onClick={() => doImport.mutate()}
        >
          {importing ? 'Importing…' : 'Download metadata'}
        </Button>
        {doImport.isError && (
          <p className="text-2xs text-danger">
            {doImport.error instanceof Error ? doImport.error.message : 'Import failed.'}
          </p>
        )}
      </div>
    </div>
  );
}
