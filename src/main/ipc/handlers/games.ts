import { z } from 'zod';
import { registerInvoke } from '../registry';
import * as gamesRepo from '../../db/repositories/gamesRepo';
import { removeGameFromLibrary } from '../../storage/downloadManager';

const libraryQuerySchema = z.object({
  systemId: z.number().int().nullish(),
  search: z.string().optional(),
  favorite: z.boolean().optional(),
  playedOnly: z.boolean().optional(),
  sort: z.enum(['title', 'lastPlayed', 'addedAt', 'playCount']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});
const searchSchema = z.object({ query: z.string(), systemId: z.number().int().nullish() });
const idSchema = z.object({ id: z.number().int() });
const updateSchema = z.object({
  id: z.number().int(),
  patch: z.object({
    title: z.string().optional(),
    sortTitle: z.string().optional(),
    favorite: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
});
const favoriteSchema = z.object({ id: z.number().int(), favorite: z.boolean() });

export function registerGamesHandlers(): void {
  registerInvoke('games:list', (req) => gamesRepo.listGames(libraryQuerySchema.parse(req)));
  registerInvoke('games:search', (req) => {
    const p = searchSchema.parse(req);
    return gamesRepo.searchGames(p.query, p.systemId);
  });
  registerInvoke('games:detail', (req) => gamesRepo.getGameDetail(idSchema.parse(req).id));
  registerInvoke('games:update', (req) => {
    const p = updateSchema.parse(req);
    return gamesRepo.updateGame(p.id, p.patch);
  });
  registerInvoke('games:setFavorite', async (req) => {
    const p = favoriteSchema.parse(req);
    // A file-less catalog favorite exists ONLY because it was hearted - un-favoriting
    // it deletes the row (mirrors 'catalog:setFavorite'); just clearing the flag would
    // strand a ghost entry in the library that nothing can play or download.
    if (!p.favorite) {
      const game = gamesRepo.getGame(p.id);
      if (game && !game.hasFiles && game.igdbId != null) {
        await removeGameFromLibrary(p.id);
        return null;
      }
    }
    return gamesRepo.setFavorite(p.id, p.favorite);
  });
}
