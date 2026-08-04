import { getDb } from '../connection';
import { mapSystem, type SystemRow } from './types';
import type { SystemDTO, CreateSystemInput, UpdateSystemPatch } from '@shared/contracts/ipc';

const COLS =
  'id, slug, name, short_name, manufacturer, sort_order, enabled, is_builtin, default_emulator_id, icon_path, created_at, updated_at';

export function listSystems(enabledOnly = false): SystemDTO[] {
  const sql = `SELECT ${COLS} FROM systems ${enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY sort_order, name`;
  return (getDb().prepare(sql).all() as SystemRow[]).map(mapSystem);
}

export function getSystem(id: number): SystemDTO | null {
  const r = getDb().prepare(`SELECT ${COLS} FROM systems WHERE id = ?`).get(id) as SystemRow | undefined;
  return r ? mapSystem(r) : null;
}

export function getSystemBySlug(slug: string): SystemDTO | null {
  const r = getDb().prepare(`SELECT ${COLS} FROM systems WHERE slug = ?`).get(slug) as SystemRow | undefined;
  return r ? mapSystem(r) : null;
}

export function createSystem(input: CreateSystemInput): SystemDTO {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO systems (slug, name, short_name, manufacturer, sort_order, enabled, is_builtin, icon_path, created_at, updated_at)
       VALUES (@slug, @name, @short_name, @manufacturer, @sort_order, @enabled, 0, @icon_path, @now, @now)`,
    )
    .run({
      slug: input.slug,
      name: input.name,
      short_name: input.shortName ?? null,
      manufacturer: input.manufacturer ?? null,
      sort_order: input.sortOrder ?? 0,
      enabled: input.enabled === false ? 0 : 1,
      icon_path: input.iconPath ?? null,
      now,
    });
  return getSystem(Number(info.lastInsertRowid))!;
}

export function updateSystem(id: number, patch: UpdateSystemPatch): SystemDTO {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, updated_at: Date.now() };
  const set = (col: string, val: unknown): void => {
    sets.push(`${col} = @${col}`);
    params[col] = val;
  };
  if (patch.name !== undefined) set('name', patch.name);
  if (patch.shortName !== undefined) set('short_name', patch.shortName);
  if (patch.manufacturer !== undefined) set('manufacturer', patch.manufacturer);
  if (patch.sortOrder !== undefined) set('sort_order', patch.sortOrder);
  if (patch.enabled !== undefined) set('enabled', patch.enabled ? 1 : 0);
  if (patch.iconPath !== undefined) set('icon_path', patch.iconPath);
  sets.push('updated_at = @updated_at');
  getDb().prepare(`UPDATE systems SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getSystem(id)!;
}

export function deleteSystem(id: number): boolean {
  return getDb().prepare('DELETE FROM systems WHERE id = ?').run(id).changes > 0;
}

/**
 * Idempotent upsert by slug for built-in systems. The seed list in builtinSystems.ts is
 * authoritative for a built-in's identity AND ordering, so ON CONFLICT rewrites
 * sort_order/name/short_name/manufacturer (this is how a re-ordered seed re-sorts the
 * sidebar for existing installs). It deliberately leaves `enabled` alone so a user's
 * enable/disable choice is preserved across upgrades.
 */
export function upsertBuiltinSystem(input: Required<Pick<CreateSystemInput, 'slug' | 'name'>> & {
  shortName: string | null;
  manufacturer: string | null;
  sortOrder: number;
}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO systems (slug, name, short_name, manufacturer, sort_order, enabled, is_builtin, created_at, updated_at)
       VALUES (@slug, @name, @short_name, @manufacturer, @sort_order, 1, 1, @now, @now)
       ON CONFLICT(slug) DO UPDATE SET
         is_builtin = 1,
         name = @name,
         short_name = @short_name,
         manufacturer = @manufacturer,
         sort_order = @sort_order,
         updated_at = @now`,
    )
    .run({
      slug: input.slug,
      name: input.name,
      short_name: input.shortName,
      manufacturer: input.manufacturer,
      sort_order: input.sortOrder,
      now,
    });
}
