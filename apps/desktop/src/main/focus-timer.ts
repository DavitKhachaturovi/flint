import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  finishSession,
  parseTimerState,
  pauseTimer,
  serializeTimerState,
  skipSession,
  startTimer,
  switchTimerMode,
  timerForDay,
  timerWithSettings,
  toggleTimer,
  type FinishedSession,
  type TimerState,
} from '@flint/core/focus';
import type { FocusCommand, FocusSettings } from '../shared/focus.js';
import { writeFileAtomic } from './storage/atomic.js';
import { dayStamp } from './today-file.js';

export interface FocusTimerOptions {
  /** `focus-state.json` in app data (machine state, never synced). */
  readonly path: string;
  readonly settings: () => FocusSettings;
  /** Flint's clock (the tests fix it, D-107). */
  readonly now: () => Date;
  /** A session reached its end (`quiet`: processed late, nothing to announce). */
  readonly finished: (result: FinishedSession) => void;
  /** FOCUS-04: the heads-up time before a focus session's end has come. */
  readonly headsUp: (minutes: number) => void;
  /** The state changed (a command, an end, a new day): the windows show it. */
  readonly changed: (state: TimerState) => void;
  readonly log: (message: string) => void;
}

/**
 * FOCUS-01, FOCUS-04 (D-170, docs/05 §5): the main process's one Focus timer. It keeps the state
 * as core defines it (the moment the session ends, or the time left), saves it on every change,
 * and sets one timeout for the end and one for the heads-up; the windows only show it. Sleep, a
 * restart, an update or a crash lose nothing: the end is computed from the clock again, and a
 * session whose end passed long ago is closed quietly.
 */
export class FocusTimer {
  private value: TimerState;
  private endTimer: NodeJS.Timeout | undefined;
  private headsUpTimer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();
  private readonly options: FocusTimerOptions;

  private constructor(options: FocusTimerOptions, state: TimerState) {
    this.options = options;
    this.value = state;
  }

  static async start(options: FocusTimerOptions): Promise<FocusTimer> {
    const now = options.now();
    const text = await readFile(options.path, 'utf8').catch(() => '');
    const timer = new FocusTimer(options, parseTimerState(text, options.settings(), dayStamp(now)));
    // A session that ended while Flint was closed is closed now (quietly, if it was long ago).
    timer.check();
    timer.schedule();
    return timer;
  }

  get state(): TimerState {
    return this.value;
  }

  private set(next: TimerState): void {
    if (next === this.value) return;
    this.value = next;
    this.save();
    this.schedule();
    this.options.changed(next);
  }

  private save(): void {
    const text = serializeTimerState(this.value);
    const path = this.options.path;
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFileAtomic(path, text, { tempDirectory: join(dirname(path), 'tmp') }).catch(
        (error: unknown) => this.options.log(`focus timer not saved: ${String(error)}`),
      );
    });
  }

  /** D-138: resolves once the last change is written (a quit waits for it). */
  settled(): Promise<void> {
    return this.writing;
  }

  /** The buttons, Shift+Space, a mode tab, the palette. */
  command(command: FocusCommand): void {
    const now = this.options.now();
    const settings = this.options.settings();
    const state = timerForDay(this.value, dayStamp(now));
    const at = now.getTime();
    this.set(
      command.kind === 'toggle'
        ? toggleTimer(state, at)
        : command.kind === 'skip'
          ? skipSession(state, settings, at)
          : switchTimerMode(state, command.mode, settings),
    );
  }

  /** The toast's Start break / Start focus: the waiting mode starts (nothing if it runs). */
  startWaiting(): void {
    this.set(
      startTimer(
        timerForDay(this.value, dayStamp(this.options.now())),
        this.options.now().getTime(),
      ),
    );
  }

  /** Pauses a running session (nothing otherwise). */
  pause(): void {
    this.set(pauseTimer(this.value, this.options.now().getTime()));
  }

  /** The settings changed: a mode that hasn't started takes its new length. */
  settingsChanged(): void {
    this.set(timerWithSettings(this.value, this.options.settings()));
    this.schedule();
  }

  /**
   * The end has come, or may have (a timeout, waking from sleep, the day changing): the session is
   * finished as core says, and a new day starts "#N" again.
   */
  check(): void {
    const now = this.options.now();
    let state = timerForDay(this.value, dayStamp(now));
    const result = finishSession(state, this.options.settings(), now.getTime());
    if (result) state = result.state;
    this.set(state);
    if (result) {
      this.options.log(
        `focus: ${result.ended} ended${result.quiet ? ' (late, quiet)' : ''}${result.counted ? ', counted' : ''}`,
      );
      this.options.finished(result);
    }
    // A timeout that fired early (long waits go in steps) waits again.
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.endTimer);
    clearTimeout(this.headsUpTimer);
    this.endTimer = undefined;
    this.headsUpTimer = undefined;
    const { endsAt, mode } = this.value;
    if (endsAt === null) return;
    const now = this.options.now().getTime();
    // Timers drift and sleep: aim at the end and check again then (a long wait in steps).
    const wait = Math.max(0, endsAt - now);
    this.endTimer = setTimeout(() => this.check(), Math.min(wait + 15, 60 * 60_000));
    const minutes = this.options.settings().headsUpMinutes;
    const headsUpAt = endsAt - minutes * 60_000;
    if (mode === 'focus' && minutes > 0 && headsUpAt > now)
      this.headsUpTimer = setTimeout(() => {
        if (this.value.endsAt === endsAt) this.options.headsUp(minutes);
      }, headsUpAt - now);
  }

  /** Tests: the running session ends now, as its timeout would (tests never wait 25 minutes). */
  endNow(): void {
    if (this.value.endsAt === null) return;
    this.value = { ...this.value, endsAt: this.options.now().getTime() };
    this.check();
  }

  /** On quit: no timer keeps the process up. */
  stop(): void {
    clearTimeout(this.endTimer);
    clearTimeout(this.headsUpTimer);
  }
}
