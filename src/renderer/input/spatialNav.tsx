import { useCallback, useEffect, type FocusEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { init, pause, resume, useFocusable } from '@noriginmedia/norigin-spatial-navigation';

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

/**
 * Spatial navigation for a text field or select. Arrows move ONTO the field like any control
 * (it shows the field focus ring); Enter/A starts editing - real DOM focus - and pauses
 * spatial navigation so arrows move the caret or change the option instead of leaving the
 * field. Escape/B, or clicking elsewhere, ends editing and resumes navigation. A mouse click
 * straight into the field pauses navigation the same way.
 */
export function useFieldFocusable<T extends HTMLElement>(forwarded: Ref<T> | undefined) {
  const { ref, focused } = useFocusable<object, T>({
    onEnterPress: () => ref.current?.focus(),
    onFocus: (layout) => layout.node?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
  });
  const setRef = useCallback(
    (el: T | null) => {
      (ref as { current: T | null }).current = el;
      if (typeof forwarded === 'function') forwarded(el);
      else if (forwarded) (forwarded as { current: T | null }).current = el;
    },
    [ref, forwarded],
  );
  // A field removed while being edited never fires blur - resume so the controller isn't stuck.
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el && el === document.activeElement) resume();
    };
  }, [ref]);
  const handlers = {
    onFocus: (_e: FocusEvent<T>) => pause(),
    onBlur: (_e: FocusEvent<T>) => resume(),
    onKeyDown: (e: KeyboardEvent<T>) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // leave the field, not the page
      e.currentTarget.blur();
    },
  };
  return { ref: setRef, focused, handlers };
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
