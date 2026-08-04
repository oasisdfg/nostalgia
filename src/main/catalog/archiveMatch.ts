// Title normalization for fuzzy-matching IGDB titles against Archive filenames.
// Validated against the real playstation2_essentials file list + IGDB PS2 catalog:
// exact normalized equality gives a high-confidence match with zero false
// positives (prefix/substring matching is intentionally avoided - it would
// mismatch e.g. "Mafia" with "Mafia II").
//
// Per-console rules are passed in (extensions + optional strip patterns) because
// each console's filenames differ. The BASE rules below already cover the common
// No-Intro/Redump conventions universally: parenthesized region/disc tags (USA),
// (Europe), (Disc 1) and bracketed flags [!], [b] are removed; `strip` is only for
// console-specific quirks the base rules don't catch. The SAME profile is applied
// to both the filename and the IGDB title so the comparison stays symmetric.

export interface NormalizeOptions {
  /** Playable file extensions (lowercase, no dot). The trailing one is stripped. */
  extensions?: string[];
  /** Console-specific case-insensitive regex sources removed before the alnum collapse. */
  strip?: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeTitle(input: string, opts?: NormalizeOptions): string {
  let s = input.toLowerCase();

  // Strip diacritics so accented titles match their un-accented dump filenames. Without
  // this, IGDB's "Pokémon" normalizes to "pok mon" (é falls into the [^a-z0-9] separator
  // pass) while the No-Intro file "Pokemon" normalizes to "pokemon" - and they never match.
  // This is a fuzzy MATCH KEY, not an opaque storage path, so Unicode normalization is fine.
  s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '');

  // Strip any directory path: Archive item file names can be folder-prefixed
  // (e.g. "all/Game (USA).7z", subfolders in some sets); match on the basename
  // only. IGDB titles contain no slash, so this is a no-op for them and the
  // filename/title comparison stays symmetric.
  s = s.replace(/^.*\//, '');

  // Strip a trailing file extension: the configured set per console, else generic.
  if (opts?.extensions && opts.extensions.length > 0) {
    s = s.replace(new RegExp(`\\.(${opts.extensions.map(escapeRegex).join('|')})$`, 'i'), '');
  } else {
    s = s.replace(/\.[a-z0-9]{1,5}$/i, '');
  }

  // Console-specific extra cleanup (rare; base rules cover region/disc/bracket tags).
  if (opts?.strip) {
    for (const pat of opts.strip) {
      try {
        s = s.replace(new RegExp(pat, 'ig'), ' ');
      } catch {
        /* a malformed config pattern must not crash matching */
      }
    }
  }

  // No-Intro/Redump put a leading article last ("Legend of Zelda, The"); restore
  // it to the front so it matches IGDB's "The Legend of Zelda". Only fires on a
  // comma immediately followed by an article, so normal titles are untouched.
  s = s.replace(/^(.+?),\s+(the|a|an)\b\s*/i, '$2 $1 ');

  return s
    .replace(/&/g, ' and ')
    .replace(/[‘’']/g, '')
    .replace(/\([^)]*\)/g, ' ') // (USA), (Disc 1), ... - region/disc tags live in parens
    .replace(/\[[^\]]*\]/g, ' ') // [!], [b], ...
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // NOTE: deliberately does NOT strip bare 'usa'/'europe'/'disc N' words - those
  // occur inside real titles ("NTSC Racer", "World Tour USA") and stripping them
  // mid-title would collapse distinct games into a false-positive match.
}

// Region preference - USA/US is the default, so it ranks highest; higher wins.
// (USA)/NTSC-U sits strictly ABOVE the shorter (US)/(U) tag so a set that ships
// both rips of one game resolves to the USA rip instead of tying (→ being dropped).
function regionRank(name: string): number {
  const n = name.toLowerCase();
  if (/\busa\b|\bntsc-?u\b|\[ntsc-?u\]/.test(n)) return 6; // USA / NTSC-U
  if (/\(us?\)/.test(n)) return 5; // (US) / (U)
  if (/\bworld\b|region.?free|\[rf\]/.test(n)) return 4; // region-free (US-playable)
  if (/\beurope\b|\(e\)|\bpal\b|\[pal\]|\beur\b/.test(n)) return 2;
  if (/\bjapan\b|\(j\)|\bntsc-?j\b|\bjpn\b/.test(n)) return 1;
  return 3; // untagged/unknown - ahead of Europe/Japan, behind US/World
}

// Revision/version preference: a higher disc revision wins (v2.00 > v1.00).
function versionRank(name: string): number {
  const v = /\bv(\d+)\.(\d+)/i.exec(name);
  if (v) return Number(v[1]) * 100 + Number(v[2]);
  const r = /\brev\s*([0-9a-z]+)/i.exec(name);
  if (r) return parseInt(r[1], 36) || 0;
  return 0;
}

/**
 * Per-title disc preferences that override the default "latest revision wins" ranking,
 * keyed by the NORMALIZED title (see normalizeTitle) so the same entry covers every
 * source family. Only add a row when the newest revision is the WRONG pick:
 *   - god of war iii: the (USA) (v02.00) disc is the later Greatest Hits re-press; the
 *     v01.03 retail disc is the one that boots reliably under RPCS3.
 * Candidates matching the pattern are kept and then ranked normally among themselves;
 * if none match (a source that doesn't carry that revision) the rule is a no-op.
 */
const PREFERRED_FILE: Record<string, RegExp> = {
  'god of war iii': /\(v0?1\.03\)/i,
};

// Files scoring identically after region + revision. Multi-disc sets MUST stay ambiguous
// (silently picking "Disc 1" would launch half a game), but a region SUPERSET of the same
// rip - "(USA)" vs "(USA, Asia)" - is the same bytes with a broader tag, and dropping the
// pair left real titles greyed out as "not available" (e.g. Simpsons Game, The on PS3).
// The plainest (shortest) name wins; an exact length tie is still genuinely undecidable.
const MULTI_DISC_RE = /\((?:disc|cd|disk)\s*\d+/i;

function breakTie<T extends { name: string }>(top: T[]): T | null {
  if (top.some((f) => MULTI_DISC_RE.test(f.name))) return null;
  const sorted = [...top].sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1));
  return sorted[0].name.length === sorted[1].name.length ? null : sorted[0];
}

/**
 * Resolve a same-normalized-title collision (the SAME game present as several
 * region/version files) to ONE file: an explicit PREFERRED_FILE rule first, then USA,
 * then the latest revision, then the plainest name. Returns null only when the group is
 * genuinely undecidable (multi-disc, or same-length duplicates) - the caller drops it as
 * ambiguous, preserving the no-arbitrary-pick guarantee.
 *
 * `key` is the normalized title the group was filed under; pass it so PREFERRED_FILE can
 * apply (omitting it just skips the override).
 */
export function pickPreferred<T extends { name: string }>(files: T[], key?: string): T | null {
  if (files.length <= 1) return files[0] ?? null;
  const override = key ? PREFERRED_FILE[key] : undefined;
  if (override) {
    const forced = files.filter((f) => override.test(f.name));
    if (forced.length > 0) files = forced;
    if (files.length === 1) return files[0];
  }
  const score = (n: string): number => regionRank(n) * 1_000_000 + versionRank(n);
  let max = -Infinity;
  for (const f of files) max = Math.max(max, score(f.name));
  const top = files.filter((f) => score(f.name) === max);
  return top.length === 1 ? top[0] : breakTie(top);
}
