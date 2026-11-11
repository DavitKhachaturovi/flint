/**
 * FOCUS-01, FOCUS-04 (D-170): Focus's timer as a pure state machine. The state is kept as the
 * moment the running session ends (or the time left while it doesn't run), never as ticks, so
 * whoever shows it computes the digits from the clock and nothing drifts (docs/05 §5). The main
 * process owns one state, saves it in `focus-state.json` and sets one timeout for its end.
 */

export type FocusMode = 'focus' | 'short' | 'long';

export interface TimerSettings {
  readonly focusMinutes: number;
  readonly shortMinutes: number;
  readonly longMinutes: number;
  /** A long break after this many finished focus sessions. */
  readonly longEvery: number;
  readonly autoStartBreaks: boolean;
  readonly autoStartFocus: boolean;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longEvery: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
};

export interface TimerState {
  readonly mode: FocusMode;
  /** While running: when the session ends (ms since the epoch); null otherwise. */
  readonly endsAt: number | null;
  /** While not running: the time left (ms); a full mode's length when it hasn't started. */
  readonly left: number;
  /** The mode's length when it was set (ms), for the progress line and "not started yet". */
  readonly length: number;
  /** "#N": this focus session's number today, from 1. */
  readonly session: number;
  /** Focus sessions finished today (for the long break). */
  readonly finished: number;
  /** The local day (`YYYY-MM-DD`) `session` and `finished` count. */
  readonly day: string;
}

/** A session processed later than this after its end (Flint closed, the PC asleep) is quiet. */
export const LATE_MS = 60_000;

const MINUTE = 60_000;

export function modeLength(mode: FocusMode, settings: TimerSettings): number {
  const minutes =
    mode === 'focus'
      ? settings.focusMinutes
      : mode === 'short'
        ? settings.shortMinutes
        : settings.longMinutes;
  return Math.max(1, Math.round(minutes * MINUTE));
}

export function initialTimer(settings: TimerSettings, day: string): TimerState {
  const length = modeLength('focus', settings);
  return { mode: 'focus', endsAt: null, left: length, length, session: 1, finished: 0, day };
}

export const timerRunning = (state: TimerState): boolean => state.endsAt !== null;

/** Not running and not started: the mode's full length waits. */
export const timerReady = (state: TimerState): boolean =>
  state.endsAt === null && state.left === state.length;

/** Started, then paused. */
export const timerPaused = (state: TimerState): boolean =>
  state.endsAt === null && state.left !== state.length;

/** The time left now (ms), never below 0. */
export function timeLeft(state: TimerState, now: number): number {
  return state.endsAt === null ? state.left : Math.max(0, state.endsAt - now);
}

/** How far the session is (0 to 1), for the progress line. */
export function timerProgress(state: TimerState, now: number): number {
  if (state.length <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - timeLeft(state, now) / state.length));
}

export function startTimer(state: TimerState, now: number): TimerState {
  if (state.endsAt !== null) return state;
  return { ...state, endsAt: now + state.left };
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.endsAt === null) return state;
  return { ...state, endsAt: null, left: Math.max(0, state.endsAt - now) };
}

/** Shift+Space and the big button: start, or pause. */
export function toggleTimer(state: TimerState, now: number): TimerState {
  return state.endsAt === null ? startTimer(state, now) : pauseTimer(state, now);
}

/** A mode tab: that mode, ready (what was running stops; nothing counts). */
export function switchTimerMode(
  state: TimerState,
  mode: FocusMode,
  settings: TimerSettings,
): TimerState {
  const length = modeLength(mode, settings);
  return { ...state, mode, endsAt: null, left: length, length };
}

/** A new day: "#N" starts again at 1 and the long-break count at 0. */
export function timerForDay(state: TimerState, day: string): TimerState {
  return state.day === day ? state : { ...state, day, session: 1, finished: 0 };
}

/** After a settings change: a mode that hasn't started takes its new length. */
export function timerWithSettings(state: TimerState, settings: TimerSettings): TimerState {
  if (!timerReady(state)) return state;
  const length = modeLength(state.mode, settings);
  return length === state.length ? state : { ...state, left: length, length };
}

const breakAfter = (finished: number, settings: TimerSettings): FocusMode =>
  settings.longEvery > 0 && finished > 0 && finished % settings.longEvery === 0 ? 'long' : 'short';

export interface FinishedSession {
  readonly state: TimerState;
  /** The mode that ended. */
  readonly ended: FocusMode;
  /** A focus session that ran to its end: it counts for the active task. */
  readonly counted: boolean;
  /** Processed late (Flint closed, the PC asleep): no sound, no toast, nothing counts. */
  readonly quiet: boolean;
}

/**
 * The running session ended (its end time has come): the next mode, waiting or started by the
 * auto-start settings. A focus session counts and moves "#N" on; a late one is closed quietly:
 * the next mode waits, nothing counts.
 */
export function finishSession(
  state: TimerState,
  settings: TimerSettings,
  now: number,
): FinishedSession | null {
  if (state.endsAt === null || state.endsAt > now) return null;
  const quiet = now - state.endsAt > LATE_MS;
  const ended = state.mode;
  if (ended === 'focus') {
    const finished = quiet ? state.finished : state.finished + 1;
    const session = quiet ? state.session : state.session + 1;
    const next = switchTimerMode(
      { ...state, finished, session },
      breakAfter(finished, settings),
      settings,
    );
    return {
      state: !quiet && settings.autoStartBreaks ? startTimer(next, now) : next,
      ended,
      counted: !quiet,
      quiet,
    };
  }
  const next = switchTimerMode(state, 'focus', settings);
  return {
    state: !quiet && settings.autoStartFocus ? startTimer(next, now) : next,
    ended,
    counted: false,
    quiet,
  };
}

/**
 * Skip: on to the next mode without counting (a focus session to a short break: it didn't finish,
 * so it never earns the long one; a break to focus), started if that mode auto-starts.
 */
export function skipSession(state: TimerState, settings: TimerSettings, now: number): TimerState {
  if (state.mode === 'focus') {
    const next = switchTimerMode(state, 'short', settings);
    return settings.autoStartBreaks ? startTimer(next, now) : next;
  }
  const next = switchTimerMode(state, 'focus', settings);
  return settings.autoStartFocus ? startTimer(next, now) : next;
}

/** A sprint task's numbers, for the finish line. */
export interface FocusPlanTask {
  readonly estimate: number;
  readonly count: number;
  readonly done: boolean;
}

export interface FocusPlan {
  /** Focus sessions done and planned, over the whole sprint: "2 of 7 sessions". */
  readonly done: number;
  readonly total: number;
  /** When the open tasks' remaining sessions (and the breaks between them) end, ms; null: none. */
  readonly finishAt: number | null;
}

/**
 * FOCUS-03: "2 of 7 sessions · finish at 15:40": every task's count and estimate summed; the
 * finish from now: the open tasks' remaining sessions with the breaks between them (a long one
 * after every `longEvery`-th), the running or paused session's time left counted as the first.
 */
export function focusPlan(
  tasks: readonly FocusPlanTask[],
  state: TimerState,
  settings: TimerSettings,
  now: number,
): FocusPlan {
  const done = tasks.reduce((sum, task) => sum + task.count, 0);
  const total = tasks.reduce((sum, task) => sum + Math.max(task.estimate, task.count), 0);
  let sessions = tasks
    .filter((task) => !task.done)
    .reduce((sum, task) => sum + Math.max(0, task.estimate - task.count), 0);
  if (sessions === 0) return { done, total, finishAt: null };
  let at = now;
  let finished = state.finished;
  if (state.mode !== 'focus') at += timeLeft(state, now);
  else if (!timerReady(state)) {
    // The session under way is the first of them.
    at += timeLeft(state, now);
    sessions--;
    finished++;
    if (sessions > 0) at += modeLength(breakAfter(finished, settings), settings);
  }
  for (let left = sessions; left > 0; left--) {
    at += modeLength('focus', settings);
    finished++;
    if (left > 1) at += modeLength(breakAfter(finished, settings), settings);
  }
  return { done, total, finishAt: at };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MODES: readonly FocusMode[] = ['focus', 'short', 'long'];
const count = (value: unknown, min: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= min ? Math.round(value) : null;

/**
 * The timer saved in `focus-state.json` (app data, docs/04 §2), or a fresh one when the file is
 * missing or unreadable. Tolerant: a value out of range gives the fresh timer's.
 */
export function parseTimerState(text: string, settings: TimerSettings, day: string): TimerState {
  const fresh = initialTimer(settings, day);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fresh;
  }
  if (typeof parsed !== 'object' || parsed === null) return fresh;
  const value = parsed as Record<string, unknown>;
  const mode = MODES.find((each) => each === value.mode);
  const length = count(value.length, 1);
  const left = count(value.left, 0);
  if (!mode || length === null || left === null) return fresh;
  const endsAt = value.endsAt === null ? null : count(value.endsAt, 0);
  if (endsAt === null && value.endsAt !== null) return fresh;
  return timerForDay(
    {
      mode,
      endsAt,
      left: Math.min(left, length),
      length,
      session: count(value.session, 1) ?? 1,
      finished: count(value.finished, 0) ?? 0,
      day: typeof value.day === 'string' && DAY.test(value.day) ? value.day : day,
    },
    day,
  );
}

export function serializeTimerState(state: TimerState): string {
  const { mode, endsAt, left, length, session, finished, day } = state;
  return `${JSON.stringify({ flint: 1, mode, endsAt, left, length, session, finished, day }, null, 2)}\n`;
}
