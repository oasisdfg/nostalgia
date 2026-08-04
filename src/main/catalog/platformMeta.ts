// Per-platform metadata driving catalog sorting/filtering. MAIN PROCESS ONLY.
//
// The core cross-console problem: a multi-platform game (GTA: San Andreas) appears in
// EVERY console section it ever shipped on, so the same blockbusters top every grid.
// The default view therefore filters to games whose FIRST release is on/after the
// console's launch - a game first released before the console existed is by definition
// a port there, and belongs to its ORIGINAL console's section (still findable here via
// search, which skips this filter).

/**
 * Console launch dates (earliest worldwide launch) as Unix epoch SECONDS (IGDB's
 * first_release_date unit), each backed off ~45 days so day-one launch titles whose
 * global first release slightly precedes the local console launch aren't dropped.
 */
const GRACE = 45 * 24 * 60 * 60;
const utc = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / 1000) - GRACE;

export const PLATFORM_LAUNCH: Record<number, number> = {
  7: utc(1994, 12, 3), // PlayStation
  8: utc(2000, 3, 4), // PlayStation 2
  9: utc(2006, 11, 11), // PlayStation 3
  38: utc(2004, 12, 12), // PSP
  11: utc(2001, 11, 15), // Xbox
  12: utc(2005, 11, 22), // Xbox 360
  21: utc(2001, 9, 14), // GameCube
  5: utc(2006, 11, 19), // Wii
  20: utc(2004, 11, 21), // Nintendo DS
  37: utc(2011, 2, 26), // Nintendo 3DS
  24: utc(2001, 3, 21), // Game Boy Advance
  19: utc(1990, 11, 21), // SNES
  4: utc(1996, 6, 23), // Nintendo 64
  18: utc(1983, 7, 15), // NES (Famicom)
  41: utc(2012, 11, 18), // Wii U
  130: utc(2017, 3, 3), // Switch
  59: utc(1977, 9, 11), // Atari 2600
  29: utc(1988, 10, 29), // Sega Genesis / Mega Drive
  32: utc(1994, 11, 22), // Sega Saturn
  23: utc(1998, 11, 27), // Sega Dreamcast
};

// Console ids per manufacturer family (consoles only - PC/Mac/mobile don't count
// against "console exclusive" in common usage).
const SONY = [7, 8, 9, 38, 46, 48, 167];
const NINTENDO = [4, 5, 18, 19, 20, 21, 22, 24, 33, 37, 41, 130, 137];
const XBOX = [11, 12, 49, 169];
const SEGA = [29, 30, 32, 23, 35, 64, 78]; // Genesis, 32X, Saturn, Dreamcast, Game Gear, Master System, SG-1000
const ATARI = [59, 60, 61, 62, 63, 66]; // 2600, 5200, 7800, Lynx, Jaguar, etc.

const FAMILY_OF: [number[], number[]][] = [
  // [family consoles, rival consoles]
  [SONY, [...NINTENDO, ...XBOX, ...SEGA]],
  [NINTENDO, [...SONY, ...XBOX, ...SEGA]],
  [XBOX, [...SONY, ...NINTENDO, ...SEGA]],
  [SEGA, [...SONY, ...NINTENDO, ...XBOX]],
  [ATARI, [...SONY, ...NINTENDO, ...XBOX, ...SEGA]],
];

/**
 * Console ids that must NOT appear in a game's platform list for it to count as an
 * exclusive of this platform's family (e.g. "Xbox exclusives" = never on a Sony or
 * Nintendo console; a PC release doesn't disqualify it).
 */
export function rivalConsolesOf(platformId: number): number[] {
  for (const [family, rivals] of FAMILY_OF) if (family.includes(platformId)) return rivals;
  return [];
}
