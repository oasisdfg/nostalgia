import { getDb } from '../connection';
import { mapEmulator, type EmulatorRow } from './types';
import type { EmulatorDTO, CreateEmulatorInput, UpdateEmulatorPatch } from '@shared/contracts/ipc';

const COLS = 'id, name, exe_path, working_dir, default_args_template, notes, created_at, updated_at';

export function listEmulators(): EmulatorDTO[] {
  return (getDb().prepare(`SELECT ${COLS} FROM emulators ORDER BY name`).all() as EmulatorRow[]).map(mapEmulator);
}

export function getEmulator(id: number): EmulatorDTO | null {
  const r = getDb().prepare(`SELECT ${COLS} FROM emulators WHERE id = ?`).get(id) as EmulatorRow | undefined;
  return r ? mapEmulator(r) : null;
}

export function createEmulator(input: CreateEmulatorInput): EmulatorDTO {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO emulators (name, exe_path, working_dir, default_args_template, notes, created_at, updated_at)
       VALUES (@name, @exe_path, @working_dir, @default_args_template, @notes, @now, @now)`,
    )
    .run({
      name: input.name,
      exe_path: input.exePath, // opaque, stored verbatim
      working_dir: input.workingDir ?? null,
      default_args_template: JSON.stringify(input.defaultArgsTemplate ?? []),
      notes: input.notes ?? null,
      now,
    });
  return getEmulator(Number(info.lastInsertRowid))!;
}

export function updateEmulator(id: number, patch: UpdateEmulatorPatch): EmulatorDTO {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, updated_at: Date.now() };
  const set = (col: string, val: unknown): void => {
    sets.push(`${col} = @${col}`);
    params[col] = val;
  };
  if (patch.name !== undefined) set('name', patch.name);
  if (patch.exePath !== undefined) set('exe_path', patch.exePath); // opaque, verbatim
  if (patch.workingDir !== undefined) set('working_dir', patch.workingDir);
  if (patch.defaultArgsTemplate !== undefined) set('default_args_template', JSON.stringify(patch.defaultArgsTemplate));
  if (patch.notes !== undefined) set('notes', patch.notes);
  sets.push('updated_at = @updated_at');
  getDb().prepare(`UPDATE emulators SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getEmulator(id)!;
}

export function deleteEmulator(id: number): boolean {
  return getDb().prepare('DELETE FROM emulators WHERE id = ?').run(id).changes > 0;
}
