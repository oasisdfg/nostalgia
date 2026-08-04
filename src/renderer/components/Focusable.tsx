import { type ReactNode } from 'react';
import { useFocusable, FocusContext } from '@renderer/input/spatialNav';
import { focusRing } from '@renderer/theme/classes';

interface FocusableProps {
  onSelect?: () => void;
  onFocusChange?: (focused: boolean) => void;
  focusKey?: string;
  focusable?: boolean;
  className?: string;
  focusClassName?: string;
  ariaLabel?: string;
  children: ReactNode | ((focused: boolean) => ReactNode);
}

/** A leaf focusable element. Works identically for mouse (click) and spatial nav (enter). */
export function Focusable({
  onSelect,
  onFocusChange,
  focusKey,
  focusable = true,
  className = '',
  focusClassName = focusRing,
  ariaLabel,
  children,
}: FocusableProps) {
  const { ref, focused } = useFocusable<object, HTMLDivElement>({
    focusable,
    focusKey,
    onEnterPress: () => onSelect?.(),
    onFocus: (layout) => {
      layout.node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      onFocusChange?.(true);
    },
    onBlur: () => onFocusChange?.(false),
  });
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      aria-label={ariaLabel}
      onClick={() => onSelect?.()}
      className={`outline-none ${focused ? focusClassName : ''} ${className}`}
    >
      {typeof children === 'function' ? children(focused) : children}
    </div>
  );
}

interface FocusSectionProps {
  focusKey?: string;
  className?: string;
  saveLastFocusedChild?: boolean;
  ariaLabel?: string;
  children: ReactNode | ((focused: boolean, hasFocusedChild: boolean) => ReactNode);
}

/** A container that groups focusable children into one navigable region. */
export function FocusSection({
  focusKey,
  className = '',
  saveLastFocusedChild = true,
  ariaLabel,
  children,
}: FocusSectionProps) {
  const { ref, focusKey: fk, focused, hasFocusedChild } = useFocusable<object, HTMLDivElement>({
    focusKey,
    trackChildren: true,
    saveLastFocusedChild,
  });
  return (
    <FocusContext.Provider value={fk}>
      <div ref={ref} aria-label={ariaLabel} className={className}>
        {typeof children === 'function' ? children(focused, hasFocusedChild) : children}
      </div>
    </FocusContext.Provider>
  );
}
