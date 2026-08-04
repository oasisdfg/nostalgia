# Emulator configuration (fullscreen + controller)

Nostalgia configures each emulator to **launch fullscreen** and use an **XInput controller**
with as little manual setup as possible. Two mechanisms, chosen per emulator by whether it
exposes a command-line fullscreen flag.

## 1. CLI fullscreen flag (preferred - no file edits)

For emulators with a fullscreen CLI flag, it's baked into the default launch-args template
in `src/main/emulators/detect.ts` (`KNOWN`). Applied element-wise (never a concatenated
string). Existing installs are upgraded on startup by `upgradeKnownEmulatorArgs()` - it only
replaces an EMPTY template or one that deep-equals a previously-shipped default (`legacyArgs`),
so custom args are never touched.

| Console | Emulator | Launch args |
|---|---|---|
| PS2 | PCSX2 | `-batch -fullscreen {romPath}` |
| PS1 | DuckStation | `-batch -fullscreen {romPath}` |
| PSP | PPSSPP | `--fullscreen {romPath}` |
| GameCube / Wii | Dolphin | `-b -e {romPath} -C Dolphin.Display.Fullscreen=True` |
| GBA | mGBA | `-f {romPath}` |
| 3DS | Azahar | `-f {romPath}` - `{romPath}` MUST stay last (Azahar only accepts the ROM as the final argv element) |
| Xbox | xemu | `-full-screen -dvd_path {romPath}` |
| Wii U | Cemu | `-f -g {romPath}` |
| PS3 | RPCS3 | `--no-gui {romPath}` (boots the game directly) |

## 2. Config-file patch (emulators with no fullscreen flag)

Emulators without a fullscreen CLI flag are patched via `src/main/emulators/configure.ts`,
run best-effort before each launch. Safety rails:

- **Only patches an EXISTING config file** - the emulator writes its own on first run; we never
  create one blind. (So: run the emulator once, then launch through Nostalgia.)
- **Backs up the pristine file once** to `<file>.nostalgia.bak` before the first edit.
- **Idempotent** - a no-op when the key is already set; safe to run every launch.
- Sets only the minimal key(s); reversible by restoring the `.bak`.

| Emulator | File | Patch |
|---|---|---|
| Xenia | `xenia-canary.config.toml` / `xenia.config.toml` | `[Display] fullscreen = true` |
| Snes9x | `snes9x.conf` | `[Display] FullScreenOnOpen = TRUE` |
| melonDS | `melonDS.ini` | `Fullscreen = 1` |

> **Verify against your emulator version.** Config key names/paths vary across emulator
> versions and forks. These are the common ones; if fullscreen doesn't take effect, the
> emulator likely renamed the key - set it manually and restore from the `.bak` if needed.
> Adding a new patch is one entry in `KNOWN[].configPatch` (see `ConfigPatch`).

## Controllers

All modern emulators Nostalgia recommends ship with **XInput enabled by default**, so a
standard Xbox-style controller works out of the box - no config needed. The exceptions
(Snes9x, Project64) map the keyboard by default; bind a controller in the emulator's own
input settings once. (Nostalgia's own UI is fully controller-navigable via Big Screen mode;
that's separate from in-game emulator input.)

## Adding an emulator

Drop a build into the managed emulator folder (Settings → Emulators → Open folder) and Scan,
or add it manually. Known emulators are recognized by filename and get the right fullscreen
args automatically; unknown ones launch with `{romPath}` and can be tuned in the emulator row.
