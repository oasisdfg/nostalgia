import { z } from 'zod';
import { registerInvoke } from '../registry';
import * as systemsRepo from '../../db/repositories/systemsRepo';
import { setSystemEmulator } from '../../db/repositories/systemEmulatorRepo';

const idSchema = z.object({ id: z.number().int() });
const createSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().nullish(),
  manufacturer: z.string().nullish(),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  iconPath: z.string().nullish(),
});
const updateSchema = z.object({
  id: z.number().int(),
  patch: z.object({
    name: z.string().optional(),
    shortName: z.string().nullish(),
    manufacturer: z.string().nullish(),
    sortOrder: z.number().int().optional(),
    enabled: z.boolean().optional(),
    iconPath: z.string().nullish(),
  }),
});
const setEmulatorSchema = z.object({
  systemId: z.number().int(),
  emulatorId: z.number().int(),
  launchArgsTemplate: z.array(z.string()),
});

export function registerSystemsHandlers(): void {
  registerInvoke('systems:list', (req) => {
    const enabledOnly = !!(req && typeof req === 'object' && (req as { enabledOnly?: boolean }).enabledOnly);
    return systemsRepo.listSystems(enabledOnly);
  });
  registerInvoke('systems:get', (req) => systemsRepo.getSystem(idSchema.parse(req).id));
  registerInvoke('systems:create', (req) => systemsRepo.createSystem(createSchema.parse(req)));
  registerInvoke('systems:update', (req) => {
    const p = updateSchema.parse(req);
    return systemsRepo.updateSystem(p.id, p.patch);
  });
  registerInvoke('systems:delete', (req) => ({ deleted: systemsRepo.deleteSystem(idSchema.parse(req).id) }));
  registerInvoke('systems:setEmulator', (req) => {
    const p = setEmulatorSchema.parse(req);
    return setSystemEmulator(p.systemId, p.emulatorId, p.launchArgsTemplate);
  });
}
