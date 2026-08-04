import { type ReactNode } from 'react';
import { Focusable } from './Focusable';

type Variant = 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'text-fg-muted hover:bg-danger/10 hover:text-danger',
};

/** Icon-only action button (edit, delete, remove, close). Spatial-focusable; a label is required for a11y. */
export function IconButton({
  icon,
  onClick,
  label,
  variant = 'ghost',
  disabled = false,
  className = '',
}: {
  icon: ReactNode;
  onClick?: () => void;
  label: string;
  variant?: Variant;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Focusable
      ariaLabel={label}
      focusable={!disabled}
      onSelect={disabled ? undefined : onClick}
      // rounded-md so the focus ring follows the button's rounded corners.
      className="inline-flex rounded-md"
    >
      <span
        title={label}
        className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors ${VARIANT[variant]} ${
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
        } ${className}`}
      >
        {icon}
      </span>
    </Focusable>
  );
}
