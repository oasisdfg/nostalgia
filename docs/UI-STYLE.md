# Nostalgia UI Style Guide

**This document is the standing reference for ALL renderer UI work.** Every new feature,
view, or component must follow it. When a PR adds UI that violates a rule here, the PR is
wrong - not the guide.

## Principles

1. **Seamless.** No hairline borders, anywhere, ever. Depth and grouping read from surface
   color steps, soft shadows, and spacing - never from a 1px line. If you're about to type
   `border border-…`, stop and pick a recipe below.
2. **Art is the border.** Game cards, covers, and screenshots end at their own edge. Their
   affordance comes from a hover shadow and a focus ring, not an outline.
3. **Layered near-black surfaces.** The world is built from four charcoal steps
   (bg → surface → surface-2 → overlay). An element's "height" is its surface step + shadow.
4. **Restrained accent.** The emerald accent (retinted per console) appears only on: the
   active/selected item, primary buttons, focus rings, progress fills, and small state
   glyphs. Never as decoration.
5. **Zero mouse dependency.** Everything focusable via `Focusable`/`FocusSection`
   (spatial nav). Anything revealed on `hover` must also be revealed on spatial `focused`.

## Token system (the only three files)

| File | Owns |
|---|---|
| `src/renderer/theme/tokens.css` | Color tokens (`--n-bg`, `--n-surface`, `--n-accent`, …) |
| `tailwind.config.ts` | Radii, type scale, shadows (`e1/e2/e3`, `inset-1`, `up`), animations |
| `src/renderer/theme/classes.ts` | Composable recipes: `field`, `panel`, `well`, `focusRing` |

Never ad-hoc hex colors, never ad-hoc px values. Spacing uses the Tailwind scale
(4/8/12/16/24/32 = `1/2/3/4/6/8`). New tokens are added to these files first, then used.

## Elevation ladder

| Level | Surface | Shadow | Use |
|---|---|---|---|
| 0 - canvas | `bg` (13 13 14) | none | window background, backdrops |
| −1 - recessed well | `bg-bg/70` or `bg-bg/60` | `shadow-inset-1` | inputs, read-only paths, file/save rows, chips |
| 1 - panel | `bg-surface` | `shadow-e1` | cards, settings sections, bars |
| 2 - raised panel | `bg-surface/85 backdrop-blur` | `shadow-e2` | side panels over artwork (GameDetail) |
| 2 - hover | `bg-surface-2` → `hover:bg-overlay` | - | secondary buttons, selects, hover states |
| 3 - floating | `bg-overlay` | `shadow-e3` | menus, dialogs, toasts, popovers |

Rules of thumb:
- A surface ON TOP of artwork/backdrop gets `backdrop-blur` + translucent surface.
- Bottom-anchored bars replace `border-t` with `shadow-up`.
- Dividers inside a panel are **spacing + a section label**, not a line.

## Recipes (copy-paste)

```tsx
// Input / select / search (recessed well + focus ring - never a border):
import { field } from '@renderer/theme/classes';
<input className={field} />
// raw: 'w-full rounded-md bg-bg/70 shadow-inset-1 px-3 py-2 text-sm text-fg
//       placeholder:text-fg-faint outline-none transition-colors focus:bg-bg
//       focus:ring-1 focus:ring-accent/60'

// Panel / card section:
import { panel } from '@renderer/theme/classes'; // 'rounded-lg bg-surface shadow-e1'

// Recessed content well (file rows, opaque paths, chips):
import { well } from '@renderer/theme/classes'; // 'rounded-md bg-bg/60 shadow-inset-1'

// Search over artwork (catalog header):
'rounded-md bg-black/25 shadow-inset-1 backdrop-blur-sm focus:bg-black/40 focus:ring-1 focus:ring-accent/60'

// Floating menu / dialog / toast:
'rounded-lg bg-overlay shadow-e3'   // + animate-pop-in / animate-fade-in

// Secondary button surface:
'bg-surface-2 text-fg hover:bg-overlay'   // NO border

// Game-card scrim (the seamless card edge - copy exactly):
<div className="pointer-events-none absolute -inset-px rounded-[13px]
  bg-gradient-to-t from-black/95 via-black/35 to-transparent
  [box-shadow:inset_0_0_4px_2px_rgb(0_0_0/0.25)]" />
// -inset-px + 13px radius = concentric, 1px larger than the rounded-lg (12px) image,
// covering its anti-aliased corners (kills the bright corner sliver). Keep the inset
// fade SOFT (0.25) - stronger reads as a black outline.

// Card focus/hover affordance (never transform - it rasterizes overlay text):
focused ? 'shadow-e2 ring-2 ring-accent' : 'group-hover:shadow-e2'

// Hover-revealed info on cards (must also reveal on spatial focus):
focused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'

// Card title (small at rest, grows on hover/focus - font-size only):
focused ? 'text-xs' : 'text-2xs group-hover:text-xs'
```

## Focus & gamepad rules

- Every interactive element registers with spatial navigation (`Focusable` /
  `FocusSection`); a control with no focusable wrapper is a bug.
- Focus affordance = `ring-2 ring-accent` (cards) or `ring-1 ring-accent/60` (fields).
- Anything shown on `group-hover:` must have a `focused ?` twin - the gamepad has no hover.
- Big Screen additionally lifts the focused card (`-translate-y-1 scale-[1.04]
  border-accent shadow-e3`); that transform exception is fine there because Big Screen
  cards keep the title INSIDE the transformed layer at `text-base` (still crisp at 10 ft).

## Motion

- Transitions: 150ms (`duration-150`), ease default. Entry: `animate-fade-in` (160ms) /
  `animate-pop-in` (180ms).
- Never `transform` (scale/translate) on desktop cards or any layer containing overlay
  text - Chromium rasterizes it and text goes soft. Big Screen cards are the one exception.
- Progress bars animate width (`transition-all`); indeterminate = `animate-pulse` fill at
  `bg-accent/40`, never a fake fixed percentage.

## Do / Don't

| Do | Don't |
|---|---|
| `bg-surface-2` step for hover | `hover:border-…` |
| `shadow-inset-1` recessed inputs | `border border-border` fields |
| spacing + label as divider | `border-t border-border` |
| `shadow-up` under bottom bars | `border-t` on hint bars |
| `bg-overlay shadow-e3` menus | bordered popovers |
| accent on state only | accent decorative washes |
| `asset://` URLs for art | `file://` anywhere |
| tokens from the three files | ad-hoc hex/px |

**Allowed `--n-border*` uses (the only two):** the OS scrollbar styling in
`styles/index.css` and the `Spinner` arc. `grep -rn "border-border" src/renderer`
returning anything else means a regression.
