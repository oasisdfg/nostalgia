import { dirname, basename } from 'node:path';

export interface TokenContext {
  romPath: string;
  systemSlug: string;
  emulatorDir: string;
  /** Native Ports only: the port's install folder ({installDir}). */
  installDir?: string;
}

/**
 * Substitutes launch tokens element-wise into the argv array. A path is never
 * split on spaces, hand-quoted, or concatenated across elements. Unknown tokens
 * are left as literal text.
 */
export function resolveArgs(template: string[], ctx: TokenContext): string[] {
  const map: Record<string, string> = {
    '{romPath}': ctx.romPath,
    '{romDir}': dirname(ctx.romPath),
    '{romName}': basename(ctx.romPath),
    '{systemSlug}': ctx.systemSlug,
    '{emulatorDir}': ctx.emulatorDir,
  };
  if (ctx.installDir != null) map['{installDir}'] = ctx.installDir;
  return template.map((arg) => {
    let out = arg;
    for (const [token, value] of Object.entries(map)) {
      if (out.includes(token)) out = out.split(token).join(value);
    }
    return out;
  });
}
