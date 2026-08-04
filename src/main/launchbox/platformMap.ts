// LaunchBox platform name (verbatim from Platforms.xml) ↔ our system slug. Only the
// consoles Nostalgia supports are kept during import, which is what keeps the imported
// tables small relative to the ~500MB, 620-platform source. MAIN PROCESS ONLY.

/** Our slug → the exact LaunchBox platform string. */
export const SLUG_TO_LAUNCHBOX: Record<string, string> = {
  xbox360: 'Microsoft Xbox 360',
  ps3: 'Sony Playstation 3',
  ps2: 'Sony Playstation 2',
  ps1: 'Sony Playstation',
  psp: 'Sony PSP',
  ds: 'Nintendo DS',
  '3ds': 'Nintendo 3DS',
  gba: 'Nintendo Game Boy Advance',
  snes: 'Super Nintendo Entertainment System',
  xbox: 'Microsoft Xbox',
  gamecube: 'Nintendo GameCube',
  wii: 'Nintendo Wii',
  n64: 'Nintendo 64',
  nes: 'Nintendo Entertainment System',
  wiiu: 'Nintendo Wii U',
  switch: 'Nintendo Switch',
  atari2600: 'Atari 2600',
  genesis: 'Sega Genesis',
  saturn: 'Sega Saturn',
  dreamcast: 'Sega Dreamcast',
};

/** LaunchBox platform string → our slug (only the mapped consoles). */
export const LAUNCHBOX_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_LAUNCHBOX).map(([slug, lb]) => [lb, slug]),
);

/** The set of LaunchBox platform strings we import (fast membership test in the parser). */
export const IMPORTED_LAUNCHBOX_PLATFORMS = new Set(Object.values(SLUG_TO_LAUNCHBOX));

export function launchboxPlatformForSlug(slug: string): string | undefined {
  return SLUG_TO_LAUNCHBOX[slug];
}
