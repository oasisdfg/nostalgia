# Native Ports registry

`recomps.json` is the remote port registry. Every Nostalgia install fetches it from `main`
(at most every 6 hours, and on "Check for updates" in Native Ports) and merges it over the
list bundled in the app (`src/main/recomps/registry.json`). Edit and push it to add a port or
fix an entry without cutting an app release.

- Each entry is validated on its own against the schema in `src/shared/contracts/recomps.ts`;
  an invalid entry is dropped and the rest still apply.
- An entry with the same `id` as a bundled port replaces it; a new `id` adds a port.
- Ports built from source (`build`) are bundled-only. The remote list can't add one, and
  entries naming a bundled build port are ignored, because a build runs commands on the
  user's PC.
- Accepted game files need a confirmed `sha1`/`md5`/`crc32` (or `sha256` + `size` for disc
  images). Leave a port out until its hash is confirmed.
