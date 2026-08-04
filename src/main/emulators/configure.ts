// Applies minimal, idempotent fullscreen/controller edits to the config files of emulators
// that have no CLI fullscreen flag (Xenia, Snes9x, melonDS, …). Safety rails: only patches
// a config file that ALREADY EXISTS (the emulator writes its own on first run - we never
// create one blind), backs the original up ONCE to `<file>.nostalgia.bak`, and is a no-op
// when the keys are already set. The exe dir is resolved from the opaque exe_path verbatim.
// MAIN PROCESS ONLY. Because it's reversible (backup) and idempotent, running it on each
// launch is safe. See docs/EMULATORS.md for what each patch does.
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configPatchesForExe, type ConfigPatch } from './detect';

/**
 * Sets `key = value` lines under an INI/TOML `[section]` (or top-level). Replaces an existing
 * key's value in that section; otherwise appends the key to the section, creating the section
 * if absent. Values are written verbatim (callers pass literal tokens like 'true'/'1'). Returns
 * the new content (=== input when nothing changed).
 */
function applyPatch(content: string, patch: ConfigPatch): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const wantSection = patch.section ?? null;
  const remaining = new Map(Object.entries(patch.set));

  // Locate the [start,end) line range of the target section (top-level = before the 1st header).
  const headerRe = /^\s*\[(.+?)\]\s*$/;
  let secStart = wantSection == null ? 0 : -1;
  let secEnd = lines.length;
  if (wantSection != null) {
    for (let i = 0; i < lines.length; i++) {
      const m = headerRe.exec(lines[i]);
      if (m && m[1].trim() === wantSection) {
        secStart = i + 1;
        secEnd = lines.length;
        for (let j = secStart; j < lines.length; j++) {
          if (headerRe.test(lines[j])) {
            secEnd = j;
            break;
          }
        }
        break;
      }
    }
  } else {
    // top-level ends at the first section header
    for (let i = 0; i < lines.length; i++) {
      if (headerRe.test(lines[i])) {
        secEnd = i;
        break;
      }
    }
  }

  // Replace existing keys in the section.
  if (secStart >= 0) {
    for (let i = secStart; i < secEnd; i++) {
      const km = /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*)$/.exec(lines[i]);
      if (km && remaining.has(km[2])) {
        const val = remaining.get(km[2])!;
        remaining.delete(km[2]);
        lines[i] = `${km[1]}${km[2]}${km[3]}${val}`;
      }
    }
  }

  if (remaining.size === 0) return lines.join(eol);

  // Insert the keys not already present.
  const inserts = [...remaining.entries()].map(([k, v]) => `${k} = ${v}`);
  if (secStart >= 0) {
    // Insert right after the section's last non-empty line (not after trailing blanks,
    // which a trailing newline in the file would otherwise turn into a stray gap).
    let at = secEnd;
    while (at > secStart && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, ...inserts);
  } else {
    // Target section doesn't exist - append it.
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`[${wantSection}]`, ...inserts);
  }
  return lines.join(eol);
}

/** Applies all config patches for an emulator exe (best-effort; existing files only). */
export async function configureEmulator(exePath: string): Promise<void> {
  const patches = configPatchesForExe(exePath);
  if (patches.length === 0) return;
  const dir = dirname(exePath);
  for (const patch of patches) {
    const file = join(dir, patch.relPath);
    try {
      await access(file);
    } catch {
      continue; // emulator hasn't written this config yet - don't create it blind
    }
    let original: string;
    try {
      original = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const updated = applyPatch(original, patch);
    if (updated === original) continue; // already set
    const bak = `${file}.nostalgia.bak`;
    try {
      await access(bak);
    } catch {
      await writeFile(bak, original).catch(() => undefined); // back up the pristine config once
    }
    await writeFile(file, updated).catch(() => undefined);
  }
}
