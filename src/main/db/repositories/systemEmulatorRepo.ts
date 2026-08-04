import { getDb } from '../connection';
import { mapSystemEmulator, type SystemEmulatorRow } from './types';
import type { SystemEmulatorDTO } from '@shared/contracts/ipc';

const COLS = 'id, system_id, emulator_id, launch_args_template, is_active, created_at, updated_at';

export function getSystemEmulator(id: number): SystemEmulatorDTO | null {
  const r = getDb().prepare(`SELECT ${COLS} FROM system_emulator WHERE id = ?`).get(id) as
    | SystemEmulatorRow
    | undefined;
  return r ? mapSystemEmulator(r) : null;
}

export function getActiveSystemEmulator(systemId: number): SystemEmulatorDTO | null {
  const r = getDb()
    .prepare(`SELECT ${COLS} FROM system_emulator WHERE system_id = ? AND is_active = 1`)
    .get(systemId) as SystemEmulatorRow | undefined;
  return r ? mapSystemEmulator(r) : null;
}

/**
 * Binds (and activates) an emulator for a system with a per-system launch-arg
 * template. Deactivates the prior active binding and updates the denormalized
 * systems.default_emulator_id, all in one transaction so uq_system_emulator_active
 * never trips.
 */
export function setSystemEmulator(
  systemId: number,
  emulatorId: number,
  launchArgsTemplate: string[],
): SystemEmulatorDTO {
  const db = getDb();
  const now = Date.now();
  const template = JSON.stringify(launchArgsTemplate);

  const tx = db.transaction((): number => {
    db.prepare('UPDATE system_emulator SET is_active = 0, updated_at = ? WHERE system_id = ? AND is_active = 1').run(
      now,
      systemId,
    );
    const existing = db
      .prepare('SELECT id FROM system_emulator WHERE system_id = ? AND emulator_id = ?')
      .get(systemId, emulatorId) as { id: number } | undefined;
    let id: number;
    if (existing) {
      db.prepare(
        'UPDATE system_emulator SET launch_args_template = ?, is_active = 1, updated_at = ? WHERE id = ?',
      ).run(template, now, existing.id);
      id = existing.id;
    } else {
      const info = db
        .prepare(
          `INSERT INTO system_emulator (system_id, emulator_id, launch_args_template, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .run(systemId, emulatorId, template, now, now);
      id = Number(info.lastInsertRowid);
    }
    db.prepare('UPDATE systems SET default_emulator_id = ?, updated_at = ? WHERE id = ?').run(emulatorId, now, systemId);
    return id;
  });

  return getSystemEmulator(tx())!;
}
