/**
 * FOCUS-01 to FOCUS-06 (D-170, mockup 15): Focus's pieces, shared by the main window and mini
 * mode: the timer as main broadcasts it, the clock that redraws it, the timer card (inverted while
 * a focus session runs, Q3), the "1/4" count with its estimate stepper, the settings (the card
 * and Settings → Focus, one component), and the alarm.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  focusPlan,
  timeLeft,
  timerPaused,
  timerProgress,
  timerRunning,
  type FocusMode,
  type TimerState,
} from '@flint/core/focus';
import {
  ALARM_SOUND_NAMES,
  ALARM_SOUNDS,
  HEADS_UP_MINUTES,
  MAX_MINUTES,
  MODE_NAMES,
  type AlarmSound,
  type FocusCommand,
  type FocusEntry,
  type FocusSettings,
  type FocusTimerView,
} from '../../shared/focus.js';
import type { ListView } from '../../shared/ipc.js';
import { openMenu } from '../menu/menu.js';
import { ChevronIcon, CloseIcon, SkipIcon } from './icons.js';

const SOUND_URLS: Readonly<Record<Exclude<AlarmSound, 'none'>, string>> = {
  nudge: new URL('./sounds/chime.wav', import.meta.url).href,
  drop: new URL('./sounds/drop.wav', import.meta.url).href,
  mallet: new URL('./sounds/mallet.wav', import.meta.url).href,
};

/** FOCUS-04: the alarm, `repeat` times one after the other, at `volume` (0 to 100). */
export function playAlarm(sound: AlarmSound, volume: number, repeat: number): void {
  if (sound === 'none') return;
  let left = Math.max(1, repeat);
  const play = (): void => {
    const audio = new Audio(SOUND_URLS[sound]);
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    audio.addEventListener('ended', () => {
      left--;
      if (left > 0) window.setTimeout(play, 250);
    });
    void audio.play().catch(() => undefined);
  };
  play();
}

/** The timer as main has it, kept up to date (FOCUS-01: main owns it, the windows show it). */
export function useFocusTimer(): FocusTimerView | null {
  const [view, setView] = useState<FocusTimerView | null>(null);
  useEffect(() => {
    let live = true;
    void window.flintMain.focusTimer().then((first) => {
      if (live && first) setView((current) => current ?? first);
    });
    window.flintMain.onFocusTimer((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return view;
}

/** The clock, redrawn a few times a second while `running` (the digits come from the end time). */
export function useClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/** `25:00`, `4:05`; whole seconds, rounded up (a session never shows 0:00 before it ends). */
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const two = (value: number): string => String(value).padStart(2, '0');
const dayOf = (now: number): string => {
  const date = new Date(now);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

/** "#N": this focus session's number today (a new day starts at 1 before main has seen it). */
export function sessionNumber(state: TimerState, now: number): number {
  return state.day === dayOf(now) ? state.session : 1;
}

/** Whether the card inverts: a focus session runs (Q3). */
export const focusRunning = (state: TimerState): boolean =>
  state.mode === 'focus' && timerRunning(state);

const MODES: readonly FocusMode[] = ['focus', 'short', 'long'];

const send = (command: FocusCommand): void => window.flintMain.focusCommand(command);

/**
 * Shift+Space is the page's start / pause (FOCUS-01); on a focused timer button its key-up would
 * press the button as well, so the timer would toggle twice. Plain Space still presses it.
 */
const noShiftSpace = (event: {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}): void => {
  if (event.key === ' ' && event.shiftKey) event.preventDefault();
};

/** FOCUS-01 (mockup 15): the timer card: the mode tabs, the digits, Start / Pause and Skip. */
export function FocusTimerCard(props: { readonly view: FocusTimerView }): ReactElement {
  const { state } = props.view;
  const running = timerRunning(state);
  const now = useClock(running);
  const left = timeLeft(state, now);
  const go = running ? 'Pause' : timerPaused(state) ? 'Resume' : 'Start';
  const moving = running || timerPaused(state);
  return (
    <section
      className={focusRunning(state) ? 'card focus-timer inverted' : 'card focus-timer'}
      aria-label="Timer"
    >
      <div className="focus-modes" role="tablist" aria-label="Mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={state.mode === mode}
            className={state.mode === mode ? 'on' : undefined}
            onKeyUp={noShiftSpace}
            onClick={() => {
              if (state.mode !== mode) send({ kind: 'mode', mode });
            }}
          >
            {MODE_NAMES[mode]}
          </button>
        ))}
      </div>
      <div className="focus-digits" role="timer" aria-live="off">
        {clockText(left)}
      </div>
      <div className="focus-controls">
        {moving && <span className="focus-skip-room" aria-hidden="true" />}
        <button
          type="button"
          className="focus-go"
          title={`${go} (Shift+Space)`}
          onKeyUp={noShiftSpace}
          onClick={() => send({ kind: 'toggle' })}
        >
          {go}
        </button>
        {moving && (
          <button
            type="button"
            className="focus-skip"
            onKeyUp={noShiftSpace}
            title={state.mode === 'focus' ? 'Skip to the break (doesn’t count)' : 'Skip the break'}
            aria-label="Skip"
            onClick={() => send({ kind: 'skip' })}
          >
            <SkipIcon />
          </button>
        )}
      </div>
      <div className="focus-progress" aria-hidden="true">
        <i style={{ width: `${(timerProgress(state, now) * 100).toFixed(2)}%` }} />
      </div>
    </section>
  );
}

/** FOCUS-01: "#3" and the active task (or what the mode is for) under the card. */
export function FocusActiveLine(props: {
  readonly view: FocusTimerView;
  readonly title: string | null;
}): ReactElement {
  const { state } = props.view;
  const now = useClock(false);
  const text =
    state.mode !== 'focus'
      ? 'Time for a break!'
      : props.title !== null && props.title !== ''
        ? props.title
        : 'Time to focus!';
  return (
    <div className="focus-active">
      <span className="focus-hash">#{sessionNumber(state, now)}</span>
      <span className="focus-active-title">{text}</span>
    </div>
  );
}

/** FOCUS-03: "2 of 7 sessions · finish at 15:40" under the sprint. */
export function FocusPlanLine(props: {
  readonly view: FocusTimerView;
  readonly list: ListView;
}): ReactElement | null {
  const { state, settings } = props.view;
  const now = useClock(timerRunning(state));
  const entries = props.list.focus?.entries ?? {};
  const tasks = props.list.items.flatMap((item) => {
    if (item.kind !== 'task') return [];
    const entry = entries[item.task.key];
    return entry ? [{ ...entry, done: item.task.done }] : [];
  });
  if (tasks.length === 0) return null;
  const plan = focusPlan(tasks, state, settings, now);
  const at = plan.finishAt === null ? null : new Date(plan.finishAt);
  return (
    <p className="focus-plan">
      <span className="mono strong">
        {plan.done} of {plan.total}
      </span>{' '}
      sessions
      {at && (
        <>
          {' · finish at '}
          <span className="mono strong">
            {two(at.getHours())}:{two(at.getMinutes())}
          </span>
        </>
      )}
    </p>
  );
}

/**
 * FOCUS-03: a task's "1/4": its count against its estimate; on hover a − and + change the
 * estimate (also − and + on the selected row). The active task's is white.
 */
export function FocusCount(props: {
  readonly entry: FocusEntry;
  readonly active: boolean;
  readonly done: boolean;
  readonly onEstimate: (estimate: number) => void;
}): ReactElement {
  const { entry } = props;
  return (
    <span
      className={`focus-count${props.active ? ' active' : ''}${props.done ? ' done' : ''}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {!props.done && (
        <button
          type="button"
          className="focus-step"
          title="One session fewer (−)"
          aria-label="One session fewer"
          disabled={entry.estimate <= 1}
          onClick={() => props.onEstimate(entry.estimate - 1)}
        >
          −
        </button>
      )}
      <span className="focus-count-text" title="Sessions done of the estimate">
        {entry.count}/{entry.estimate}
      </span>
      {!props.done && (
        <button
          type="button"
          className="focus-step"
          title="One session more (+)"
          aria-label="One session more"
          onClick={() => props.onEstimate(entry.estimate + 1)}
        >
          +
        </button>
      )}
    </span>
  );
}

/** A whole number field for minutes and counts: saved on Enter or on leaving, kept in range. */
function NumberWell(props: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly narrow?: boolean;
}): ReactElement {
  const [text, setText] = useState(String(props.value));
  const last = useRef(props.value);
  if (last.current !== props.value) {
    last.current = props.value;
    setText(String(props.value));
  }
  const commit = (): void => {
    const value = Number.parseInt(text, 10);
    if (!Number.isFinite(value)) {
      setText(String(props.value));
      return;
    }
    const kept = Math.max(props.min, Math.min(props.max, value));
    setText(String(kept));
    if (kept !== props.value) props.onChange(kept);
  };
  return (
    <input
      className={props.narrow ? 'focus-well narrow' : 'focus-well'}
      inputMode="numeric"
      aria-label={props.label}
      value={text}
      spellCheck={false}
      onChange={(event) => setText(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          setText(String(props.value));
        }
      }}
    />
  );
}

function Toggle(props: {
  readonly on: boolean;
  readonly label: string;
  readonly onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      className={props.on ? 'switch on' : 'switch'}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** A choice as a button that opens Flint's menu (the alarm, the heads-up). */
function Dropdown<T extends string | number>(props: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly label: string;
  readonly onChange: (value: T) => void;
}): ReactElement {
  const current = props.options.find((option) => option.value === props.value);
  return (
    <button
      type="button"
      className="focus-select"
      aria-label={props.label}
      aria-haspopup="menu"
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        openMenu(
          props.options.map((option) => ({
            label: option.label,
            checked: option.value === props.value,
            action: () => props.onChange(option.value),
          })),
          { x: box.left, y: box.bottom + 4 },
        );
      }}
    >
      {current?.label ?? ''}
      <span className="focus-select-chev">
        <ChevronIcon size={11} />
      </span>
    </button>
  );
}

function SettingRow(props: {
  readonly name: string;
  readonly note?: string;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <div className="focus-setting">
      <div className="focus-setting-text">
        <span className="focus-setting-name">{props.name}</span>
        {props.note && <span className="focus-setting-note">{props.note}</span>}
      </div>
      {props.children}
    </div>
  );
}

/**
 * FOCUS-05 (Q8, mockup 15): the Focus settings in Pomofocus's order: Timer, Tasks, Sound,
 * Notification. The card on the Focus page and Settings → Focus show this one component.
 */
export function FocusSettingsForm(props: { readonly settings: FocusSettings }): ReactElement {
  const { settings } = props;
  const set = (changes: Partial<FocusSettings>): void =>
    void window.flintMain.setFocusSettings(changes);
  return (
    <div className="focus-settings">
      <div className="focus-settings-section">
        <span className="panel-label">Timer · minutes</span>
        <div className="focus-minutes">
          {(
            [
              ['focusMinutes', 'Focus'],
              ['shortMinutes', 'Short break'],
              ['longMinutes', 'Long break'],
            ] as const
          ).map(([key, name]) => (
            <label key={key} className="focus-minute">
              <span>{name}</span>
              <NumberWell
                value={settings[key]}
                min={1}
                max={MAX_MINUTES}
                label={`${name} minutes`}
                onChange={(value) => set({ [key]: value })}
              />
            </label>
          ))}
        </div>
        <SettingRow name="Auto start breaks">
          <Toggle
            on={settings.autoStartBreaks}
            label="Auto start breaks"
            onChange={(on) => set({ autoStartBreaks: on })}
          />
        </SettingRow>
        <SettingRow name="Auto start focus">
          <Toggle
            on={settings.autoStartFocus}
            label="Auto start focus"
            onChange={(on) => set({ autoStartFocus: on })}
          />
        </SettingRow>
        <SettingRow name="Long break interval" note="A long break after this many focus sessions.">
          <NumberWell
            narrow
            value={settings.longEvery}
            min={1}
            max={12}
            label="Long break interval"
            onChange={(value) => set({ longEvery: value })}
          />
        </SettingRow>
      </div>
      <div className="focus-settings-section">
        <span className="panel-label">Tasks</span>
        <SettingRow
          name="Auto check tasks"
          note="Complete the active task when its sessions reach the estimate."
        >
          <Toggle
            on={settings.autoCheck}
            label="Auto check tasks"
            onChange={(on) => set({ autoCheck: on })}
          />
        </SettingRow>
        <SettingRow name="Check to bottom" note="Done tasks move below the open ones.">
          <Toggle
            on={settings.checkToBottom}
            label="Check to bottom"
            onChange={(on) => set({ checkToBottom: on })}
          />
        </SettingRow>
      </div>
      <div className="focus-settings-section">
        <span className="panel-label">Sound</span>
        <SettingRow name="Alarm sound">
          <span className="focus-setting-pair">
            <Dropdown
              value={settings.sound}
              label="Alarm sound"
              options={ALARM_SOUNDS.map((sound) => ({
                value: sound,
                label: ALARM_SOUND_NAMES[sound],
              }))}
              onChange={(sound) => set({ sound })}
            />
            <button
              type="button"
              className="quiet-button focus-play"
              disabled={settings.sound === 'none'}
              onClick={() => window.flintMain.playAlarm(settings.sound, settings.volume)}
            >
              Play
            </button>
          </span>
        </SettingRow>
        <SettingRow name="Volume">
          <span className="focus-volume">
            <span className="mono">{settings.volume}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label="Volume"
              value={settings.volume}
              style={{ ['--fill' as string]: `${settings.volume}%` }}
              onChange={(event) => set({ volume: Number(event.target.value) })}
            />
          </span>
        </SettingRow>
        <SettingRow name="Repeat">
          <NumberWell
            narrow
            value={settings.repeat}
            min={1}
            max={5}
            label="Repeat"
            onChange={(value) => set({ repeat: value })}
          />
        </SettingRow>
      </div>
      <div className="focus-settings-section">
        <span className="panel-label">Notification</span>
        <SettingRow name="Notify when a session ends">
          <Toggle
            on={settings.notifyEnd}
            label="Notify when a session ends"
            onChange={(on) => set({ notifyEnd: on })}
          />
        </SettingRow>
        <SettingRow
          name="Heads-up before the end"
          note="A quiet notification this long before a focus session ends."
        >
          <Dropdown
            value={settings.headsUpMinutes}
            label="Heads-up before the end"
            options={HEADS_UP_MINUTES.map((minutes) => ({
              value: minutes,
              label: minutes === 0 ? 'Off' : `${minutes} min`,
            }))}
            onChange={(minutes) => set({ headsUpMinutes: minutes })}
          />
        </SettingRow>
      </div>
    </div>
  );
}

/** FOCUS-05 (mockup 15): the gear's card over the Focus page; Esc, × or OK close it. */
export function FocusSettingsCard(props: {
  readonly view: FocusTimerView;
  readonly leaving: boolean;
  readonly onClose: () => void;
  readonly onGone: () => void;
}): ReactElement {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props.onClose]);
  return (
    <div
      className={props.leaving ? 'focus-settings-scrim leaving' : 'focus-settings-scrim'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onAnimationEnd={(event) => {
        if (props.leaving && event.target === event.currentTarget) props.onGone();
      }}
    >
      <div className="focus-settings-card" role="dialog" aria-label="Focus settings" ref={card}>
        <header className="focus-settings-head">
          <span>Focus settings</span>
          <button
            type="button"
            className="focus-settings-close"
            aria-label="Close"
            title="Close (Esc)"
            onClick={props.onClose}
          >
            <CloseIcon size={12} />
          </button>
        </header>
        <div className="focus-settings-body">
          <FocusSettingsForm settings={props.view.settings} />
        </div>
        <footer className="focus-settings-foot">
          <span>Also in Settings → Focus</span>
          <button type="button" className="primary-button" onClick={props.onClose}>
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * FOCUS-06 (mockup 15): mini's compact timer: the mode, the digits (white while focus runs,
 * the accent in a break, never inverted), Start / Pause and Skip, the active task, the line.
 */
export function MiniFocusCard(props: {
  readonly view: FocusTimerView;
  readonly title: string | null;
}): ReactElement {
  const { state } = props.view;
  const running = timerRunning(state);
  const now = useClock(running);
  const moving = running || timerPaused(state);
  const go = running ? 'Pause' : timerPaused(state) ? 'Resume' : 'Start';
  const tone = state.mode === 'focus' ? 'focus' : 'break';
  return (
    <section className={`mini-focus ${tone}`} aria-label="Timer">
      <div className="mini-focus-top">
        <div className="mini-focus-modes" role="tablist" aria-label="Mode">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={state.mode === mode}
              className={state.mode === mode ? 'on' : undefined}
              onKeyUp={noShiftSpace}
              onClick={() => {
                if (state.mode !== mode) send({ kind: 'mode', mode });
              }}
            >
              {MODE_NAMES[mode]}
            </button>
          ))}
        </div>
        <span className="mini-focus-hash">#{sessionNumber(state, now)}</span>
      </div>
      <div className="mini-focus-main">
        <span className="mini-focus-digits" role="timer">
          {clockText(timeLeft(state, now))}
        </span>
        <span className="mini-focus-buttons">
          <button
            type="button"
            className="mini-focus-go"
            onKeyUp={noShiftSpace}
            title={`${go} (Shift+Space)`}
            onClick={() => send({ kind: 'toggle' })}
          >
            {go}
          </button>
          {moving && (
            <button
              type="button"
              className="mini-focus-skip"
              onKeyUp={noShiftSpace}
              aria-label="Skip"
              title="Skip"
              onClick={() => send({ kind: 'skip' })}
            >
              <SkipIcon size={13} />
            </button>
          )}
        </span>
      </div>
      <div className="mini-focus-title">
        {state.mode !== 'focus'
          ? 'Time for a break!'
          : props.title !== null && props.title !== ''
            ? props.title
            : 'Time to focus!'}
      </div>
      <div className="mini-focus-progress" aria-hidden="true">
        <i style={{ width: `${(timerProgress(state, now) * 100).toFixed(2)}%` }} />
      </div>
    </section>
  );
}
