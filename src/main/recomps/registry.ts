import { recompRegistrySchema, type RecompManifest } from '@shared/contracts/recomps';
import raw from './registry.json';

let manifests: RecompManifest[] | null = null;

/** The bundled port registry, zod-validated once. A malformed entry fails loudly at load. */
export function listManifests(): RecompManifest[] {
  if (!manifests) manifests = recompRegistrySchema.parse(raw) as RecompManifest[];
  return manifests;
}

export function getManifest(id: string): RecompManifest | undefined {
  return listManifests().find((m) => m.id === id);
}

/** Vetted external URLs for app:openExternal: each port's project page and GitHub repo. */
export function recompExternalUrls(): string[] {
  return listManifests().flatMap((m) => [m.homepage, `https://github.com/${m.repo}`]);
}
