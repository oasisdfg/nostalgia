import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { useUiStore } from '@renderer/store/uiStore';
import { DesktopShell } from '@renderer/modes/desktop/DesktopShell';
import { BigScreenShell } from '@renderer/modes/bigscreen/BigScreenShell';
import { OnboardingWizard } from '@renderer/components/OnboardingWizard';
import { useSetting } from '@renderer/query/useSettings';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ToastHost, useToasts } from '@renderer/components/Toast';
import { LaunchPromptHost } from '@renderer/components/LaunchPromptHost';

const reportError = (err: unknown): void => {
  useToasts.getState().push(err instanceof Error ? err.message : 'Something went wrong.');
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportError }),
  mutationCache: new MutationCache({ onError: reportError }),
});

function Root() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  // First-run gate: block the shell until the onboarding wizard sets `setup.completed`.
  // It's a one-time flag (not derived state), so clearing keys or metadata later never
  // re-triggers onboarding.
  const setup = useSetting('setup.completed');

  useEffect(() => {
    void (async () => {
      try {
        const defaultMode = await window.nostalgia.invoke('settings:get', { key: 'ui.defaultMode' });
        if (defaultMode && defaultMode.value === 'bigscreen') setMode('bigscreen');
        // Boot self-check: round-trip the data layer through IPC, then signal health.
        const systems = await window.nostalgia.invoke('systems:list', { enabledOnly: false });
        const games = await window.nostalgia.invoke('games:list', {});
        console.log('[renderer] systems', systems.length, 'games', games.total);
        const health = await window.nostalgia.invoke('app:health', undefined);
        console.log('[renderer] app:health', health);
      } catch (e) {
        console.error('[renderer] boot self-check failed', e);
      }
    })();
  }, [setMode]);

  // Hold on a neutral splash until the flag has resolved, so the wizard never flashes
  // for an already-set-up user.
  if (setup.isLoading) return <div className="h-screen bg-bg" />;
  const setupDone = setup.data != null && !setup.data.encrypted && setup.data.value === true;
  if (!setupDone) return <OnboardingWizard />;

  return mode === 'bigscreen' ? <BigScreenShell /> : <DesktopShell />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Root />
        <LaunchPromptHost />
        <ToastHost />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
