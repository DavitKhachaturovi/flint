import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';
import { readLinkPatterns, type LinkPattern } from '../shared/link-patterns.js';
import { DEFAULT_FOCUS_SETTINGS, readFocusSettings, type FocusSettings } from '../shared/focus.js';

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
  /** D-105: the built-in link recognizers turned off in Settings → Links (preset ids). */
  readonly builtInLinksOff: readonly string[];
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
  /**
   * MINI-01, D-109: show or hide mini mode, anywhere. Ctrl+Alt+Space by default: a deliberate
   * exception to D-44's no-Alt rule (it pairs with the capture hotkey).
   */
  readonly miniHotkey: string;
  /**
   * MINI-02, D-157: capture the selected text into mini mode's note. Ctrl+Alt+X by default, mini's
   * pair to Ctrl+Alt+Space (the same Alt exception); on layouts where AltGr stands for Ctrl+Alt,
   * AltGr+X types a character in some apps, so Settings says to change it then.
   */
  readonly miniSelectionHotkey: string;
  /** D-109: mini mode left out of screen shares and recordings (on by default). */
  readonly miniHideFromSharing: boolean;
  /** D-109: the capture popup too (on by default). */
  readonly popupHideFromSharing: boolean;
  /** REM-06, D-109: Flint's reminder card in mini mode when it is open, or always (opening it). */
  readonly miniReminders: MiniReminders;
  /** D-109: mini mode always on top (its header's pin). */
  readonly miniOnTop: boolean;
  /** APP-15, D-117: the version whose What's new was last shown; null before What's new existed. */
  readonly lastSeenVersion: string | null;
  /** APP-14, D-118: Don't show tips (off by default: tips show). */
  readonly tipsOff: boolean;
  /** NAV-08, D-128: Windows' clipboard history in the side panel and the picker (on by default). */
  readonly clipboardHistory: boolean;
  /** D-128: its contents shown at rest, not only on a resting pointer (off by default). */
  readonly clipboardShowContents: boolean;
  /** APP-06, D-136: check GitHub Releases for updates automatically (on by default). */
  readonly checkForUpdates: boolean;
  /**
   * TASK-18, D-151: Give to Claude's folder per list (by the list's id), an absolute path on this
   * machine; never in the Flint folder, which may travel to another machine.
   */
  readonly claudeFolders: Readonly<Record<string, string>>;
  /** D-151: the folders given to most recently, newest first (five at most). */
  readonly claudeRecentFolders: readonly string[];
  /** FOCUS-05 (D-170): Focus's timer, tasks, sound and notifications. */
  readonly focus: FocusSettings;
}

export type MiniReminders = 'when-open' | 'always';

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
    builtInLinksOff: [],
    autoArchiveDays: null,
    rolloverPrompt: true,
    snapshotEveryMinutes: 60,
    keepHourlyHours: 48,
    keepDailyDays: 30,
    animationSpeed: 'normal',
    miniHotkey: 'Control+Alt+Space',
    miniSelectionHotkey: 'Control+Alt+X',
    miniHideFromSharing: true,
    popupHideFromSharing: true,
    miniReminders: 'when-open',
    miniOnTop: true,
    lastSeenVersion: null,
    tipsOff: false,
    clipboardHistory: true,
    clipboardShowContents: false,
    checkForUpdates: true,
    claudeFolders: {},
    claudeRecentFolders: [],
    focus: DEFAULT_FOCUS_SETTINGS,
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
/** D-151: Give to Claude keeps at most this many recent folders. */
export const CLAUDE_RECENT_FOLDERS = 5;

/** An absolute Windows path (`C:\…` or `\\server\…`), as Give to Claude's folders must be. */
export function isAbsoluteFolder(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length < 1024 &&
    /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/.test(value) &&
    !/[\0\r\n]/.test(value)
  );
}

function readClaudeFolders(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const folders: Record<string, string> = {};
  for (const [list, folder] of Object.entries(value as Record<string, unknown>))
    if (list !== '' && isAbsoluteFolder(folder)) folders[list] = folder;
  return folders;
}

function readRecentFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  // Once each, whatever the letter case (Windows paths), the first one kept.
  const seen = new Set<string>();
  return value
    .filter(isAbsoluteFolder)
    .filter((path) => !seen.has(path.toLowerCase()) && seen.add(path.toLowerCase()))
    .slice(0, CLAUDE_RECENT_FOLDERS);
}

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
    builtInLinksOff: Array.isArray(stored['builtInLinksOff'])
      ? (stored['builtInLinksOff'] as unknown[]).filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
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
    miniHotkey: pick(stored, 'miniHotkey', isString, defaults.miniHotkey),
    miniSelectionHotkey: pick(
      stored,
      'miniSelectionHotkey',
      isString,
      defaults.miniSelectionHotkey,
    ),
    miniHideFromSharing: pick(
      stored,
      'miniHideFromSharing',
      isBoolean,
      defaults.miniHideFromSharing,
    ),
    popupHideFromSharing: pick(
      stored,
      'popupHideFromSharing',
      isBoolean,
      defaults.popupHideFromSharing,
    ),
    miniReminders: pick(
      stored,
      'miniReminders',
      (value): value is MiniReminders => value === 'when-open' || value === 'always',
      defaults.miniReminders,
    ),
    miniOnTop: pick(stored, 'miniOnTop', isBoolean, defaults.miniOnTop),
    lastSeenVersion: isString(stored['lastSeenVersion']) ? stored['lastSeenVersion'] : null,
    tipsOff: pick(stored, 'tipsOff', isBoolean, defaults.tipsOff),
    clipboardHistory: pick(stored, 'clipboardHistory', isBoolean, defaults.clipboardHistory),
    checkForUpdates: pick(stored, 'checkForUpdates', isBoolean, defaults.checkForUpdates),
    clipboardShowContents: pick(
      stored,
      'clipboardShowContents',
      isBoolean,
      defaults.clipboardShowContents,
    ),
    claudeFolders: readClaudeFolders(stored['claudeFolders']),
    claudeRecentFolders: readRecentFolders(stored['claudeRecentFolders']),
    focus: readFocusSettings(stored['focus']),
  };
}

export class SettingsFile {
  private stored: Stored = {};
  current: Settings;
  readonly path: string;
  private readonly development: boolean;
  /** D-117: whether the file was there when loaded (none: a fresh install, which gets the tour). */
  existed = false;

  constructor(path: string, development = false) {
    this.path = path;
    this.development = development;
    this.current = defaultSettings(development);
  }

  async load(): Promise<Settings> {
    try {
      const text = await readFile(this.path, 'utf8');
      this.existed = true;
      const parsed: unknown = JSON.parse(text);
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
