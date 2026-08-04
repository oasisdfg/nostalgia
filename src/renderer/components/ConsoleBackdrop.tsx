import type { CSSProperties } from 'react';
import { getPlatformTheme, consoleWash } from '@renderer/theme/consoleTheme';

// User-supplied per-console backdrop images live in src/renderer/backdrops/, bundled
// as URLs. Filenames vary, so a slug→basename map bridges them (like CONSOLE_LOGO_FILE).
// A missing file falls back to the CSS "Aurora" wash, so a console without an image
// still reads as themed and the build never breaks.
const files = import.meta.glob('../backdrops/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const urlByBase: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const m = /\/([^/]+)\.\w+$/.exec(path);
  if (m) urlByBase[m[1]] = url;
}

const BACKDROP_FILE: Record<string, string> = {
  ps1: 'ps1backdrop',
  ps2: 'ps2back',
  ps3: 'ps3back',
  psp: 'pspback',
  xbox: 'originalxboxback',
  xbox360: 'xbox360backdrop',
  gamecube: 'gamecubeback',
  wii: 'wiiback',
  gba: 'gbaback',
  '3ds': 'nintendo3dsbackdrop',
  snes: 'snesback',
  n64: 'n64back',
};

/** The console's raw backdrop image URL (for banners etc.), or undefined when none exists. */
export function consoleBackdropUrl(slug?: string): string | undefined {
  return slug ? urlByBase[BACKDROP_FILE[slug] ?? ''] : undefined;
}
const backdropUrl = consoleBackdropUrl;

/**
 * Root background for the active console: the user's backdrop IMAGE (full-bleed cover
 * with a CSS-gradient scrim - light overall so the image shows, darker on the left so
 * the sidebar text stays legible), or the CSS Aurora wash when no image exists. Applied
 * as the shell root's plain `style` background, so it sits behind ALL content with no
 * z-index / stacking-context concerns (the previous absolute `-z-10` layer was hidden
 * by the root's opaque bg). Returns {} for the no-console (Library) state.
 */
export function consoleBackdropStyle(slug?: string): CSSProperties {
  const img = backdropUrl(slug);
  if (img) {
    return {
      backgroundImage: [
        'linear-gradient(rgb(var(--n-bg) / 0.42), rgb(var(--n-bg) / 0.42))',
        'linear-gradient(to right, rgb(var(--n-bg) / 0.55), rgb(var(--n-bg) / 0) 36%)',
        `url("${img}")`,
      ].join(', '),
      // `cover` so the image fills the ENTIRE background at any window size (no empty
      // bars); the two scrim gradients sit on top to keep sidebar text legible.
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    } as CSSProperties;
  }
  const theme = getPlatformTheme(slug);
  return theme ? consoleWash(theme) : {};
}

/**
 * Full-bleed game artwork as the app-wide background (used on a game detail page,
 * replacing the console backdrop). `cover` fills the whole window; a light overall dim
 * keeps it readable while the detail page adds its own stronger scrim over the text.
 */
export function gameBackdropStyle(url: string): CSSProperties {
  return {
    backgroundImage: [
      // ALL of the detail page's shading lives in these two window-wide gradients (the
      // page adds NO local scrim) so sidebar and content share the exact same shade with
      // no visible step at the sidebar edge: an overall dim + bottom fade for text, and
      // one smooth left→right fade that covers sidebar + text column continuously.
      `linear-gradient(to top, rgb(var(--n-bg) / 0.78), rgb(var(--n-bg) / 0.42) 45%, rgb(var(--n-bg) / 0.3))`,
      `linear-gradient(to right, rgb(var(--n-bg) / 0.72), rgb(var(--n-bg) / 0.5) 45%, rgb(var(--n-bg) / 0.12))`,
      `url("${url}")`,
    ].join(', '),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  } as CSSProperties;
}
