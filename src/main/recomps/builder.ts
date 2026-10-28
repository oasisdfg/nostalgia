import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { delimiter, join, parse } from 'node:path';
import type { RecompManifest } from '@shared/contracts/recomps';
import { broadcastEvent } from '../ipc/registry';
import { getInstall } from '../db/repositories/recompsRepo';
import { ensureCached } from '../launch/launcher';
import { fileForPort } from './linker';
import { portDir } from './paths';

/**
 * Builds a port from source on the user's PC (bundled registry only - see RecompBuild):
 * git clone/pull the repo, then run its own build script with python, streaming its output
 * to <portDir>/build.log. The renderer gets the current step and percentage live
 * (recomps:buildStatus) - not a raw log panel - and can open the full log file.
 * Every command is spawned with an argv array; nothing goes through a shell.
 */

const STATUS_INTERVAL_MS = 250;

export class BuildError extends Error {}

/** A short build folder Nostalgia owns: <system drive>\nostalgia-<id> (see RecompBuild). */
export function buildWorkDir(id: string): string {
  const drive = process.env.SystemDrive || parse(process.cwd()).root.replace(/\\$/, '') || 'C:';
  return join(`${drive}\\`, `nostalgia-${id}`);
}

export function buildLogPath(id: string): string {
  return join(portDir(id), 'build.log');
}

export function sourceDir(id: string): string {
  return join(portDir(id), 'src');
}

/** Finds an executable on PATH (main-resolved, absolute), skipping the Microsoft Store stubs. */
function onPath(names: string[]): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir || /\\WindowsApps\\?$/i.test(dir)) continue; // python.exe there only opens the Store
    for (const name of names) {
      const full = join(dir, name);
      try {
        if (statSync(full).isFile()) return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

/** Python 3: python.exe on PATH, else the `py` launcher with `-3`. */
export function findPython(): { exe: string; prefix: string[] } | null {
  const python = onPath(['python.exe', 'python3.exe']);
  if (python) return { exe: python, prefix: [] };
  const py = onPath(['py.exe']);
  return py ? { exe: py, prefix: ['-3'] } : null;
}

export function findGit(): string | null {
  return onPath(['git.exe']);
}

/** Kills a process and everything it started (cmake, ninja, the compiler...). */
function killTree(child: ChildProcess): void {
  if (child.pid == null) return;
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () =>
    child.kill(),
  );
}

/** Runs one command, appending its output to the log and feeding each line to `onLine`. */
function run(
  exe: string,
  args: string[],
  opts: { cwd: string; log: NodeJS.WritableStream; signal: AbortSignal; onLine?: (line: string) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    opts.log.write(`\n> ${[exe, ...args].join(' ')}\n`);
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    const onAbort = (): void => killTree(child);
    opts.signal.addEventListener('abort', onAbort, { once: true });
    let pending = '';
    const feed = (chunk: Buffer): void => {
      const text = chunk.toString();
      opts.log.write(text);
      pending += text;
      // Progress lines redraw with \r; treat both \r and \n as line ends.
      const parts = pending.split(/\r\n|\r|\n/);
      pending = parts.pop() ?? '';
      for (const line of parts) if (line.trim()) opts.onLine?.(line);
      if (pending.trim()) opts.onLine?.(pending); // a live "  42 %" before its line ends
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('error', (e) => {
      opts.signal.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      opts.signal.removeEventListener('abort', onAbort);
      if (opts.signal.aborted) reject(new Error('aborted'));
      else if (code === 0) resolve();
      else reject(new BuildError(`exit ${code}`));
    });
  });
}

/** stdout of a short command (git rev-parse), or null. */
function capture(exe: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

function tokens(arg: string, map: Record<string, string>): string {
  let out = arg;
  for (const [token, value] of Object.entries(map)) if (out.includes(token)) out = out.split(token).join(value);
  return out;
}

/**
 * Clones/updates and builds. Throws BuildError with a human message on failure; the caller
 * owns the install row's state. Resolves with the built commit (short sha).
 */
export async function runBuild(manifest: RecompManifest, signal: AbortSignal): Promise<{ commit: string; dir: string }> {
  const build = manifest.build;
  if (!build) throw new BuildError('This port is not built from source.');
  const id = manifest.id;
  const git = findGit();
  const python = findPython();
  if ((build.requires.includes('git') && !git) || (build.requires.includes('python') && !python)) {
    throw new BuildError(`${manifest.name} is built on your PC and needs: ${build.requirements}`);
  }
  const row = getInstall(id);
  if (row?.linked_game_id == null) throw new BuildError(`Link your copy of ${manifest.originalTitle} first.`);
  const fileId = fileForPort(id, row.linked_game_id);
  if (fileId == null) throw new BuildError('The linked game has no file yet.');

  await mkdir(portDir(id), { recursive: true });
  const log = createWriteStream(buildLogPath(id), { flags: 'w' });
  let step = 'Getting ready…';
  let detail = '';
  let last = 0;
  const status = (force = false): void => {
    const now = Date.now();
    if (!force && now - last < STATUS_INTERVAL_MS) return;
    last = now;
    broadcastEvent('recomps:buildStatus', { id, step, detail });
  };
  const setStep = (s: string): void => {
    step = s;
    detail = '';
    status(true);
  };

  try {
    setStep('Getting your game file…');
    const romPath = await ensureCached(fileId);

    const src = sourceDir(id);
    if (existsSync(join(src, '.git'))) {
      setStep('Updating the source code…');
      await run(git!, ['-C', src, 'pull', '--ff-only'], { cwd: portDir(id), log, signal });
    } else {
      setStep('Downloading the source code…');
      await rm(src, { recursive: true, force: true });
      await run(git!, ['clone', '--depth', '1', `https://github.com/${manifest.repo}.git`, src], {
        cwd: portDir(id),
        log,
        signal,
      });
    }

    setStep('Building… (this can take an hour the first time)');
    const map = { '{romPath}': romPath, '{workDir}': buildWorkDir(id) };
    await run(python!.exe, [...python!.prefix, ...build.install.map((a) => tokens(a, map))], {
      cwd: src,
      log,
      signal,
      onLine: (line) => {
        const stepLine = /^==>\s*(.+)$/.exec(line.trim());
        if (stepLine) {
          step = stepLine[1];
          detail = '';
          status(true);
          return;
        }
        const pct = /^\s*(\d{1,3})\s*%\s*$/.exec(line);
        detail = pct ? `${pct[1]}%` : line.trim().slice(0, 140);
        status();
      },
    });
    const commit = (await capture(git!, ['rev-parse', '--short', 'HEAD'], src)) ?? 'source';
    return { commit, dir: src };
  } catch (e) {
    if (signal.aborted) throw e;
    if (e instanceof BuildError && !/^exit /.test(e.message)) throw e;
    throw new BuildError(`The build stopped during "${step}". Open the build log for details.`);
  } finally {
    log.end();
  }
}

/** Removes the source checkout and Nostalgia's build folder (never the game or saves). */
export async function removeBuild(id: string): Promise<void> {
  await rm(sourceDir(id), { recursive: true, force: true });
  await rm(buildWorkDir(id), { recursive: true, force: true });
  await rm(buildLogPath(id), { force: true });
}
