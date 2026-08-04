import { useState } from 'react';
import { Cpu, SlidersHorizontal, Link2 } from 'lucide-react';
import { useUiStore } from '@renderer/store/uiStore';
import { useDownloadEvents } from '@renderer/query/useDownloads';
import { useLaunchEvents } from '@renderer/query/useLaunch';
import { useScrapeEvents } from '@renderer/query/useScrape';
import { useSavesEvents } from '@renderer/query/useSaves';
import { useSystems } from '@renderer/query/useSystems';
import { useBoxartUpgrade } from '@renderer/query/useGames';
import { FocusProvider } from '@renderer/input/spatialNav';
import { AppSidebar } from '@renderer/components/AppSidebar';
import { getPlatformTheme, consoleAccentVars } from '@renderer/theme/consoleTheme';
import { consoleBackdropStyle, gameBackdropStyle } from '@renderer/components/ConsoleBackdrop';
import { LibraryView } from './LibraryView';
import { DownloadsView } from '@renderer/components/DownloadsView';
import { SystemsSettings } from './settings/SystemsSettings';
import { GeneralSettings } from './settings/GeneralSettings';
import { SourcesSettings } from './settings/SourcesSettings';

type SettingsTab = 'general' | 'systems' | 'sources';

export function DesktopShell() {
  useDownloadEvents();
  useLaunchEvents();
  useScrapeEvents();
  useSavesEvents();
  useBoxartUpgrade();
  const view = useUiStore((s) => s.view);
  const activeSystemId = useUiStore((s) => s.activeSystemId);
  const detailBackdropUrl = useUiStore((s) => s.detailBackdropUrl);
  const { data: systems = [] } = useSystems(true);
  const [tab, setTab] = useState<SettingsTab>('general');

  // Retint the accent to the active console (Library view only) so the selected
  // sidebar item, toolbar, and focus rings all read in that console's color.
  const activeSlug = view === 'library' ? systems.find((s) => s.id === activeSystemId)?.slug : undefined;
  const theme = getPlatformTheme(activeSlug);
  const accentVars = consoleAccentVars(theme);
  // An open game detail replaces the console backdrop with the game's own artwork app-wide.
  const backdrop = detailBackdropUrl ? gameBackdropStyle(detailBackdropUrl) : consoleBackdropStyle(activeSlug);

  return (
    <FocusProvider>
      <div className="flex h-screen bg-bg text-fg" style={{ ...accentVars, ...backdrop }}>
        <AppSidebar />
        <main className="min-h-0 min-w-0 flex-1">
          {view === 'settings' ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* Top-bar navigation: horizontal tabs with an active underline, content full-width below. */}
              <nav className="flex h-14 shrink-0 items-center justify-center gap-1 px-6">
                {(
                  [
                    ['general', 'General', <SlidersHorizontal key="i" className="h-4 w-4" />],
                    ['systems', 'Systems', <Cpu key="i" className="h-4 w-4" />],
                    ['sources', 'Sources', <Link2 key="i" className="h-4 w-4" />],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`relative flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors ${
                      tab === key
                        ? 'bg-surface-2 text-fg after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent'
                        : 'text-fg-muted hover:bg-surface-2/50 hover:text-fg'
                    }`}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </nav>
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="mx-auto max-w-5xl px-8 py-7">
                  {tab === 'general' ? (
                    <GeneralSettings />
                  ) : tab === 'systems' ? (
                    <SystemsSettings />
                  ) : (
                    <SourcesSettings />
                  )}
                </div>
              </div>
            </div>
          ) : view === 'downloads' ? (
            <DownloadsView />
          ) : (
            <LibraryView />
          )}
        </main>
      </div>
    </FocusProvider>
  );
}
