import { type ReactNode } from 'react';
import { Focusable } from './Focusable';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-e1',
  secondary: 'bg-surface-2 text-fg hover:bg-overlay',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'text-danger hover:bg-danger/10',
};
const SIZE: Record<Size, string> = {
  sm: 'gap-1.5 px-2.5 py-1 text-2xs',
  md: 'gap-2 px-3.5 py-2 text-sm',
  lg: 'gap-2.5 px-5 py-3 text-base', // 10-foot / Big Screen
};

interface ButtonProps {
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  /** Stretch to fill the container (e.g. equal-width dialog actions in a grid/flex row). */
  fullWidth?: boolean;
  /** Spatial-nav focus key, so callers can move controller focus to this button. */
  focusKey?: string;
  title?: string;
  className?: string;
}

/** A spatial-focusable button - reachable by mouse, keyboard, and gamepad alike. */
export function Button({
  onClick,
  children,
  icon,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  focusKey,
  title,
  className = '',
}: ButtonProps) {
  return (
    <Focusable
      ariaLabel={title}
      focusKey={focusKey}
      focusable={!disabled}
      onSelect={disabled ? undefined : onClick}
      // rounded-md on the WRAPPER too: the focus ring draws on this element, and a
      // ring follows its border-radius - without it the ring is a square box around
      // the rounded button.
      className={`${fullWidth ? 'flex w-full' : 'inline-flex'} rounded-md`}
    >
      <span
        title={title}
        className={`inline-flex select-none items-center justify-center rounded-md font-medium transition-colors ${SIZE[size]} ${VARIANT[variant]} ${fullWidth ? 'w-full' : ''} ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${className}`}
      >
        {icon}
        {children}
      </span>
    </Focusable>
  );
}
