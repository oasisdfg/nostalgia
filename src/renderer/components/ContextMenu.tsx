import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Keep the menu open after click (e.g. a click-to-confirm first step). */
  keepOpen?: boolean;
}

/**
 * Lightweight right-click menu rendered to a portal at the cursor. Closes on
 * outside click, Escape, scroll, resize, or blur. Mouse-driven Desktop chrome, so
 * the items are plain buttons (it renders outside the spatial-nav FocusProvider).
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Clamp into the viewport so a card near an edge doesn't push the menu off-screen.
  const width = 200;
  const height = items.length * 38 + 8;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left, top, minWidth: width }}
      onContextMenu={(e) => e.preventDefault()}
      className="animate-fade-in fixed z-50 overflow-hidden rounded-lg bg-overlay py-1 shadow-e3"
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          onClick={() => {
            it.onClick();
            if (!it.keepOpen) onClose();
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-40 ${
            it.danger ? 'text-danger hover:bg-danger/12' : 'text-fg hover:bg-surface-2'
          }`}
        >
          {it.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{it.icon}</span>}
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
