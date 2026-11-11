import type { FocusMode, TimerSettings, TimerState } from '@flint/core/focus';

/**
 * FOCUS-01 to FOCUS-06 (D-170): what the main process, the main window and mini mode share about
 * Focus: the view's ID, its settings, the timer as broadcast, and the commands.
 */

/** The Focus page's ID: a view over the sprint's tasks, never a file (`@` can't start a list's ID). */
export const FOCUS_ID = '@focus';

/** FOCUS-05: Flint's own alarm sounds (made like the reminder chime, D-95, D-96), or none. */
export const ALARM_SOUNDS = ['nudge', 'drop', 'mallet', 'none'] as const;
export type AlarmSound = (typeof ALARM_SOUNDS)[number];

export const ALARM_SOUND_NAMES: Readonly<Record<AlarmSound, string>> = {
  nudge: 'Nudge',
  drop: 'Drop',
  mallet: 'Mallet',
  none: 'None',
};

/** FOCUS-04: the heads-up before a focus session ends (0 is off), minutes. */
export const HEADS_UP_MINUTES = [0, 1, 2, 5, 10] as const;

/** FOCUS-05: the settings card and Settings → Focus; kept in `settings.json` as `focus`. */
export interface FocusSettings extends TimerSettings {
  /** Complete the active task when its count reaches its estimate. */
  readonly autoCheck: boolean;
  /** Done tasks sink below the open ones. */
  readonly checkToBottom: boolean;
  readonly sound: AlarmSound;
  /** 0 to 100. */
  readonly volume: number;
  /** How many times the alarm plays, 1 to 5. */
  readonly repeat: number;
  /** The toast when a session ends. */
  readonly notifyEnd: boolean;
  /** Minutes before a focus session ends for a quiet toast; 0 is off. */
  readonly headsUpMinutes: number;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longEvery: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  autoCheck: false,
  checkToBottom: true,
  sound: 'nudge',
  volume: 50,
  repeat: 1,
  notifyEnd: true,
  headsUpMinutes: 0,
};

/** Minutes a mode can be set to. */
export const MAX_MINUTES = 180;

const wholeIn = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;

/** Tolerant: each value that isn't valid falls back to its default. */
export function readFocusSettings(value: unknown): FocusSettings {
  const stored =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const d = DEFAULT_FOCUS_SETTINGS;
  const flag = (key: keyof FocusSettings, fallback: boolean): boolean =>
    typeof stored[key] === 'boolean' ? stored[key] : fallback;
  return {
    focusMinutes: wholeIn(stored.focusMinutes, 1, MAX_MINUTES) ?? d.focusMinutes,
    shortMinutes: wholeIn(stored.shortMinutes, 1, MAX_MINUTES) ?? d.shortMinutes,
    longMinutes: wholeIn(stored.longMinutes, 1, MAX_MINUTES) ?? d.longMinutes,
    longEvery: wholeIn(stored.longEvery, 1, 12) ?? d.longEvery,
    autoStartBreaks: flag('autoStartBreaks', d.autoStartBreaks),
    autoStartFocus: flag('autoStartFocus', d.autoStartFocus),
    autoCheck: flag('autoCheck', d.autoCheck),
    checkToBottom: flag('checkToBottom', d.checkToBottom),
    sound: ALARM_SOUNDS.find((sound) => sound === stored.sound) ?? d.sound,
    volume: wholeIn(stored.volume, 0, 100) ?? d.volume,
    repeat: wholeIn(stored.repeat, 1, 5) ?? d.repeat,
    notifyEnd: flag('notifyEnd', d.notifyEnd),
    headsUpMinutes:
      HEADS_UP_MINUTES.find((minutes) => minutes === stored.headsUpMinutes) ?? d.headsUpMinutes,
  };
}

/** Main → windows: the timer as it is now, and the settings it runs by. */
export interface FocusTimerView {
  readonly state: TimerState;
  readonly settings: FocusSettings;
}

/** The timer's buttons, keys and palette commands. */
export type FocusCommand =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'mode'; readonly mode: FocusMode };

/** FOCUS-02: the Focus page's ⋯ menu (each only changes the sprint, one undo step). */
export type FocusAction = 'clearFinished' | 'resetCounts' | 'removeAll';

/** FOCUS-02, FOCUS-03: a sprint task's numbers in the Focus view, by task key. */
export interface FocusEntry {
  readonly estimate: number;
  readonly count: number;
}

/** What the Focus view carries besides its rows. */
export interface FocusExtras {
  /** Every row's numbers, by key. */
  readonly entries: Readonly<Record<string, FocusEntry>>;
  /** The active task: the top open one (null: none open). */
  readonly active: string | null;
}

/** The name of a mode, as the tabs, the toast and the palette say it. */
export const MODE_NAMES: Readonly<Record<FocusMode, string>> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};
