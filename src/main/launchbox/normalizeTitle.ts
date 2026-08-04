// Title normalization for matching an IGDB title to a LaunchBox title. DISPLAY strings
// only - never applied to opaque paths/keys. Aggressive on purpose (strips articles,
// punctuation, diacritics, edition suffixes) so "Grand Theft Auto: San Andreas" matches
// "Grand Theft Auto - San Andreas", "The Legend of Zelda" matches "Legend of Zelda, The".

const EDITION_RE =
  /\b(game of the year|goty|deluxe|definitive|special|collector'?s?|complete|remastered|hd|edition|director'?s? cut)\b/g;

export function normalizeLbTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(EDITION_RE, ' ')
    .replace(/\b(the|a|an)\b/g, ' ') // articles (word-boundary so "a" mid-title survives non-word split)
    .replace(/[^a-z0-9]+/g, ''); // keep only alphanumerics
}
