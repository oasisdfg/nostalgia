import type { CatalogGameDetail } from '@shared/contracts/catalog';

/**
 * The short facts line under a game's actions - release date, genres, players, studio,
 * ESRB - in display order, skipping whatever the game doesn't have. Shared by the
 * desktop catalog page and the Big Screen detail so both show the same facts.
 */
export function gameFacts(d: CatalogGameDetail): string[] {
  const studio = d.developer || d.publisher ? [d.developer, d.publisher].filter(Boolean).join(' · ') : d.companies.join(' · ');
  return [d.releaseDate, d.genres.join(', '), d.players, studio, d.esrb].filter((f): f is string => !!f);
}
