import { useState } from 'react';
import { Plus, Trash2, Link2, KeyRound, CheckCircle2 } from 'lucide-react';
import { useSystems } from '@renderer/query/useSystems';
import {
  useCustomSources,
  useAddSource,
  useRemoveSource,
  useArchiveStatus,
  useSaveArchiveCredentials,
} from '@renderer/query/useSources';
import { Card } from '@renderer/components/Card';
import { FormField } from '@renderer/components/FormField';
import { Input } from '@renderer/components/Input';
import { Select } from '@renderer/components/Select';
import { Button } from '@renderer/components/Button';
import { IconButton } from '@renderer/components/IconButton';
import { panel } from '@renderer/theme/classes';

export function SourcesSettings() {
  const { data: systems = [] } = useSystems(false);
  const { data: sources = [] } = useCustomSources();
  const add = useAddSource();
  const remove = useRemoveSource();
  const [url, setUrl] = useState('');
  const [systemId, setSystemId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const systemName = (id: number): string => systems.find((s) => s.id === id)?.name ?? `System ${id}`;
  const chosen = systemId ?? systems[0]?.id ?? null;

  const submit = async (): Promise<void> => {
    setError(null);
    if (!url.trim() || chosen == null) return;
    try {
      await add.mutateAsync({ url: url.trim(), systemId: chosen });
      setUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that source.');
    }
  };

  return (
    <div className="space-y-6">
      <Card title="Add a game source">
        <p className="mb-3 text-sm text-fg-muted">
          Paste either an <span className="text-fg">archive.org</span> item link (<code>archive.org/details/…</code>) or
          a <span className="text-fg">minerva-archive.org</span> collection link (
          <code>minerva-archive.org/browse/…</code>), then pick the console it's for. Nostalgia checks the source and
          adds its games to that console's download catalog.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Source link" className="min-w-64 flex-1">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="archive.org/details/… or minerva-archive.org/browse/…"
            />
          </FormField>
          <FormField label="Console" className="min-w-40">
            <Select value={chosen ?? ''} onChange={(e) => setSystemId(Number(e.target.value))}>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FormField>
          <Button
            variant="primary"
            icon={<Plus className="h-4 w-4" />}
            disabled={add.isPending || !url.trim() || chosen == null}
            onClick={() => void submit()}
          >
            {add.isPending ? 'Adding…' : 'Add source'}
          </Button>
        </div>
        {error && <p className="mt-2.5 text-sm text-danger">{error}</p>}
      </Card>

      <section className="space-y-2">
        {sources.length === 0 && <p className="px-1 text-sm text-fg-faint">No custom sources added yet.</p>}
        {sources.map((s) => (
          <div key={s.id} className={`${panel} flex items-center justify-between gap-2 px-3 py-2.5`}>
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                {s.label}
              </p>
              <p className="truncate text-2xs text-fg-faint">
                {systemName(s.systemId)} · {s.kind} · {s.extensions.join(', ') || '-'}
                {s.extract ? ' · extract' : ''}
              </p>
            </div>
            <IconButton
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => remove.mutate({ id: s.id })}
              label="Remove"
              variant="danger"
            />
          </div>
        ))}
      </section>

      <ArchiveCredentialsCard />
    </div>
  );
}

/**
 * archive.org account keys. Many of the complete Redump sets are `access-restricted-item`
 * collections: their file lists are public, but the bytes need an account. Without keys the
 * app silently skips those items and falls back to the (much slower) torrent sources, which
 * is what made some titles sit on "Retrieving…" for minutes. Dev builds can supply these via
 * .env; an installed build has no .env, so this is the only way to configure them.
 */
function ArchiveCredentialsCard() {
  const status = useArchiveStatus();
  const save = useSaveArchiveCredentials();
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const configured = status.data?.configured ?? false;

  const onSave = async (): Promise<void> => {
    await save.mutateAsync({ key: key.trim() || undefined, secret: secret.trim() || undefined });
    setKey('');
    setSecret('');
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" />
          archive.org account keys
        </span>
      }
      description="Unlocks the complete Redump sets (PS3, PS2, Xbox, Xbox 360). Without them those titles fall back to slow torrent sources. Get a pair at archive.org/account/s3.php - the secret is encrypted at rest and never shown again."
    >
      <div className="space-y-4">
        <FormField label="Access key">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={status.data?.hasKey ? 'Configured - enter to replace' : 'archive.org S3 access key'}
          />
        </FormField>
        <FormField label="Secret key">
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={status.data?.hasSecret ? 'Configured - enter to replace' : 'archive.org S3 secret key'}
          />
        </FormField>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            disabled={save.isPending || (!key.trim() && !secret.trim())}
            onClick={() => void onSave()}
          >
            Save
          </Button>
          <span className="ml-auto text-2xs">
            {configured ? (
              <span className="inline-flex items-center gap-1 text-positive">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configured
              </span>
            ) : (
              <span className="text-fg-faint">Not configured</span>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}
