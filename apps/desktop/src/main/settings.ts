import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';

/**
 * Settings (APP-11) in app data, never in the Flint folder (D-14, docs/04 §2). Reads are tolerant:
 * a missing or broken file gives the defaults, an invalid value falls back to its default, and keys
 * this version doesn't know are kept when saving.
 */
export interface Settings {
  /** DATA-07, D-24: outside OneDrive Known Folder Move by default. */
  readonly flintFolder: string;
  /** APP-08: rebindable in M3. No Alt in the default (Q-03). */
  readonly captureHotkey: string;
  /** APP-01, default on. */
  readonly startWithWindows: boolean;
  /** REM-06. */
  readonly notifications: boolean;
  readonly sound: boolean;
}

export function defaultSettings(): Settings {
  return {
    flintFolder: join(homedir(), 'Flint'),
    captureHotkey: 'Control+Shift+Space',
    startWithWindows: true,
    notifications: true,
    sound: true,
  };
}

type Stored = Record<string, unknown>;

function pick<T>(
  stored: Stored,
  key: string,
  valid: (value: unknown) => value is T,
  fallback: T,
): T {
  const value = stored[key];
  return valid(value) ? value : fallback;
}

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

export function readSettings(stored: Stored): Settings {
  const defaults = defaultSettings();
  return {
    flintFolder: pick(stored, 'flintFolder', isString, defaults.flintFolder),
    captureHotkey: pick(stored, 'captureHotkey', isString, defaults.captureHotkey),
    startWithWindows: pick(stored, 'startWithWindows', isBoolean, defaults.startWithWindows),
    notifications: pick(stored, 'notifications', isBoolean, defaults.notifications),
    sound: pick(stored, 'sound', isBoolean, defaults.sound),
  };
}

export class SettingsFile {
  private stored: Stored = {};
  current: Settings = defaultSettings();
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<Settings> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.stored = typeof parsed === 'object' && parsed !== null ? (parsed as Stored) : {};
    } catch {
      this.stored = {};
    }
    this.current = readSettings(this.stored);
    return this.current;
  }

  async update(changes: Partial<Settings>): Promise<Settings> {
    this.stored = { ...this.stored, ...changes, version: 1 };
    this.current = readSettings(this.stored);
    await writeFileAtomic(this.path, `${JSON.stringify(this.stored, null, 2)}\n`, {
      tempDirectory: join(dirname(this.path), 'tmp'),
    });
    return this.current;
  }
}
