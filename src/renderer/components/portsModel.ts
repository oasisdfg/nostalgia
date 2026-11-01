import { useSystems } from '@renderer/query/useSystems';
import { DISPLAY_ONLY_CONSOLES } from '@shared/contracts/catalog';
import type { RecompDTO } from '@shared/contracts/recomps';
import type { PortsChip, PortsUiState } from '@renderer/store/uiStore';

/**
 * Shared Native Ports view model: console names/order, filtering, sorting and chip counts.
 * Desktop (PortsView) and Big Screen (BigScreenPorts) render the same list from this.
 */

/** Console display name + sort order: Nostalgia systems first (their order), then display-only consoles. */
export function useConsoles(): { name: (slug: string) => string; order: (slug: string) => number } {
  const { data: systems = [] } = useSystems(false);
  const bySlug = new Map(systems.map((s, i) => [s.slug, { name: s.name, i }]));
  return {
    name: (slug) => bySlug.get(slug)?.name ?? DISPLAY_ONLY_CONSOLES[slug] ?? slug,
    order: (slug) => bySlug.get(slug)?.i ?? 1000 + Object.keys(DISPLAY_ONLY_CONSOLES).indexOf(slug),
  };
}

export function isBusyPort(p: RecompDTO): boolean {
  return p.state === 'downloading' || p.state === 'verifying' || p.state === 'extracting' || p.state === 'building';
}

export function matchesChip(p: RecompDTO, chip: PortsChip): boolean {
  switch (chip) {
    case 'ready':
      return p.canPlay;
    case 'installed':
      return p.state === 'installed';
    case 'updates':
      return p.updateAvailable;
    case 'missing':
      return p.gameReady === 'missing';
    default:
      return true;
  }
}

export const CHIPS: { id: PortsChip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready to play' },
  { id: 'installed', label: 'Installed' },
  { id: 'updates', label: 'Updates' },
  { id: 'missing', label: 'Needs your copy' },
];

/**
 * Ports after search/console/status (the header filters); chips count within this set and
 * then narrow it. Sorted per `sort` (console order, then name).
 */
export function filterPorts(
  ports: RecompDTO[],
  ui: Pick<PortsUiState, 'search' | 'console' | 'status' | 'sort'>,
  consoles: ReturnType<typeof useConsoles>,
): RecompDTO[] {
  const q = ui.search.trim().toLowerCase();
  const out = ports.filter((p) => {
    const m = p.manifest;
    if (ui.console !== 'all' && m.gameFile.systemSlug !== ui.console) return false;
    if (ui.status !== 'all' && m.status !== ui.status) return false;
    if (!q) return true;
    return [m.name, m.originalTitle, consoles.name(m.gameFile.systemSlug)].some((t) => t.toLowerCase().includes(q));
  });
  const byName = (a: RecompDTO, b: RecompDTO): number => a.manifest.name.localeCompare(b.manifest.name);
  if (ui.sort === 'added') {
    return out.sort((a, b) => (b.manifest.addedAt ?? '').localeCompare(a.manifest.addedAt ?? '') || byName(a, b));
  }
  if (ui.sort === 'name') return out.sort(byName);
  return out.sort(
    (a, b) => consoles.order(a.manifest.gameFile.systemSlug) - consoles.order(b.manifest.gameFile.systemSlug) || byName(a, b),
  );
}

/** Consecutive runs of one console (input already sorted by console). */
export function groupByConsole(ports: RecompDTO[]): { slug: string; ports: RecompDTO[] }[] {
  const groups: { slug: string; ports: RecompDTO[] }[] = [];
  for (const p of ports) {
    const slug = p.manifest.gameFile.systemSlug;
    const last = groups[groups.length - 1];
    if (last && last.slug === slug) last.ports.push(p);
    else groups.push({ slug, ports: [p] });
  }
  return groups;
}

/** The single action a card offers on hover/focus, by state. */
export type CardAction = 'cancel' | 'play' | 'get' | 'link' | 'install' | 'build' | 'retry';
export function cardAction(p: RecompDTO): CardAction {
  if (isBusyPort(p)) return 'cancel';
  if (p.canPlay) return 'play';
  const external = p.manifest.assetKind === 'external' && !p.manifest.build;
  if (p.state === 'installed') return 'link'; // installed, but the user's copy is missing
  if (external) return 'get';
  if (p.state === 'failed') return 'retry';
  return p.manifest.build ? 'build' : 'install';
}

export const CARD_ACTION_LABEL: Record<CardAction, string> = {
  cancel: 'Cancel',
  play: 'Play',
  get: 'Get from project page',
  link: 'Link your copy',
  install: 'Install',
  build: 'Build',
  retry: 'Try again',
};

/**
 * A card's accessible name: the port plus the state its glyphs show (busy ring, update dot,
 * ready check) and its beta status, so none of it is conveyed by colour or shape alone.
 */
export function portCardLabel(p: RecompDTO, fraction: number | null): string {
  const parts = [p.manifest.name];
  if (isBusyPort(p)) parts.push(fraction != null ? `installing, ${Math.round(fraction * 100)}%` : 'installing');
  else if (p.updateAvailable) parts.push('update available');
  else if (p.canPlay) parts.push('ready to play');
  else if (p.gameReady === 'missing') parts.push('needs your copy');
  if (p.manifest.status === 'beta') parts.push('beta');
  return parts.join(', ');
}

const TITLE_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'edition']);

function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !TITLE_STOPWORDS.has(w));
}

/**
 * Library games that look like the port's original, for the "your copy" picker: most of the
 * original title's words (numbers included, so Halo 3 isn't Halo 2) appear in the game's title.
 */
export function likelyCopies<T extends { title: string }>(games: T[], originalTitle: string): T[] {
  const want = titleWords(originalTitle);
  if (want.length === 0) return [];
  return games.filter((g) => {
    const have = new Set(titleWords(g.title));
    const hits = want.filter((w) => have.has(w));
    if (!hits.some((w) => !/^\d+$/.test(w))) return false; // a shared "2" alone isn't a match
    const wantNums = want.filter((w) => /^\d+$/.test(w));
    if (wantNums.some((n) => !have.has(n))) return false;
    return hits.length / want.length >= 0.6;
  });
}
