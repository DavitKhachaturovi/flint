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
  /**
   * REM-06, D-94: Flint's own chime when a reminder fires, besides the toast's Windows sound. Off
   * by default (the reminder toast already sounds); turned on in Settings from M8.
   */
  readonly reminderSound: boolean;
  /** REM-10: toasts say only "Flint reminder", for screen sharing. Default off. */
  readonly hideNotificationText: boolean;
  /** NOTE-07, TASK-10, D-84: the user's link patterns (edited in M8's Settings). */
  readonly linkPatterns: readonly LinkPattern[];
  /**
   * TASK-06, Q-13, D-88: completed tasks older than this many days move to `.flint/archive/`; null
   * is off (the default; Flint offers it when a Completed section grows large).
   */
  readonly autoArchiveDays: number | null;
  /** TODAY-02, D-100: "Unfinished from yesterday" on a new day's first open of Today. */
  readonly rolloverPrompt: boolean;
  /** DATA-04, D-99, D-100: how often a snapshot is taken (minutes), when something changed. */
  readonly snapshotEveryMinutes: number;
  /** D-99, D-100: how long every hour's newest snapshot is kept (hours). */
  readonly keepHourlyHours: number;
  /** D-99, D-100: how long every day's newest snapshot is kept (days). */
  readonly keepDailyDays: number;
  /** D-67, D-100: all motion slower, as it is, or quicker. */
  readonly animationSpeed: AnimationSpeed;
}

export type AnimationSpeed = 'relaxed' | 'normal' | 'quick';

/** D-100: the values Settings offers (anything else in the file falls back to the default). */
export const SNAPSHOT_EVERY = [30, 60, 120, 240] as const;
export const KEEP_HOURLY = [24, 48, 72, 168] as const;
export const KEEP_DAILY = [14, 30, 60, 90] as const;

/** Development builds default to their own folder, so they never write into the real one. */
export function defaultSettings(development = false): Settings {
  return {
    flintFolder: join(homedir(), development ? 'Flint (development)' : 'Flint'),
    captureHotkey: 'Control+Shift+Space',
    captureSelectionHotkey: 'Control+Shift+X',
    startWithWindows: true,
    notifications: true,
    reminderSound: false,
    hideNotificationText: false,
    linkPatterns: [],
    autoArchiveDays: null,
    rolloverPrompt: true,
    snapshotEveryMinutes: 60,
    keepHourlyHours: 48,
    keepDailyDays: 30,
    animationSpeed: 'normal',
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
const oneOf =
  (values: readonly number[]) =>
  (value: unknown): value is number =>
    typeof value === 'number' && values.includes(value);
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
    reminderSound: pick(stored, 'reminderSound', isBoolean, defaults.reminderSound),
    hideNotificationText: pick(
      stored,
      'hideNotificationText',
      isBoolean,
      defaults.hideNotificationText,
    ),
    linkPatterns: readLinkPatterns(stored['linkPatterns']),
    autoArchiveDays: isDays(stored['autoArchiveDays']) ? stored['autoArchiveDays'] : null,
    rolloverPrompt: pick(stored, 'rolloverPrompt', isBoolean, defaults.rolloverPrompt),
    snapshotEveryMinutes: pick(
      stored,
      'snapshotEveryMinutes',
      oneOf(SNAPSHOT_EVERY),
      defaults.snapshotEveryMinutes,
    ),
    keepHourlyHours: pick(stored, 'keepHourlyHours', oneOf(KEEP_HOURLY), defaults.keepHourlyHours),
    keepDailyDays: pick(stored, 'keepDailyDays', oneOf(KEEP_DAILY), defaults.keepDailyDays),
    animationSpeed: pick(
      stored,
      'animationSpeed',
      (value): value is AnimationSpeed =>
        value === 'relaxed' || value === 'normal' || value === 'quick',
      defaults.animationSpeed,
    ),
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
