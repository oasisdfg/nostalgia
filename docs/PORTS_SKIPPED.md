# Native Ports left out of the registry

Candidates reviewed for the Native Ports registry (`src/main/recomps/registry.json`) that
didn't make it, and why. Reviewed 2026-10-31.

The bar a port has to clear: a public source tree in its repo, a Windows build attached to its
GitHub releases (or a documented Windows installer, for `external` ports), not archived, and a
program Nostalgia can start directly (an `.exe`; scripts aren't launched, since Nostalgia never
runs a shell). Repos under 30 days old are allowed but always listed as Beta. Ports that need
files from a leaked or unreleased build are never added.

| Repo | Console | Reason |
|---|---|---|
| [YYOzcan/Tobiichi-Port](https://github.com/YYOzcan/Tobiichi-Port) | PS2 | No releases, so there's no Windows build to install. |
| [sal063/Ace-Combat-5-Static-recompilation](https://github.com/sal063/Ace-Combat-5-Static-recompilation) | PS2 | The only release asset is a `.rar`, which Nostalgia can't unpack (it handles `.zip` and `.7z`). |
| [recomp-code/street-recomp-v3](https://github.com/recomp-code/street-recomp-v3) | PS2 | Starts through `Launcher.cmd`; there's no program to launch without a shell. |
| [Legend-of-Dragoon-Modding/Severed-Chains](https://github.com/Legend-of-Dragoon-Modding/Severed-Chains) | PS1 | A Java game started by `launch.bat`; there's no `.exe` to launch. |
| [NoRain211/doaxvb-re](https://github.com/NoRain211/doaxvb-re) | Xbox | Built and started through `BuildGame.cmd`, `Launcher.cmd` and `RunGame.cmd`. |
| [Ekspym/Tekken6-native-online](https://github.com/Ekspym/Tekken6-native-online) | Xbox 360 | The repo has no source code, only binary releases. |
| [beatrixzy/PGR4-Recomp](https://github.com/beatrixzy/PGR4-Recomp) | Xbox 360 | About 11 KB of source; the release is effectively binary-only. |
| [holdmysocks/mcla-recomp](https://github.com/holdmysocks/mcla-recomp) | Xbox 360 | Built on your PC by a PowerShell script from your disc; the release has no program to run. |

Notes on ports that were added:

- Repos renamed on GitHub are stored under their current name: `FelipePrado0/gow3_pc` is
  `FelipePrado0/SpartanPort`, and `Dyotson/ForzaHorizon1-ReImagined` is
  `FH1-ReImagined/ForzaHorizon1-ReImagined`.
- `open-goal/launcher` has no `igdbId`: it covers the Jak and Daxter trilogy, which isn't one
  IGDB game.
- Hashes, file placement and save folders are set only where a port's README states them.
  Every other port is linked by hand and shows as an unverified dump.
