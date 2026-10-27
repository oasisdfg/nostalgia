import { useSetting, useSetSetting } from '@renderer/query/useSettings';
import { FormField } from './FormField';
import { Select } from './Select';
import { Button } from './Button';
import {
  PORT_SETTING_KEYS,
  type PortSettingKey,
  type RecompManifest,
  type RecompUserConfig,
} from '@shared/contracts/recomps';

export const SETTING_LABEL: Record<PortSettingKey, string> = {
  fullscreen: 'Display',
  resolution: 'Resolution',
  frameCap: 'Frame rate',
};

const CHOICE_LABEL: Record<string, string> = {
  on: 'Fullscreen',
  off: 'Windowed',
  original: 'Original',
  original2x: 'Original ×2',
  window: 'Match window',
  window2x: 'Window ×2',
  display: 'Match display',
};

export function choiceLabel(choice: string | undefined): string {
  if (choice == null) return "Port's own setting";
  return CHOICE_LABEL[choice] ?? (/^\d+$/.test(choice) ? `${choice} fps` : choice);
}

/** The settings this port supports, each with its choice ids in manifest order. */
export function portSettingOptions(manifest: RecompManifest): { key: PortSettingKey; choices: string[] }[] {
  const options = manifest.config?.options ?? {};
  return PORT_SETTING_KEYS.filter((k) => options[k] && Object.keys(options[k]!).length > 0).map((key) => ({
    key,
    choices: Object.keys(options[key]!),
  }));
}

/** Read/write the user's picks for one port (`recomps.config` setting: { [id]: picks }). */
export function usePortConfig(recompId: string): {
  picks: RecompUserConfig;
  set: (key: PortSettingKey, choice: string | undefined) => void;
} {
  const setting = useSetting('recomps.config');
  const setSetting = useSetSetting();
  const all =
    setting.data?.value && typeof setting.data.value === 'object'
      ? (setting.data.value as Record<string, RecompUserConfig>)
      : {};
  const picks = all[recompId] ?? {};
  const set = (key: PortSettingKey, choice: string | undefined): void => {
    const next: RecompUserConfig = { ...picks };
    if (choice == null) delete next[key];
    else next[key] = choice;
    setSetting.mutate({ key: 'recomps.config', value: { ...all, [recompId]: next }, encrypted: false });
  };
  return { picks, set };
}

/**
 * Desktop: one dropdown per supported setting. "Port's own setting" leaves the port's
 * config untouched; anything else is written into the port's config before each launch.
 */
export function PortSettings({ manifest }: { manifest: RecompManifest }) {
  const { picks, set } = usePortConfig(manifest.id);
  const rows = portSettingOptions(manifest);
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {rows.map(({ key, choices }) => (
        <FormField key={key} label={SETTING_LABEL[key]}>
          <Select value={picks[key] ?? ''} onChange={(e) => set(key, e.target.value || undefined)}>
            <option value="">{choiceLabel(undefined)}</option>
            {choices.map((c) => (
              <option key={c} value={c}>
                {choiceLabel(c)}
              </option>
            ))}
          </Select>
        </FormField>
      ))}
    </div>
  );
}

/**
 * Big Screen: one button per setting; A cycles through "port's own" and each choice -
 * a dropdown is unusable on a gamepad.
 */
export function PortSettingsCycle({ manifest }: { manifest: RecompManifest }) {
  const { picks, set } = usePortConfig(manifest.id);
  const rows = portSettingOptions(manifest);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {rows.map(({ key, choices }) => {
        const cycle: (string | undefined)[] = [undefined, ...choices];
        const at = cycle.indexOf(picks[key]);
        return (
          <Button key={key} size="lg" variant="secondary" onClick={() => set(key, cycle[(at + 1) % cycle.length])}>
            {SETTING_LABEL[key]}: {choiceLabel(picks[key])}
          </Button>
        );
      })}
    </div>
  );
}
