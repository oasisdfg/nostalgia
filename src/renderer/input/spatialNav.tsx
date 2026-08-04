import { useEffect, type ReactNode } from 'react';
import { init } from '@noriginmedia/norigin-spatial-navigation';

let started = false;

/** Initializes the spatial-navigation service once (keyboard arrows + enter by default). */
export function initSpatialNavigation(): void {
  if (started) return;
  started = true;
  init({ debug: false, visualDebug: false, throttle: 80, throttleKeypresses: true });
}

/** Mounts the spatial-navigation layer. Wrap the navigable UI in this. */
export function FocusProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initSpatialNavigation();
  }, []);
  return <>{children}</>;
}

export {
  useFocusable,
  FocusContext,
  setFocus,
  navigateByDirection,
  getCurrentFocusKey,
  doesFocusableExist,
} from '@noriginmedia/norigin-spatial-navigation';
export type { Direction } from '@noriginmedia/norigin-spatial-navigation';
