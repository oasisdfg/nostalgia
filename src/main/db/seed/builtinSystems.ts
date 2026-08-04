import { getDb } from '../connection';
import { upsertBuiltinSystem } from '../repositories/systemsRepo';

interface Builtin {
  slug: string;
  name: string;
  shortName: string;
  manufacturer: string;
}

// The enumerated built-in platforms, in sidebar order (grouped by manufacturer,
// newest→oldest within each). `seedBuiltinSystems` writes each row's sort_order from
// its index here, so editing this array's ORDER is how the sidebar is re-sorted - it is
// authoritative for built-ins (there is no user-facing reorder feature to clobber).
// Arbitrary user systems are added via systems:create, not seeded.
const BUILTINS: Builtin[] = [
  // Microsoft
  { slug: 'xbox360', name: 'Xbox 360', shortName: 'X360', manufacturer: 'Microsoft' },
  { slug: 'xbox', name: 'Xbox', shortName: 'Xbox', manufacturer: 'Microsoft' },
  // Sony
  { slug: 'ps3', name: 'PlayStation 3', shortName: 'PS3', manufacturer: 'Sony' },
  { slug: 'ps2', name: 'PlayStation 2', shortName: 'PS2', manufacturer: 'Sony' },
  { slug: 'ps1', name: 'PlayStation', shortName: 'PS1', manufacturer: 'Sony' },
  { slug: 'psp', name: 'PlayStation Portable', shortName: 'PSP', manufacturer: 'Sony' },
  // Nintendo - home
  { slug: 'switch', name: 'Nintendo Switch', shortName: 'Switch', manufacturer: 'Nintendo' },
  { slug: 'wiiu', name: 'Wii U', shortName: 'Wii U', manufacturer: 'Nintendo' },
  { slug: 'wii', name: 'Wii', shortName: 'Wii', manufacturer: 'Nintendo' },
  { slug: 'gamecube', name: 'GameCube', shortName: 'GC', manufacturer: 'Nintendo' },
  { slug: 'n64', name: 'Nintendo 64', shortName: 'N64', manufacturer: 'Nintendo' },
  { slug: 'snes', name: 'Super Nintendo', shortName: 'SNES', manufacturer: 'Nintendo' },
  { slug: 'nes', name: 'Nintendo Entertainment System', shortName: 'NES', manufacturer: 'Nintendo' },
  // Nintendo - handheld
  { slug: '3ds', name: 'Nintendo 3DS', shortName: '3DS', manufacturer: 'Nintendo' },
  { slug: 'ds', name: 'Nintendo DS', shortName: 'DS', manufacturer: 'Nintendo' },
  { slug: 'gba', name: 'Game Boy Advance', shortName: 'GBA', manufacturer: 'Nintendo' },
  // Sega
  { slug: 'dreamcast', name: 'Sega Dreamcast', shortName: 'DC', manufacturer: 'Sega' },
  { slug: 'saturn', name: 'Sega Saturn', shortName: 'Saturn', manufacturer: 'Sega' },
  { slug: 'genesis', name: 'Sega Genesis', shortName: 'Genesis', manufacturer: 'Sega' },
  // Atari
  { slug: 'atari2600', name: 'Atari 2600', shortName: '2600', manufacturer: 'Atari' },
];

/** Idempotent: upserts the built-ins by slug; never duplicates or clobbers user edits. */
export function seedBuiltinSystems(): void {
  const run = getDb().transaction(() => {
    BUILTINS.forEach((b, i) => {
      upsertBuiltinSystem({
        slug: b.slug,
        name: b.name,
        shortName: b.shortName,
        manufacturer: b.manufacturer,
        sortOrder: i,
      });
    });
  });
  run();
}
