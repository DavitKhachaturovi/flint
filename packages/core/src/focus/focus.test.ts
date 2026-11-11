import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMER_SETTINGS,
  EMPTY_SPRINT,
  LATE_MS,
  MAX_ESTIMATE,
  addToSprint,
  countSession,
  finishSession,
  focusPlan,
  initialTimer,
  inSprint,
  moveToTop,
  orderSprint,
  parseSprint,
  parseTimerState,
  pauseTimer,
  pruneSprint,
  removeFromSprint,
  resetCounts,
  serializeSprint,
  serializeTimerState,
  setEstimate,
  skipSession,
  startTimer,
  switchTimerMode,
  timeLeft,
  timerForDay,
  timerPaused,
  timerProgress,
  timerReady,
  timerWithSettings,
  toggleTimer,
  type TimerSettings,
} from './index.js';

const MIN = 60_000;
const settings = DEFAULT_TIMER_SETTINGS;
const DAY = '2026-03-10';
const T0 = Date.UTC(2026, 2, 10, 10, 0);

describe('FOCUS-02: the sprint file (.flint/focus.json, docs/04)', () => {
  it('round-trips, unknown keys kept and written first', () => {
    const text = serializeSprint({
      tasks: [
        { id: 'k3f9', estimate: 3, count: 2 },
        { id: 'q8x2ab', estimate: 1, count: 0 },
      ],
      extra: { later: { a: 1 } },
    });
    expect(text).toBe(
      '{\n  "later": {\n    "a": 1\n  },\n  "flint": 1,\n  "tasks": [\n    {\n      "id": "k3f9",\n      "estimate": 3,\n      "count": 2\n    },\n    {\n      "id": "q8x2ab",\n      "estimate": 1,\n      "count": 0\n    }\n  ]\n}\n',
    );
    expect(serializeSprint(parseSprint(text))).toBe(text);
  });

  it('reads anything broken as an empty sprint', () => {
    for (const text of ['', 'nope', '[]', 'null', '42', '{"tasks": 3}'])
      expect(parseSprint(text).tasks).toEqual([]);
  });

  it('skips bad entries and repeated IDs, clamps numbers', () => {
    const sprint = parseSprint(
      JSON.stringify({
        tasks: [
          { id: 'a1', estimate: 0, count: -2 },
          { id: 'a1', estimate: 5 },
          { id: 'bad id!' },
          null,
          'x',
          { id: 'b2', estimate: 500, count: 2.6 },
          { id: 'c3', estimate: 'two' },
        ],
      }),
    );
    expect(sprint.tasks).toEqual([
      { id: 'a1', estimate: 1, count: 0 },
      { id: 'b2', estimate: MAX_ESTIMATE, count: 3 },
      { id: 'c3', estimate: 1, count: 0 },
    ]);
  });

  it('adds at the end, once, estimate 1', () => {
    let sprint = addToSprint(EMPTY_SPRINT, ['a1', 'b2', 'a1']);
    sprint = addToSprint(sprint, ['b2', 'c3']);
    expect(sprint.tasks.map((task) => task.id)).toEqual(['a1', 'b2', 'c3']);
    expect(sprint.tasks[2]).toEqual({ id: 'c3', estimate: 1, count: 0 });
    expect(addToSprint(sprint, ['a1'])).toBe(sprint);
    expect(inSprint(sprint, 'b2')).toBe(true);
  });

  it('removes, prunes, orders and moves to the top', () => {
    const sprint = addToSprint(EMPTY_SPRINT, ['a1', 'b2', 'c3', 'd4']);
    expect(removeFromSprint(sprint, ['b2', 'zz']).tasks.map((task) => task.id)).toEqual([
      'a1',
      'c3',
      'd4',
    ]);
    expect(removeFromSprint(sprint, ['zz'])).toBe(sprint);
    expect(pruneSprint(sprint, (id) => id !== 'c3').tasks.map((task) => task.id)).toEqual([
      'a1',
      'b2',
      'd4',
    ]);
    expect(orderSprint(sprint, ['c3', 'a1']).tasks.map((task) => task.id)).toEqual([
      'c3',
      'a1',
      'b2',
      'd4',
    ]);
    expect(moveToTop(sprint, 'd4').tasks.map((task) => task.id)).toEqual(['d4', 'a1', 'b2', 'c3']);
    expect(moveToTop(sprint, 'a1')).toBe(sprint);
  });

  it('keeps estimates within 1 and the maximum; counts and resets', () => {
    let sprint = addToSprint(EMPTY_SPRINT, ['a1', 'b2']);
    sprint = setEstimate(sprint, 'a1', 4);
    sprint = setEstimate(sprint, 'b2', 0);
    expect(sprint.tasks.map((task) => task.estimate)).toEqual([4, 1]);
    expect(setEstimate(sprint, 'a1', 1000).tasks[0]?.estimate).toBe(MAX_ESTIMATE);
    sprint = countSession(countSession(sprint, 'a1'), 'a1');
    expect(sprint.tasks[0]?.count).toBe(2);
    expect(countSession(sprint, 'zz')).toBe(sprint);
    sprint = resetCounts(sprint);
    expect(sprint.tasks.map((task) => task.count)).toEqual([0, 0]);
    expect(resetCounts(sprint)).toBe(sprint);
  });
});

describe('FOCUS-01: the timer (the end time, never ticks)', () => {
  it('starts with a focus session of the set length, ready', () => {
    const state = initialTimer(settings, DAY);
    expect(state).toMatchObject({ mode: 'focus', endsAt: null, left: 25 * MIN, session: 1 });
    expect(timerReady(state)).toBe(true);
    expect(timeLeft(state, T0)).toBe(25 * MIN);
  });

  it('runs from its end time, pauses and resumes where it was', () => {
    const running = startTimer(initialTimer(settings, DAY), T0);
    expect(running.endsAt).toBe(T0 + 25 * MIN);
    expect(timeLeft(running, T0 + 6 * MIN)).toBe(19 * MIN);
    expect(timerProgress(running, T0 + 5 * MIN)).toBeCloseTo(0.2);
    const paused = pauseTimer(running, T0 + 6 * MIN);
    expect(timerPaused(paused)).toBe(true);
    expect(timeLeft(paused, T0 + 60 * MIN)).toBe(19 * MIN);
    const resumed = toggleTimer(paused, T0 + 60 * MIN);
    expect(resumed.endsAt).toBe(T0 + 79 * MIN);
    expect(timeLeft(resumed, T0 + 200 * MIN)).toBe(0);
  });

  it('a mode tab switches and stops; a new day starts "#N" again', () => {
    const running = startTimer(initialTimer(settings, DAY), T0);
    const short = switchTimerMode(running, 'short', settings);
    expect(short).toMatchObject({ mode: 'short', endsAt: null, left: 5 * MIN, length: 5 * MIN });
    const later = { ...short, session: 4, finished: 3 };
    expect(timerForDay(later, DAY)).toBe(later);
    expect(timerForDay(later, '2026-03-11')).toMatchObject({ session: 1, finished: 0 });
  });

  it('a ready mode takes new lengths; a started one keeps its time', () => {
    const shorter: TimerSettings = { ...settings, focusMinutes: 50 };
    expect(timerWithSettings(initialTimer(settings, DAY), shorter).left).toBe(50 * MIN);
    const paused = pauseTimer(startTimer(initialTimer(settings, DAY), T0), T0 + MIN);
    expect(timerWithSettings(paused, shorter)).toBe(paused);
  });
});

describe('FOCUS-04: a session ends', () => {
  const run = (state = initialTimer(settings, DAY)) => startTimer(state, T0);

  it('a focus session counts, moves "#N" on and waits in a short break', () => {
    const state = run();
    expect(finishSession(state, settings, T0 + 24 * MIN)).toBeNull();
    const done = finishSession(state, settings, T0 + 25 * MIN);
    expect(done).toMatchObject({ ended: 'focus', counted: true, quiet: false });
    expect(done?.state).toMatchObject({ mode: 'short', endsAt: null, session: 2, finished: 1 });
  });

  it('a long break after every 4th, and the break back to focus', () => {
    const state = run({ ...initialTimer(settings, DAY), session: 4, finished: 3 });
    const done = finishSession(state, settings, T0 + 25 * MIN);
    expect(done?.state).toMatchObject({ mode: 'long', left: 15 * MIN, finished: 4 });
    const brk = startTimer(done!.state, T0 + 30 * MIN);
    const back = finishSession(brk, settings, T0 + 45 * MIN);
    expect(back).toMatchObject({ ended: 'long', counted: false });
    expect(back?.state).toMatchObject({ mode: 'focus', endsAt: null, left: 25 * MIN });
  });

  it('auto start starts the next mode from now', () => {
    const auto = { ...settings, autoStartBreaks: true, autoStartFocus: true };
    const done = finishSession(run(), auto, T0 + 25 * MIN);
    expect(done?.state.endsAt).toBe(T0 + 30 * MIN);
    const back = finishSession(done!.state, auto, T0 + 30 * MIN);
    expect(back?.state.endsAt).toBe(T0 + 55 * MIN);
  });

  it('one ended long ago (Flint closed, asleep) is quiet: nothing counts, nothing starts', () => {
    const auto = { ...settings, autoStartBreaks: true };
    const done = finishSession(run(), auto, T0 + 25 * MIN + LATE_MS + 1);
    expect(done).toMatchObject({ counted: false, quiet: true });
    expect(done?.state).toMatchObject({ mode: 'short', endsAt: null, session: 1, finished: 0 });
  });

  it('Skip moves on without counting', () => {
    const skipped = skipSession(run({ ...initialTimer(settings, DAY), finished: 3 }), settings, T0);
    expect(skipped).toMatchObject({ mode: 'short', endsAt: null, session: 1, finished: 3 });
    expect(skipSession(skipped, settings, T0)).toMatchObject({ mode: 'focus', endsAt: null });
  });
});

describe('FOCUS-03: "2 of 7 sessions · finish at 15:40"', () => {
  it('sums counts and estimates; the finish from now with breaks between', () => {
    const ready = initialTimer(settings, DAY);
    const result = focusPlan(
      [
        { estimate: 3, count: 1, done: false },
        { estimate: 1, count: 0, done: false },
        { estimate: 1, count: 1, done: true },
      ],
      ready,
      settings,
      T0,
    );
    expect(result).toMatchObject({ done: 2, total: 5 });
    // Three sessions to go: 25 + 5 + 25 + 5 + 25.
    expect(result.finishAt).toBe(T0 + 85 * MIN);
  });

  it('the session under way counts as the first; a long break where it falls', () => {
    const running = startTimer({ ...initialTimer(settings, DAY), finished: 2, session: 3 }, T0);
    const result = focusPlan(
      [{ estimate: 3, count: 0, done: false }],
      running,
      settings,
      T0 + 10 * MIN,
    );
    // 15 left, a long break (the 4th), then 25, a short break, 25.
    expect(result.finishAt).toBe(T0 + 10 * MIN + (15 + 15 + 25 + 5 + 25) * MIN);
  });

  it('no open sessions: no finish', () => {
    const result = focusPlan(
      [{ estimate: 1, count: 1, done: false }],
      initialTimer(settings, DAY),
      settings,
      T0,
    );
    expect(result).toEqual({ done: 1, total: 1, finishAt: null });
  });
});

describe('FOCUS-01: focus-state.json', () => {
  it('round-trips', () => {
    const state = startTimer({ ...initialTimer(settings, DAY), session: 3, finished: 2 }, T0);
    expect(parseTimerState(serializeTimerState(state), settings, DAY)).toEqual(state);
  });

  it('a missing or broken file is a fresh timer; another day starts "#N" again', () => {
    expect(parseTimerState('', settings, DAY)).toEqual(initialTimer(settings, DAY));
    expect(parseTimerState('{"mode":"nap"}', settings, DAY)).toEqual(initialTimer(settings, DAY));
    const old = serializeTimerState({ ...initialTimer(settings, '2026-03-09'), session: 5 });
    expect(parseTimerState(old, settings, DAY)).toMatchObject({ day: DAY, session: 1 });
  });
});
