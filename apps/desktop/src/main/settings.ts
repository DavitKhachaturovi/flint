import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';
import { readLinkPatterns, type LinkPattern } from '../shared/link-patterns.js';

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
  /** CAP-07, D-37; rebindable in APP-08. */
  readonly captureSelectionHotkey: string;
  /** APP-01, default on. */
  readonly startWithWindows: boolean;
  /** REM-06. */
  readonly notifications: boolean;
  readonly sound: boolean;
  /** REM-10: toasts say only "Flint reminder", for screen sharing. Default off. */
  readonly hideNotificationText: boolean;
  /** NOTE-07, TASK-10, D-84: the user's link patterns (edited in M8's Settings). */
  readonly linkPatterns: readonly LinkPattern[];
  /**
   * TASK-06, Q-13, D-88: completed tasks older than this many days move to `.flint/archive/`; null
   * is off (the default; Flint offers it when a Completed section grows large).
   */
  readonly autoArchiveDays: number | null;
}

/** Development builds default to their own folder, so they never write into the real one. */
export function defaultSettings(development = false): Settings {
  return {
    flintFolder: join(homedir(), development ? 'Flint (development)' : 'Flint'),
    captureHotkey: 'Control+Shift+Space',
    captureSelectionHotkey: 'Control+Shift+X',
    startWithWindows: true,
    notifications: true,
    sound: true,
    hideNotificationText: false,
    linkPatterns: [],
    autoArchiveDays: null,
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
const isDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365;

export function readSettings(stored: Stored, development = false): Settings {
  const defaults = defaultSettings(development);
  return {
    flintFolder: pick(stored, 'flintFolder', isString, defaults.flintFolder),
    captureHotkey: pick(stored, 'captureHotkey', isString, defaults.captureHotkey),
    captureSelectionHotkey: pick(
      stored,
      'captureSelectionHotkey',
      isString,
      defaults.captureSelectionHotkey,
    ),
    startWithWindows: pick(stored, 'startWithWindows', isBoolean, defaults.startWithWindows),
    notifications: pick(stored, 'notifications', isBoolean, defaults.notifications),
    sound: pick(stored, 'sound', isBoolean, defaults.sound),
    hideNotificationText: pick(
      stored,
      'hideNotificationText',
      isBoolean,
      defaults.hideNotificationText,
    ),
    linkPatterns: readLinkPatterns(stored['linkPatterns']),
    autoArchiveDays: isDays(stored['autoArchiveDays']) ? stored['autoArchiveDays'] : null,
  };
}

export class SettingsFile {
  private stored: Stored = {};
  current: Settings;
  readonly path: string;
  private readonly development: boolean;

  constructor(path: string, development = false) {
    this.path = path;
    this.development = development;
    this.current = defaultSettings(development);
  }

  async load(): Promise<Settings> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.stored = typeof parsed === 'object' && parsed !== null ? (parsed as Stored) : {};
    } catch {
      this.stored = {};
    }
    this.current = readSettings(this.stored, this.development);
    return this.current;
  }

  async update(changes: Partial<Settings>): Promise<Settings> {
    this.stored = { ...this.stored, ...changes, version: 1 };
    this.current = readSettings(this.stored, this.development);
    await writeFileAtomic(this.path, `${JSON.stringify(this.stored, null, 2)}\n`, {
      tempDirectory: join(dirname(this.path), 'tmp'),
    });
    return this.current;
  }
}
