import { useState } from 'react';
import { FolderSearch, Settings2, FolderOpen, ScanLine, Download, Trash2, Check } from 'lucide-react';
import { ConsoleLogo } from '@renderer/components/SystemIcon';
import { EMULATOR_CATALOG } from '@shared/contracts/emulators';
import { invoke } from '@renderer/bridge/ipc';
import {
  useSystems,
  useUpdateSystem,
  useCreateSystem,
  useSetSystemEmulator,
} from '@renderer/query/useSystems';
import {
  useEmulators,
  useRevealEmulatorDir,
  useScanEmulators,
  useDeleteEmulator,
} from '@renderer/query/useEmulators';
import { useScanFolder } from '@renderer/query/useLibraryScan';
import { IconButton } from '@renderer/components/IconButton';
import { useSetting, useSetSetting } from '@renderer/query/useSettings';
import { LaunchArgsEditor } from '@renderer/components/forms/LaunchArgsEditor';
import { FolderPicker } from '@renderer/components/forms/FolderPicker';
import { Card } from '@renderer/components/Card';
import { FormField } from '@renderer/components/FormField';
import { Input } from '@renderer/components/Input';
import { Select } from '@renderer/components/Select';
import { Button } from '@renderer/components/Button';
import { panel, well } from '@renderer/theme/classes';
import { FocusSection, Focusable } from '@renderer/components/Focusable';

export function SystemsSettings() {
  const { data: systems = [] } = useSystems(false);
  const { data: emulators = [] } = useEmulators();
  const updateSystem = useUpdateSystem();
  const createSystem = useCreateSystem();
  const setEmulator = useSetSystemEmulator();
  const scanFolder = useScanFolder();
  const revealEmulatorDir = useRevealEmulatorDir();
  const scanEmulators = useScanEmulators();
  const deleteEmulator = useDeleteEmulator();
  const [scanEmuMsg, setScanEmuMsg] = useState<string | null>(null);
  const savesDirsSetting = useSetting('saves.dirs');
  const setSetting = useSetSetting();
  const savesDirs =
    savesDirsSetting.data && !savesDirsSetting.data.encrypted
      ? ((savesDirsSetting.data.value as Record<string, string> | null) ?? {})
      : {};

  const [editingId, setEditingId] = useState<number | null>(null);
  const [emuId, setEmuId] = useState<number | null>(null);
  const [template, setTemplate] = useState<string[]>([]);
  const [newName, setNewName] = useState('');

  const emuName = (id: number | null): string => emulators.find((e) => e.id === id)?.name ?? 'No emulator';

  const startEdit = (systemId: number, currentEmuId: number | null): void => {
    const chosen = currentEmuId ?? emulators[0]?.id ?? null;
    setEditingId(systemId);
    setEmuId(chosen);
    setTemplate(emulators.find((e) => e.id === chosen)?.defaultArgsTemplate ?? []);
  };
  const chooseEmu = (id: number): void => {
    setEmuId(id);
    setTemplate(emulators.find((e) => e.id === id)?.defaultArgsTemplate ?? []);
  };
  const saveBinding = async (systemId: number): Promise<void> => {
    if (emuId == null) return;
    await setEmulator.mutateAsync({ systemId, emulatorId: emuId, launchArgsTemplate: template });
    setEditingId(null);
  };
  const setSavesDir = (slug: string, folderPath: string): void => {
    setSetting.mutate({ key: 'saves.dirs', value: { ...savesDirs, [slug]: folderPath }, encrypted: false });
  };
  const addSystem = async (): Promise<void> => {
    // The internal id comes from the name ("Sega 32X" -> "sega-32x"); users never see it.
    const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) return;
    await createSystem.mutateAsync({ slug, name: newName.trim() });
    setNewName('');
  };

  const runScanEmulators = async (): Promise<void> => {
    setScanEmuMsg(null);
    const res = await scanEmulators.mutateAsync();
    setScanEmuMsg(
      res.added > 0
        ? `Registered ${res.added} emulator${res.added === 1 ? '' : 's'}.`
        : res.found.length > 0
          ? 'All detected emulators are already registered.'
          : 'No emulator found in the folder yet - download one and unzip it there first.',
    );
  };

  const removeEmulator = async (): Promise<void> => {
    if (emuId == null) return;
    await deleteEmulator.mutateAsync(emuId);
    setEmuId(null);
    setTemplate([]);
  };

  const selected = systems.find((s) => s.id === editingId) ?? null;
  // The recommended emulator for the selected console (catalog is keyed by display name).
  const recommended = selected ? EMULATOR_CATALOG.find((c) => c.console === selected.name) : undefined;

  return (
    <div className="space-y-6">
      {/* Console tiles: select a tile to turn that console on or off. On is a raised panel
          with an "On" line; off sits recessed and dimmed. The corner gear opens that
          console's settings below the grid. */}
      <FocusSection className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {systems.map((s) => {
          const open = editingId === s.id;
          const toggle = (): void => updateSystem.mutate({ id: s.id, patch: { enabled: !s.enabled } });
          return (
            <div key={s.id} className="relative">
              <Focusable
                ariaLabel={`${s.name}: ${s.enabled ? 'on' : 'off'}`}
                ariaPressed={s.enabled}
                onSelect={toggle}
                className="block rounded-lg"
              >
                <div
                  className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg px-3 py-5 text-center transition-colors ${
                    open
                      ? 'bg-surface-2 shadow-e1'
                      : s.enabled
                        ? 'bg-surface shadow-e1 hover:bg-surface-2'
                        : `${well} hover:bg-bg/80`
                  }`}
                >
                  <span className={`flex h-10 items-center ${s.enabled ? '' : 'opacity-40'}`}>
                    <ConsoleLogo slug={s.slug} size="rail" />
                  </span>
                  <div className="min-w-0 max-w-full">
                    <p className={`truncate text-sm font-medium ${s.enabled ? 'text-fg' : 'text-fg-muted'}`}>{s.name}</p>
                    <p className="flex items-center justify-center gap-1 truncate text-xs text-fg-muted">
                      {s.enabled ? (
                        <>
                          {s.defaultEmulatorId != null && <Check className="h-3 w-3 shrink-0 text-accent" aria-hidden />}
                          {emuName(s.defaultEmulatorId)}
                        </>
                      ) : (
                        'Off'
                      )}
                    </p>
                  </div>
                </div>
              </Focusable>
              <span className="absolute right-1 top-1">
                <IconButton
                  icon={<Settings2 className={`h-4 w-4 ${open ? 'text-accent' : ''}`} />}
                  label={open ? `Close ${s.name} settings` : `${s.name} settings`}
                  onClick={() => (open ? setEditingId(null) : startEdit(s.id, s.defaultEmulatorId))}
                />
              </span>
            </div>
          );
        })}
      </FocusSection>

      {selected && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <ConsoleLogo slug={selected.slug} size="sidebar" />
              Configure {selected.name}
            </span>
          }
        >
          <div className="space-y-4">
            {/* Get the recommended emulator for this console, register a build dropped in
                the emulator folder (Scan), then bind it below. */}
            {recommended && (
              <div className={`${panel} flex items-center justify-between gap-3 px-3 py-2`}>
                <div className="min-w-0">
                  <p className="text-2xs text-fg-faint">Recommended emulator</p>
                  <p className="truncate text-sm font-medium text-fg">{recommended.emulator}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => void invoke('app:openExternal', { url: recommended.url })}
                >
                  Get
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<FolderOpen className="h-4 w-4" />}
                onClick={() => revealEmulatorDir.mutate()}
              >
                Emulator folder
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<ScanLine className="h-4 w-4" />}
                disabled={scanEmulators.isPending}
                onClick={() => void runScanEmulators()}
              >
                {scanEmulators.isPending ? 'Scanning…' : 'Scan for emulators'}
              </Button>
            </div>
            {scanEmuMsg && <p className="text-2xs text-fg-muted">{scanEmuMsg}</p>}

            {emulators.length === 0 ? (
              <p className="text-2xs text-fg-faint">
                Download the recommended emulator, unzip it into the emulator folder, then Scan to register it.
              </p>
            ) : (
              <div className="space-y-3">
                <FormField label="Emulator">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Select value={emuId ?? ''} onChange={(e) => chooseEmu(Number(e.target.value))}>
                        {emulators.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <IconButton
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => void removeEmulator()}
                      label="Remove this emulator"
                      variant="danger"
                    />
                  </div>
                </FormField>
                <FormField label="Launch arguments">
                  <LaunchArgsEditor value={template} onChange={setTemplate} />
                </FormField>
                <Button variant="primary" onClick={() => void saveBinding(selected.id)}>
                  Save
                </Button>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <FormField
                label="Scan games folder"
                hint="Picks up games you added yourself and re-links any you renamed. Runs automatically at startup."
              >
                <Button
                  variant="secondary"
                  icon={<FolderSearch className="h-4 w-4" />}
                  disabled={scanFolder.isPending}
                  onClick={() => scanFolder.mutate({ systemId: selected.id })}
                >
                  {scanFolder.isPending ? 'Scanning…' : 'Scan now'}
                </Button>
              </FormField>
              {scanFolder.isSuccess && (
                <p className="text-2xs text-fg-muted">
                  {[
                    scanFolder.data.added > 0 ? `${scanFolder.data.added} added` : '',
                    scanFolder.data.relinked > 0 ? `${scanFolder.data.relinked} re-linked` : '',
                    scanFolder.data.missing > 0 ? `${scanFolder.data.missing} missing` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || `Nothing changed - ${scanFolder.data.matched} game(s) present.`}
                </p>
              )}
              {scanFolder.isError && <p className="text-2xs text-danger">{(scanFolder.error as Error).message}</p>}
            </div>

            <div>
              <FormField label="Saves folder">
                <FolderPicker
                  value={savesDirs[selected.slug] ?? ''}
                  onChange={(folderPath) => setSavesDir(selected.slug, folderPath)}
                  placeholder="Folder where this system's saves live"
                />
              </FormField>
            </div>
          </div>
        </Card>
      )}

      <Card title="Add a custom system">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Name" className="min-w-48 flex-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Sega Saturn" />
          </FormField>
          <Button variant="secondary" onClick={() => void addSystem()}>
            Add system
          </Button>
        </div>
      </Card>
    </div>
  );
}
