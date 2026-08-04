// Curated emulator downloads - the recommended emulator per console and its official
// homepage/GitHub. Shared so main can build the openExternal allow-list from the SAME
// list the renderer renders (only these exact URLs may be opened). Sourced from Vimm's
// Lair. Emulator names match the KNOWN registry in src/main/emulators/detect.ts.

export interface EmulatorDownload {
  /** console display name */
  console: string;
  emulator: string;
  /** official homepage or GitHub releases */
  url: string;
}

export const EMULATOR_CATALOG: EmulatorDownload[] = [
  { console: 'PlayStation', emulator: 'DuckStation', url: 'https://github.com/stenzek/duckstation/releases' },
  { console: 'PlayStation 2', emulator: 'PCSX2', url: 'https://pcsx2.net/downloads' },
  { console: 'PlayStation 3', emulator: 'RPCS3', url: 'https://rpcs3.net/download' },
  { console: 'PlayStation Portable', emulator: 'PPSSPP', url: 'https://www.ppsspp.org/download/' },
  { console: 'Xbox', emulator: 'Xemu', url: 'https://xemu.app/#download' },
  { console: 'Xbox 360', emulator: 'Xenia', url: 'https://xenia.jp/download/' },
  { console: 'GameCube', emulator: 'Dolphin', url: 'https://dolphin-emu.org/download/' },
  { console: 'Wii', emulator: 'Dolphin', url: 'https://dolphin-emu.org/download/' },
  { console: 'Nintendo DS', emulator: 'melonDS', url: 'https://melonds.kuribo64.net/downloads.php' },
  { console: 'Nintendo 3DS', emulator: 'Azahar', url: 'https://github.com/azahar-emu/azahar/releases' },
  { console: 'Game Boy Advance', emulator: 'mGBA', url: 'https://mgba.io/downloads.html' },
  { console: 'Super Nintendo', emulator: 'Snes9x', url: 'https://www.snes9x.com/downloads.php' },
  { console: 'Nintendo 64', emulator: "Rosalie's Mupen GUI", url: 'https://github.com/Rosalie241/RMG/releases' },
  { console: 'Nintendo Entertainment System', emulator: 'Mesen', url: 'https://github.com/SourMesen/Mesen2/releases' },
  { console: 'Nintendo Switch', emulator: 'Ryujinx', url: 'https://git.ryujinx.app/Ryubing' },
  { console: 'Wii U', emulator: 'Cemu', url: 'https://cemu.info/' },
  { console: 'Sega Dreamcast', emulator: 'Flycast', url: 'https://github.com/flyinghead/flycast/releases' },
  { console: 'Sega Saturn', emulator: 'Mednafen', url: 'https://mednafen.github.io/releases/' },
  { console: 'Sega Genesis', emulator: 'BlastEm', url: 'https://www.retrodev.com/blastem/' },
  { console: 'Atari 2600', emulator: 'Stella', url: 'https://stella-emu.github.io/downloads.html' },
];

/** Exact URLs the app is allowed to open externally (the openExternal handler enforces this). */
export const EMULATOR_DOWNLOAD_URLS: readonly string[] = EMULATOR_CATALOG.map((e) => e.url);
