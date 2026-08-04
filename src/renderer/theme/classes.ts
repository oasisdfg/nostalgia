// Shared class-string tokens that back the primitive components (Input, Select,
// Card, Label, Button, Focusable). Primitives compose these; screens compose the
// primitives - never ad-hoc px/hex. Color tokens live in theme/tokens.css; the
// spacing scale (4/8/12/16/24/32 = Tailwind 1/2/3/4/6/8), radii, type scale, and
// shadows live in tailwind.config.ts. Those three files are the whole token system.
//
// SEAMLESS RULE (docs/UI-STYLE.md): no hairline borders anywhere. Depth reads from
// three tools only - surface-step contrast (bg → surface → surface-2 → overlay),
// soft shadows (e1/e2/e3, inset-1 for recessed wells), and focus rings.

export const field =
  'w-full rounded-md bg-bg/70 shadow-inset-1 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition-colors focus:bg-bg focus:ring-1 focus:ring-accent/60';

export const panel = 'rounded-lg bg-surface shadow-e1';

/** Recessed well - read-only paths, file rows, chips: content that sits INTO a panel. */
export const well = 'rounded-md bg-bg/60 shadow-inset-1';

/** Focus ring applied to spatial-/keyboard-focused interactive elements. */
export const focusRing = 'ring-2 ring-accent ring-offset-2 ring-offset-bg';
