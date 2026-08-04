import { LaunchPreflightDialog } from './LaunchPreflightDialog';
import { useLaunch } from '@renderer/query/useLaunch';
import { useUiStore } from '@renderer/store/uiStore';

/**
 * Renders the pre-launch setup reminder for whichever Play path raised it. Mounted ONCE at
 * app level so every call site (library pop-out, catalog page, downloads list, Big Screen)
 * is covered by useGuardedLaunch alone, with no per-consumer dialog wiring.
 */
export function LaunchPromptHost() {
  const prompt = useUiStore((s) => s.launchPrompt);
  const setLaunchPrompt = useUiStore((s) => s.setLaunchPrompt);
  const launch = useLaunch();

  if (!prompt) return null;

  const close = (): void => setLaunchPrompt(null);
  const proceed = (): void => {
    launch.mutate({ gameId: prompt.gameId, gameFileId: prompt.gameFileId });
    close();
  };

  return (
    <LaunchPreflightDialog
      preflight={prompt.preflight}
      gameId={prompt.gameId}
      systemId={prompt.systemId}
      onProceed={proceed}
      onClose={close}
    />
  );
}
