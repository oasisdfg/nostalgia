# Console brand logos

Per-console logo image files wired into the sidebar (and Big Screen rail) as the
console icons, in their original colors (not tinted). No network - only the local
files here are bundled. Files are discovered at build time via `import.meta.glob`,
so a missing file falls back to the generic glyph and the build never breaks.
**Rebuild after adding/changing files** (`npm run build`, or `npm run dist` for the exe).

The slug → basename mapping is `CONSOLE_LOGO_FILE` in
`src/renderer/components/SystemIcon.tsx` (one source of truth).

| Console            | File                  |
| ------------------ | --------------------- |
| PlayStation        | `ps1.svg`             |
| PlayStation 2      | `ps2.svg`             |
| PlayStation 3      | `ps3.svg` *(none yet → PS glyph)* |
| PlayStation Portable | `psp.svg`           |
| Xbox               | `xbox-original.svg`   |
| Xbox 360           | `xbox-360.svg`        |
| GameCube           | `gamecube.svg`        |
| Wii                | `wii.svg`             |
| Nintendo DS        | `nds.svg`             |
| Game Boy Advance   | `gba.svg`             |
| Super Nintendo     | `snes.svg`            |
| NES                | `nes.svg`             |
| Nintendo Switch    | `switch.svg`          |
| Wii U              | `wiiu.svg`            |
| Sega Genesis       | `genesis.svg`         |
| Sega Saturn        | `saturn.svg`          |
| Sega Dreamcast     | `dreamcast.svg`       |
| Atari 2600         | `atari2600.svg`       |

Dark-UI note: logos are shown untinted on a dark sidebar, so black-on-transparent
wordmarks (NES, Switch, Genesis, Dreamcast) were inverted to white (accent colors kept).

`xbox.svg` (generic Xbox mark) is present but unused - the original-Xbox row uses
`xbox-original.svg`. "All games" intentionally keeps the neutral grid glyph.
Use self-contained SVGs (no external fonts / `http://` refs - the strict packaged
CSP loads them via `<img>` from `'self'`).
