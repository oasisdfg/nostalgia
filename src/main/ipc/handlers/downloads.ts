import { z } from 'zod';
import { registerInvoke } from '../registry';
import * as downloadManager from '../../storage/downloadManager';
import { listDownloads, listDownloadItems } from '../../db/repositories/downloadsRepo';
import type { DownloadDTO, DownloadState } from '@shared/contracts/ipc';

const idSchema = z.object({ id: z.number().int() });
const enqueueSchema = z.object({ gameFileId: z.number().int(), priority: z.number().int().optional() });

function required(dto: DownloadDTO | null): DownloadDTO {
  if (!dto) throw new Error('download not found');
  return dto;
}

export function registerDownloadsHandlers(): void {
  registerInvoke('downloads:list', (req) => {
    const state =
      req && typeof req === 'object' ? (req as { state?: DownloadState }).state : undefined;
    return listDownloads(state);
  });
  registerInvoke('downloads:listItems', () => listDownloadItems());
  registerInvoke('downloads:enqueue', (req) => {
    const p = enqueueSchema.parse(req);
    return downloadManager.enqueue(p.gameFileId, p.priority ?? 0);
  });
  registerInvoke('downloads:pause', (req) => required(downloadManager.pause(idSchema.parse(req).id)));
  registerInvoke('downloads:resume', (req) => required(downloadManager.resume(idSchema.parse(req).id)));
  registerInvoke('downloads:cancel', (req) => required(downloadManager.cancel(idSchema.parse(req).id)));
}
