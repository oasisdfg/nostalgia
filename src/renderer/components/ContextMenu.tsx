import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FocusSection, Focusable } from './Focusable';
import { setFocus, getCurrentFocusKey, doesFocusableExist } from '@renderer/input/spatialNav';

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
 * Lightweight context menu rendered to a portal at the cursor (or at a card, when opened
 * from the keyboard/controller). Closes on outside click, Escape, scroll, resize, or blur.
 * Items are spatially focusable: the menu takes focus when it opens and hands it back to
 * whatever had it when it closes.
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
    const previous = getCurrentFocusKey();
    const r = requestAnimationFrame(() => setFocus('context-menu'));
    return () => {
      cancelAnimationFrame(r);
      if (previous && doesFocusableExist(previous)) requestAnimationFrame(() => setFocus(previous));
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // close the menu, not the page behind it
      onClose();
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
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
      <FocusSection focusKey="context-menu">
        {items.map((it, i) => (
          <Focusable
            key={i}
            ariaLabel={it.label}
            focusable={!it.disabled}
            focusClassName=""
            className="block"
            onSelect={
              it.disabled
                ? undefined
                : () => {
                    it.onClick();
                    if (!it.keepOpen) onClose();
                  }
            }
          >
            {(focused) => (
              <span
                role="menuitem"
                aria-disabled={it.disabled || undefined}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  it.disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'
                } ${
                  it.danger
                    ? focused
                      ? 'bg-danger/15 text-danger'
                      : 'text-danger hover:bg-danger/12'
                    : focused
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg hover:bg-surface-2'
                }`}
              >
                {it.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{it.icon}</span>}
                {it.label}
              </span>
            )}
          </Focusable>
        ))}
      </FocusSection>
    </div>,
    document.body,
  );
}
