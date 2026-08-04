import type { CSSProperties } from 'react';
import { PLATFORM_THEMES, type PlatformTheme } from '@shared/contracts/catalog';

/** The per-console theme for a slug, or undefined to keep the default emerald accent. */
export function getPlatformTheme(slug: string | undefined | null): PlatformTheme | undefined {
  return slug ? PLATFORM_THEMES[slug] : undefined;
}

function lighten(triplet: string, by = 26): string {
  return triplet
    .split(' ')
    .map((n) => Math.min(255, Number(n) + by))
    .join(' ');
}

/**
 * CSS-var overrides that retint the accent (and its hover) to a console's color.
 * Apply to a wrapper so everything inside - the selected sidebar item, buttons,
 * focus rings - adopts the console hue. Returns {} for systems without a theme.
 */
export function consoleAccentVars(theme: PlatformTheme | undefined): CSSProperties {
  if (!theme) return {};
  return {
    ['--n-accent' as string]: theme.accent,
    ['--n-accent-hover' as string]: lighten(theme.accent),
  } as CSSProperties;
}

// Light, low-chroma accents (PS3 silver, DS silver-blue) read as milky gray "smog"
// at full alpha on near-black - damp their peak so they stay a faint cool haze. The
// saturated accents (Xbox green, N64 red, GameCube purple…) bloom at full strength.
function accentAlpha(triplet: string, base: number): number {
  const [r, g, b] = triplet.split(' ').map(Number);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const milky = lum > 0.62 && chroma < 0.32 ? 0.78 : 1;
  return +(base * milky).toFixed(3);
}

// 0.16 is the legibility ceiling for the primary stop - above it the wash starts
// competing with cover art. All secondary stops are fractions of the damped peak.
const PEAK = 0.16;

/**
 * "Aurora Bloom" - three soft accent radial blooms (a dominant one bleeding in from
 * just above the top-left corner, a smaller top-right echo, and a faint floor bloom
 * rising from the bottom) that read as ambient corner-light with real volumetric
 * depth and no hard top edge. One implementation; the accent does all per-console
 * theming. Pure CSS, painted once on the non-scrolling column → pinned, no jank.
 */
function washAurora(theme: PlatformTheme): CSSProperties {
  const a = theme.accent;
  const p = accentAlpha(a, PEAK);
  return {
    backgroundImage: [
      `radial-gradient(115% 78% at 12% -10%, rgb(${a} / ${p}) 0%, rgb(${a} / ${(p * 0.36).toFixed(3)}) 26%, transparent 52%)`,
      `radial-gradient(85% 58% at 94% 2%, rgb(${a} / ${(p * 0.6).toFixed(3)}) 0%, transparent 46%)`,
      `radial-gradient(150% 105% at 62% 122%, rgb(${a} / ${(p * 0.42).toFixed(3)}) 0%, transparent 56%)`,
    ].join(', '),
  } as CSSProperties;
}

/**
 * "Dual-Light Accent Mesh" - Aurora's two corner blooms plus one faint diagonal
 * light band, for a subtle sense of directional structure. The band angle can vary
 * by console family via --n-mesh-angle (see consoleMeshAngle).
 */
function washMesh(theme: PlatformTheme): CSSProperties {
  const a = theme.accent;
  const p = accentAlpha(a, PEAK);
  return {
    backgroundImage: [
      `radial-gradient(120% 80% at 8% -8%, rgb(${a} / ${p}) 0%, rgb(${a} / ${(p * 0.38).toFixed(3)}) 26%, transparent 52%)`,
      `radial-gradient(90% 70% at 112% 116%, rgb(${a} / ${(p * 0.62).toFixed(3)}) 0%, rgb(${a} / ${(p * 0.22).toFixed(3)}) 30%, transparent 60%)`,
      `linear-gradient(var(--n-mesh-angle, 125deg), transparent 36%, rgb(${a} / ${(p * 0.32).toFixed(3)}) 50%, transparent 64%)`,
    ].join(', '),
  } as CSSProperties;
}

// Which backdrop the catalog ships. Switchable while we evaluate the two live.
const BACKDROP: 'aurora' | 'mesh' = 'aurora';

/**
 * A console-tinted ambient backdrop for a platform's catalog view: visible enough
 * to signal which console you're in, restrained enough not to fight the cover art.
 * Spread onto the (non-scrolling) catalog column; pair with the `catalog-stage`
 * class for the optional anti-banding grain. Returns {} for systems without a theme.
 */
export function consoleWash(theme: PlatformTheme | undefined): CSSProperties {
  if (!theme) return {};
  return BACKDROP === 'mesh' ? washMesh(theme) : washAurora(theme);
}

// Optional per-family diagonal-band angle for the Mesh backdrop (no-op for Aurora).
const MESH_ANGLE_BY_SLUG: Record<string, string> = {
  gba: '110deg',
  ds: '110deg',
  '3ds': '110deg',
  psp: '110deg',
  snes: '140deg',
  n64: '140deg',
  gamecube: '140deg',
  wii: '140deg',
};
export function consoleMeshAngle(slug?: string | null): CSSProperties {
  const ang = slug ? MESH_ANGLE_BY_SLUG[slug] : undefined;
  return ang ? ({ ['--n-mesh-angle' as string]: ang } as CSSProperties) : {};
}
