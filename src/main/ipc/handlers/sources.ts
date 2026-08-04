import { z } from 'zod';
import { registerInvoke } from '../registry';
import {
  listCustomSources,
  addCustomSource,
  removeCustomSource,
  toCustomSourceDTO,
} from '../../catalog/customSources';
import { archiveCredentialStatus } from '../../storage/archiveCreds';

const addSchema = z.object({ url: z.string().url(), systemId: z.number().int() });
const removeSchema = z.object({ id: z.string() });

export function registerSourcesHandlers(): void {
  registerInvoke('sources:list', () => listCustomSources().map(toCustomSourceDTO));
  // Presence flags only - the key/secret themselves never cross IPC.
  registerInvoke('sources:archiveStatus', () => archiveCredentialStatus());
  registerInvoke('sources:add', async (req) => {
    const p = addSchema.parse(req);
    return toCustomSourceDTO(await addCustomSource(p.url, p.systemId));
  });
  registerInvoke('sources:remove', (req) => {
    removeCustomSource(removeSchema.parse(req).id);
    return { ok: true as const };
  });
}
