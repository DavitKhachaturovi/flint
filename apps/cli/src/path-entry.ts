import { execFile } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

/**
 * AGENT-02 (D-185 Q14): `flint path add` / `flint path remove`, run by the installer and the
 * uninstaller (resources/installer.nsh), which then tell Windows the environment changed. Only the
 * user's PATH (`HKCU\Environment`), with guards: a value that reads back empty or is 8,000
 * characters or longer is left alone; the value's type (REG_EXPAND_SZ or REG_SZ) is kept; the
 * entry is added once, at the end; removing takes exactly that entry (a whole `;` item), never a
 * part of another (`C:\Windows\system32` must not cut `C:\Windows\system32\wbem`).
 */

export const PATH_LIMIT = 8000;

export interface PathValue {
  readonly value: string;
  readonly type: 'REG_EXPAND_SZ' | 'REG_SZ';
}

/** One PATH item, compared the way Windows does: case, a trailing backslash and quotes don't matter. */
export function sameEntry(a: string, b: string): boolean {
  const clean = (text: string): string =>
    text
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  return clean(a) !== '' && clean(a) === clean(b);
}

export type AddOutcome =
  | { readonly kind: 'write'; readonly value: string }
  | { readonly kind: 'present' }
  | { readonly kind: 'too-long' }
  | { readonly kind: 'unreadable' };

/** `current` null: no Path value yet. `exists`: whether the registry has one at all. */
export function addEntry(current: string | null, exists: boolean, entry: string): AddOutcome {
  if (current === null) return exists ? { kind: 'unreadable' } : { kind: 'write', value: entry };
  if (current.trim() === '' && exists) return { kind: 'unreadable' };
  if (current.length >= PATH_LIMIT) return { kind: 'too-long' };
  const items = current.split(';');
  if (items.some((item) => sameEntry(item, entry))) return { kind: 'present' };
  const base = current.replace(/;+$/, '');
  return { kind: 'write', value: base === '' ? entry : `${base};${entry}` };
}

export type RemoveOutcome =
  | { readonly kind: 'write'; readonly value: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'too-long' }
  | { readonly kind: 'unreadable' };

export function removeEntry(current: string | null, exists: boolean, entry: string): RemoveOutcome {
  if (current === null) return exists ? { kind: 'unreadable' } : { kind: 'absent' };
  if (current.length >= PATH_LIMIT) return { kind: 'too-long' };
  const items = current.split(';');
  const kept = items.filter((item) => !sameEntry(item, entry));
  if (kept.length === items.length) return { kind: 'absent' };
  return { kind: 'write', value: kept.join(';') };
}

/** `reg query`'s answer for one value: its type and data, or null when it isn't there. */
export function parseRegQuery(output: string, name: string): PathValue | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+(REG_EXPAND_SZ|REG_SZ)\s{4}(.*)$/.exec(line);
    if (match && match[1]?.toLowerCase() === name.toLowerCase())
      return { type: match[2] as PathValue['type'], value: match[3] ?? '' };
    const empty = /^\s+(\S+)\s+(REG_EXPAND_SZ|REG_SZ)\s*$/.exec(line);
    if (empty && empty[1]?.toLowerCase() === name.toLowerCase())
      return { type: empty[2] as PathValue['type'], value: '' };
  }
  return null;
}

const KEY = 'HKCU\\Environment';
/** By its full path (D-185 security review M5): never a reg.exe from the current folder. */
const REG = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'reg.exe');

function run(args: readonly string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(REG, [...args], { windowsHide: true }, (error, stdout) => {
      resolve({ code: error ? 1 : 0, stdout: String(stdout) });
    });
  });
}

/** The folder `flint.exe` is in, when it runs as the installed exe (never the development bundle). */
export function binFolder(execPath: string): string | null {
  return basename(execPath).toLowerCase() === 'flint.exe' ? dirname(execPath) : null;
}

/** The action of `flint path <action>`: the word after `path` (options aside). */
export function pathAction(argv: readonly string[]): string | undefined {
  const words = argv.filter((word) => !word.startsWith('-'));
  return words[0] === 'path' ? words[1] : undefined;
}

/** `flint path add|remove`: exit 0 when done or nothing to do, 4 when a guard left PATH alone. */
export async function runPath(
  action: string | undefined,
  execPath: string,
  out: (line: string) => void,
): Promise<number> {
  const entry = binFolder(execPath);
  if (!entry || (action !== 'add' && action !== 'remove')) {
    out('flint path add|remove is for Flint’s installer.');
    return 1;
  }
  const query = await run(['query', KEY, '/v', 'Path']);
  const current = query.code === 0 ? parseRegQuery(query.stdout, 'Path') : null;
  const exists = current !== null;
  const outcome =
    action === 'add'
      ? addEntry(current?.value ?? null, exists, entry)
      : removeEntry(current?.value ?? null, exists, entry);
  if (outcome.kind === 'write') {
    const type = current?.type ?? 'REG_EXPAND_SZ';
    const written = await run(['add', KEY, '/v', 'Path', '/t', type, '/d', outcome.value, '/f']);
    if (written.code !== 0) {
      out('Your PATH could not be changed.');
      return 5;
    }
    out(action === 'add' ? `Added ${entry} to your PATH.` : `Removed ${entry} from your PATH.`);
    return 0;
  }
  if (outcome.kind === 'too-long' || outcome.kind === 'unreadable') {
    out('Your PATH was left as it is (too long to change safely).');
    return 4;
  }
  return 0;
}
