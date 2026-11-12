/**
 * AGENT-02 (D-185 Q2, Q3): where the running Flint is. `flint.exe` reads exactly two small files in
 * Flint's app-data folder, `agent-state.json` and `agent-token`, and nothing else of Flint's.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AGENT_STATE_FILE, AGENT_TOKEN_FILE, type AgentState } from '@flint/core/agents';

export type Env = Readonly<Record<string, string | undefined>>;

/** The development `flint` talks to the development Flint (D-33): `--dev` or `FLINT_IDENTITY`. */
export const isDevelopment = (env: Env, devFlag: boolean): boolean =>
  devFlag || env['FLINT_IDENTITY'] === 'development';

/**
 * Flint's app-data folder (docs/04 §2): `FLINT_APP_DATA` (tests), else `%APPDATA%\Flint`, or
 * `%APPDATA%\Flint (development)` for the development build (D-33's identity names).
 */
export function appDataDir(env: Env, development: boolean, installed = false): string {
  // D-185 security review: the installed flint.exe ignores the test overrides.
  const override = installed ? undefined : env['FLINT_APP_DATA'];
  if (override) return override;
  const roaming = env['APPDATA'] || join(homedir(), 'AppData', 'Roaming');
  return join(roaming, development ? 'Flint (development)' : 'Flint');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `agent-state.json`, or null when it's missing or not a state Flint wrote. */
export function readState(dir: string): AgentState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, AGENT_STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed['pid'] !== 'number' ||
    typeof parsed['on'] !== 'boolean' ||
    typeof parsed['protocol'] !== 'number'
  )
    return null;
  const pipe = parsed['pipe'];
  return {
    protocol: parsed['protocol'],
    pid: parsed['pid'],
    on: parsed['on'],
    readOnly: parsed['readOnly'] === true,
    paused: parsed['paused'] === true,
    pipe: typeof pipe === 'string' && pipe !== '' ? pipe : null,
    version: typeof parsed['version'] === 'string' ? parsed['version'] : '',
  };
}

/** `agent-token`: the file's whole text, trimmed; null when missing or empty. */
export function readToken(dir: string): string | null {
  try {
    const token = readFileSync(join(dir, AGENT_TOKEN_FILE), 'utf8').trim();
    return token === '' ? null : token;
  } catch {
    return null;
  }
}

/** Whether a process is alive: signal 0 checks without sending anything; EPERM means it is. */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The `Flint.exe` to start when Flint isn't running (AGENT-02):
 * - `FLINT_EXE` when set (tests, or a development build);
 * - the single executable in `<install>\resources\bin\flint.exe`: `<install>\Flint.exe`;
 * - `node flint.cjs` (not the single executable): the per-user install folder electron-builder uses,
 *   `%LOCALAPPDATA%\Programs\flint\Flint.exe` (Proposed);
 * - null for the development build without `FLINT_EXE`: it can't be started from here.
 */
export function flintExePath(
  env: Env,
  options: { readonly development: boolean; readonly execPath: string; readonly isSea: boolean },
): string | null {
  // D-185 security review: the installed flint.exe ignores the test override.
  const override = options.isSea ? undefined : env['FLINT_EXE'];
  if (override) return resolve(override);
  if (options.development) return null;
  if (options.isSea) return resolve(dirname(options.execPath), '..', '..', 'Flint.exe');
  const local = env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local');
  return join(local, 'Programs', 'flint', 'Flint.exe');
}
