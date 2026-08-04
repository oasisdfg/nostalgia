import { siPlaystation } from 'simple-icons';

type GlyphName = 'cartridge' | 'controller' | 'cube' | 'tower' | 'handheld' | 'dualscreen' | 'grid';
type IconDef = { brand: string } | { glyph: GlyphName };

// Original solid glyphs (24x24, fill=currentColor) - our own designs (NOT the
// trademarked console logos), differentiated by device form factor so each row
// reads distinctly while staying monochrome + accent-tintable to match the UI.
// These are the FALLBACK: dropping a real logo file into assets/console-logos/
// overrides any of them per the file-first resolution below.
const GLYPHS: Record<GlyphName, { d: string; evenOdd?: boolean }> = {
  // cartridge: classic game cart with a label window.
  cartridge: {
    d: 'M7 2.5h10A2.5 2.5 0 0 1 19.5 5v14a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 19V5A2.5 2.5 0 0 1 7 2.5Zm1 3.5a1 1 0 0 0-1 1v3.2a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H8Z',
    evenOdd: true,
  },
  // controller: gamepad silhouette with two grips (Xbox family).
  controller: {
    d: 'M6.5 8.5h11a4.5 4.5 0 0 1 4.4 5.6l-.5 2.3A2.9 2.9 0 0 1 16.6 18L15 15.5H9L7.4 18a2.9 2.9 0 0 1-4.8-1.6l-.5-2.3A4.5 4.5 0 0 1 6.5 8.5Z',
  },
  // cube: boxy console with a carry handle (GameCube form factor).
  cube: {
    d: 'M6 9.5h12a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5V11A1.5 1.5 0 0 1 6 9.5Z M9 9.5V7.8a3 3 0 0 1 6 0v1.7h-2V7.8a1 1 0 0 0-2 0v1.7Z',
  },
  // tower: slim upright console with a disc slot + base (Wii stands vertically).
  tower: {
    d: 'M9.5 4h5A1.5 1.5 0 0 1 16 5.5v12.5A1.5 1.5 0 0 1 14.5 19.5h-5A1.5 1.5 0 0 1 8 18V5.5A1.5 1.5 0 0 1 9.5 4Z M10.3 6.6h3.4v.9h-3.4Z M7.5 19.5h9V21h-9Z',
    evenOdd: true,
  },
  // handheld: landscape device with a central screen window (Game Boy Advance).
  handheld: {
    d: 'M3 7.5h18A1.5 1.5 0 0 1 22.5 9v6A1.5 1.5 0 0 1 21 16.5H3A1.5 1.5 0 0 1 1.5 15V9A1.5 1.5 0 0 1 3 7.5Z M7.5 9.5h9a.8 .8 0 0 1 .8.8v3.4a.8 .8 0 0 1-.8.8h-9a.8 .8 0 0 1-.8-.8v-3.4a.8 .8 0 0 1 .8-.8Z',
    evenOdd: true,
  },
  // dualscreen: two stacked panels (Nintendo DS clamshell).
  dualscreen: {
    d: 'M5 3.5h14A1.5 1.5 0 0 1 20.5 5v5.5A1.5 1.5 0 0 1 19 12H5A1.5 1.5 0 0 1 3.5 10.5V5A1.5 1.5 0 0 1 5 3.5Z M5 13h14A1.5 1.5 0 0 1 20.5 14.5V20A1.5 1.5 0 0 1 19 21.5H5A1.5 1.5 0 0 1 3.5 20v-5.5A1.5 1.5 0 0 1 5 13Z',
  },
  grid: { d: 'M3.5 3.5h7v7h-7Zm10 0h7v7h-7Zm-10 10h7v7h-7Zm10 0h7v7h-7Z' },
};

const CARTRIDGE: IconDef = { glyph: 'cartridge' };
// PlayStation is the only console brand mark that ships cleanly (CC0) in
// simple-icons; the whole family shares it (the label disambiguates).
const PLAYSTATION: IconDef = { brand: siPlaystation.path };

/**
 * Single source mapping a system slug -> its sidebar glyph. Adding a system later
 * is a one-line change here. Slugs mirror IGDB_PLATFORM_BY_SLUG in
 * @shared/contracts/catalog. (A logo file in assets/console-logos/ overrides this.)
 */
export const SYSTEM_ICONS: Record<string, IconDef> = {
  ps1: PLAYSTATION,
  ps2: PLAYSTATION,
  ps3: PLAYSTATION,
  psp: PLAYSTATION,
  xbox360: { glyph: 'controller' },
  xbox: { glyph: 'controller' },
  gamecube: { glyph: 'cube' },
  wii: { glyph: 'tower' },
  ds: { glyph: 'dualscreen' },
  '3ds': { glyph: 'dualscreen' },
  gba: { glyph: 'handheld' },
  snes: { glyph: 'cartridge' },
  n64: { glyph: 'cartridge' },
  nes: { glyph: 'cartridge' },
  wiiu: { glyph: 'controller' },
  switch: { glyph: 'handheld' },
  atari2600: { glyph: 'cartridge' },
  genesis: { glyph: 'cartridge' },
  saturn: { glyph: 'cube' },
  dreamcast: { glyph: 'cube' },
  all: { glyph: 'grid' },
};

/** Monochrome, currentColor-tinted icon for a system slug. Crisp at small sizes. */
export function SystemIcon({ slug, className = 'h-4 w-4' }: { slug: string; className?: string }) {
  const def = SYSTEM_ICONS[slug] ?? CARTRIDGE;
  if ('brand' in def) {
    return (
      <svg role="img" aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d={def.brand} />
      </svg>
    );
  }
  const g = GLYPHS[def.glyph];
  return (
    <svg role="img" aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d={g.d} fillRule={g.evenOdd ? 'evenodd' : 'nonzero'} clipRule={g.evenOdd ? 'evenodd' : 'nonzero'} />
    </svg>
  );
}

// --- Per-console brand logos ------------------------------------------------
// Local logo files (no network) live in src/renderer/console-logos/, named by
// basename. They're discovered via import.meta.glob (eager, as bundled URLs) so a
// MISSING file simply isn't in the map - the row falls back to the glyph above and
// the build never breaks on an absent logo. SVG is preferred; PNG is the fallback.
const logoUrlByPath = import.meta.glob('../console-logos/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const logoUrlByBase: Record<string, { svg?: string; png?: string }> = {};
for (const [path, url] of Object.entries(logoUrlByPath)) {
  const m = /\/([^/]+)\.(svg|png)$/i.exec(path);
  if (m) (logoUrlByBase[m[1]] ??= {})[m[2].toLowerCase() as 'svg' | 'png'] = url;
}

/**
 * One source of truth: system slug -> console-logos basename (SVG preferred, PNG
 * fallback). Bridges naming differences (the Nintendo DS slug is `ds`, file `nds`).
 * "all" is intentionally absent - it keeps the neutral grid glyph. Add a console by
 * dropping `<basename>.svg` here and (if the name differs) one line in this map.
 */
export const CONSOLE_LOGO_FILE: Record<string, string> = {
  ps1: 'ps1',
  ps2: 'ps2',
  ps3: 'ps3', // no ps3 logo file yet → PS glyph fallback
  psp: 'psplogo',
  xbox: 'originalxboxlogo', // original Xbox console
  xbox360: 'xbox360logo',
  gamecube: 'gamecubelogo',
  wii: 'wii',
  ds: 'nds',
  '3ds': 'nintendo-3ds',
  gba: 'gameboyadvlogo',
  snes: 'snes',
  n64: 'nintendo-64-2',
  nes: 'nes',
  wiiu: 'wiiu',
  switch: 'switch',
  atari2600: 'atari2600',
  genesis: 'genesis',
  saturn: 'saturn',
  dreamcast: 'dreamcast',
};

function logoUrlForSlug(slug: string): string | undefined {
  const base = CONSOLE_LOGO_FILE[slug];
  if (!base) return undefined;
  const entry = logoUrlByBase[base];
  return entry?.svg ?? entry?.png;
}

/** Whether a real brand-logo file exists for this slug (vs the glyph fallback). */
export function hasConsoleLogo(slug: string): boolean {
  return logoUrlForSlug(slug) != null;
}

// A fixed icon box with a deliberately LOW height cap: most logos hit the height
// limit (so they share a uniform optical height), and only very wide wordmarks are
// width-bound. Widening the box past the height cap pulls the wide ones up too.
const LOGO_SIZE = {
  // Logo height caps sit BELOW the box height so square/compact marks (N64, GameCube,
  // Switch, Xbox) fill more of the row and read at a comparable size to wide wordmarks
  // (which stay width-bound by max-w-full and are unaffected).
  sidebar: { box: 'h-6 w-11 justify-center', logo: 'max-h-5 max-w-full', glyph: 'h-4 w-4' },
  rail: { box: 'h-9 w-24 justify-center', logo: 'max-h-7 max-w-full', glyph: 'h-6 w-6' },
} as const;

/**
 * Console brand logo for a slug, rendered in a fixed box (consistent height, auto
 * width, centered, capped so wide wordmarks don't overflow) so the column stays
 * tidy across logos of differing aspect ratios. Logos keep their original colors
 * (the `<img>` is not tinted). Falls back to the monochrome glyph when no logo file
 * exists (or for "all"). `className` tints only the glyph fallback (e.g. active).
 */
export function ConsoleLogo({
  slug,
  size = 'sidebar',
  className = '',
  imgClassName = '',
}: {
  slug: string;
  size?: keyof typeof LOGO_SIZE;
  className?: string;
  /** Extra classes on the logo <img> itself (e.g. a drop shadow over photo banners). */
  imgClassName?: string;
}) {
  const s = LOGO_SIZE[size];
  const url = logoUrlForSlug(slug);
  return (
    <span className={`flex ${s.box} shrink-0 items-center ${className}`}>
      {url ? (
        <img src={url} alt="" aria-hidden draggable={false} className={`${s.logo} object-contain ${imgClassName}`} />
      ) : (
        <SystemIcon slug={slug} className={s.glyph} />
      )}
    </span>
  );
}
