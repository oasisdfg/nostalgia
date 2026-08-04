import { z } from 'zod';
import { registerInvoke } from '../registry';
import { getCacheStats } from '../../db/repositories/cacheRepo';
import * as cache from '../../storage/cache';

const evictSchema = z.object({ targetBytes: z.number().int().optional() });
const pinSchema = z.object({ gameFileId: z.number().int(), pinned: z.boolean() });

export function registerCacheHandlers(): void {
  registerInvoke('cache:stats', () => getCacheStats());
  registerInvoke('cache:evict', (req) => cache.evict(evictSchema.parse(req ?? {}).targetBytes));
  registerInvoke('cache:clear', () => cache.clear());
  registerInvoke('cache:pin', (req) => {
    const p = pinSchema.parse(req);
    cache.pin(p.gameFileId, p.pinned);
    return { ok: true as const };
  });
}
