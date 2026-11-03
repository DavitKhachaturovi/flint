import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { TodayEntry, TodayExtras, TodayReminder } from '../../shared/ipc.js';
import { BellIcon, CheckIcon, ChevronIcon, CloseIcon, HashIcon } from './icons.js';

/**
 * The Today view's own parts (TODAY-01, TODAY-02, TODAY-03; M6, D-89, D-92; mockups 03 and 12):
 * the greeting with the day's progress, the rollover prompt, today's reminder cards, and the
 * column of Timeline, Done today and Captured today (beside Focus on wide screens, under it on
 * narrow ones). Its tasks (Focus) are the task list's rows. Everything that depends on the time
 * follows the clock as it runs (D-92): countdowns, the next reminder, the timeline's now line.
 */

const NUMBERS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** D-92: the time, ticking every `step` ms (on the step), for countdowns and the now line. */
export function useNow(step = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = (): void => {
      const at = new Date();
      setNow(at);
      timer = window.setTimeout(tick, step - (at.getTime() % step) + 5);
    };
    timer = window.setTimeout(tick, step - (Date.now() % step) + 5);
    return () => window.clearTimeout(timer);
  }, [step]);
  return now;
}

/** `YYYY-MM-DDTHH:MM` as a local time. */
function parseAt(at: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}

const minutesOf = (when: Date): number => when.getHours() * 60 + when.getMinutes();
const isComing = (reminder: TodayReminder, now: Date): boolean =>
  !reminder.done && (parseAt(reminder.at)?.getTime() ?? 0) > now.getTime();

/**
 * D-92: items that went away stay a moment, `leaving`, so they can animate out (at once under
 * reduce-motion); `gone` takes one away when its animation ends.
 */
function usePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): {
  readonly entries: readonly {
    readonly item: T;
    readonly key: string;
    readonly leaving: boolean;
  }[];
  readonly gone: (key: string) => void;
} {
  const [leaving, setLeaving] = useState<
    ReadonlyMap<string, { readonly item: T; readonly after: string | null }>
  >(new Map());
  const last = useRef(items);
  const keys = items.map(keyOf).join('\n');
  useLayoutEffect(() => {
    const before = last.current;
    last.current = items;
    if (reducedMotion()) return;
    const here = new Set(items.map(keyOf));
    const went = before.filter((item) => !here.has(keyOf(item)));
    if (went.length === 0) return;
    setLeaving((current) => {
      const next = new Map(current);
      for (const item of went) {
        const at = before.indexOf(item);
        const after = before
          .slice(0, at)
          .reverse()
          .find((other) => here.has(keyOf(other)));
        next.set(keyOf(item), { item, after: after ? keyOf(after) : null });
      }
      return next;
    });
    // The items' keys say whether anything changed; the array itself is new on every tick.
  }, [keys]);
  const gone = useCallback((key: string): void => {
    setLeaving((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  // A leaving item whose animation never ends (hidden, interrupted) still goes.
  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = window.setTimeout(() => setLeaving(new Map()), 800);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const present = new Set(items.map(keyOf));
  const waiting = [...leaving.entries()].filter(([key]) => !present.has(key));
  const entries: { item: T; key: string; leaving: boolean }[] = [];
  const place = (after: string | null): void => {
    for (const [key, each] of waiting)
      if (each.after === after) entries.push({ item: each.item, key, leaving: true });
  };
  place(null);
  for (const item of items) {
    const key = keyOf(item);
    entries.push({ item, key, leaving: false });
    place(key);
  }
  return { entries, gone };
}

/**
 * "Good afternoon. Five tasks are in focus." (09 §4, mockup 12: the count in white), the date and
 * the reminders left today, and D-92's progress line: "2 of 7 done" of today's pinned and
 * reminder tasks, filling as they are done.
 */
export function TodayGreeting(props: {
  readonly open: number;
  readonly reminders: readonly TodayReminder[];
  readonly progress: TodayExtras['progress'] | undefined;
}): ReactElement {
  const { open, reminders, progress } = props;
  const now = useNow(15_000);
  const hour = now.getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const count = NUMBERS[open] ?? String(open);
  const key = open === 0 ? 'Nothing' : open === 1 ? 'One task' : `${count} tasks`;
  const rest = open === 0 ? ' is in focus yet.' : open === 1 ? ' is in focus.' : ' are in focus.';
  const date = `${now.toLocaleDateString('en-GB', { weekday: 'long' })}, ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  const left = reminders.filter((reminder) => isComing(reminder, now)).length;
  const due = left === 0 ? '' : ` · ${left} ${left === 1 ? 'reminder' : 'reminders'} left today`;
  const total = progress?.total ?? 0;
  const done = Math.min(progress?.done ?? 0, total);
  return (
    <header className="today-header">
      <h1 className="today-greeting">
        Good {part}. <span className="today-key">{key}</span>
        {rest}
      </h1>
      <span className="today-date">
        {date}
        {due}
      </span>
      {total > 0 && (
        <div
          className="today-progress"
          role="progressbar"
          aria-label="Done today"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span className="today-progress-track">
            <span
              className="today-progress-fill"
              style={{ '--fill': done / total } as CSSProperties}
            />
          </span>
          <span className="today-progress-text">
            {done} of {total} done
          </span>
        </div>
      )}
    </header>
  );
}

/**
 * TODAY-02 (Q-04, D-89, D-92): "Unfinished from yesterday": Roll over keeps them pinned, Clear
 * unpins them, × is Roll over without a word. It stays, on every open that day, until one of them
 * is chosen, and folds away then (the answer is taken at once).
 */
export function RolloverCard(props: {
  readonly tasks: TodayExtras['rollover'];
  readonly onAnswer: (clear: boolean) => void;
}): ReactElement | null {
  const { tasks, onAnswer } = props;
  // Shown a moment longer while it folds away (03 §5).
  const [shown, setShown] = useState(tasks);
  const [leaving, setLeaving] = useState(false);
  // Under reduce-motion nothing animates: it goes at once.
  const leave = (): void => {
    if (reducedMotion()) setShown([]);
    else setLeaving(true);
  };
  useEffect(() => {
    if (tasks.length > 0) {
      setShown(tasks);
      setLeaving(false);
    } else leave();
  }, [tasks]);
  if (shown.length === 0) return null;
  const answer = (clear: boolean): void => {
    leave();
    onAnswer(clear);
  };
  return (
    <section
      className={leaving ? 'card rollover leaving' : 'card rollover'}
      aria-label="Unfinished from yesterday"
      inert={leaving}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) setShown([]);
      }}
    >
      <div className="rollover-head">
        <span className="rollover-title">Unfinished from yesterday</span>
        <button
          type="button"
          className="rollover-close"
          aria-label="Dismiss (keeps them pinned)"
          title="Keep them pinned"
          onClick={() => answer(false)}
        >
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="rollover-body">
        <ul className="rollover-tasks">
          {shown.map((task) => (
            <li key={task.key}>{task.title}</li>
          ))}
        </ul>
        <div className="rollover-actions">
          <button type="button" className="rollover-clear" onClick={() => answer(true)}>
            Clear
          </button>
          <button type="button" className="primary-button" onClick={() => answer(false)}>
            Roll over
          </button>
        </div>
      </div>
    </section>
  );
}

/** "in 2 h 30 min" ("in 2 h 30" when `short`), "in 5 min", "in 40 s", "now". */
function untilLabel(at: string, now: Date, short = false): string {
  const when = parseAt(at);
  if (!when) return '';
  const seconds = Math.ceil((when.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `in ${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `in ${rest} min`;
  if (rest === 0) return `in ${hours} h`;
  return short ? `in ${hours} h ${rest}` : `in ${hours} h ${rest} min`;
}

/** D-92: three cards a row; more come with "+N more". */
const CARDS = 3;

/**
 * TODAY-03 (D-89, D-92, mockup 12): the reminders still to come today. The next one is wider and
 * brighter (the strong bell tile, a larger time, "Next", a live countdown), the later ones
 * quieter; a card goes when its time comes, and the next one takes its place.
 */
export function ReminderCards(props: {
  readonly reminders: readonly TodayReminder[];
  readonly onOpen: (reminder: TodayReminder) => void;
}): ReactElement | null {
  const { reminders, onOpen } = props;
  const now = useNow(1000);
  const [more, setMore] = useState(false);
  const coming = reminders.filter((reminder) => isComing(reminder, now));
  const shown = more ? coming : coming.slice(0, CARDS);
  const { entries, gone } = usePresence(shown, (reminder) => reminder.key);
  if (entries.length === 0) return null;
  const next = coming[0]?.key;
  const columns = Math.max(1, Math.min(CARDS, shown.length));
  return (
    <div className="today-reminders-wrap">
      <div className="today-reminders" data-columns={columns}>
        {entries.map(({ item: reminder, key, leaving }) => {
          const first = key === next && !leaving;
          return (
            <button
              key={key}
              type="button"
              className={['card reminder-card', first ? 'next' : '', leaving ? 'leaving' : ''].join(
                ' ',
              )}
              inert={leaving}
              onClick={() => onOpen(reminder)}
              onAnimationEnd={(event) => {
                if (leaving && event.target === event.currentTarget) gone(key);
              }}
            >
              <span className="reminder-card-when">
                <span className={first ? 'tile strong' : 'tile'}>
                  <BellIcon size={14} />
                </span>
                <span className="reminder-card-time">{reminder.time}</span>
                {first && <span className="reminder-card-next">Next</span>}
              </span>
              <span className="reminder-card-title">{reminder.title}</span>
              <span className="reminder-card-foot">
                <span className="chip reminder-card-list">
                  <HashIcon size={11} />
                  {reminder.listName}
                </span>
                <span className="reminder-card-until">{untilLabel(reminder.at, now, !first)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {coming.length > CARDS && (
        <button type="button" className="reminder-more" onClick={() => setMore(!more)}>
          {more ? 'Show fewer' : `+${coming.length - CARDS} more`}
        </button>
      )}
    </div>
  );
}

/** D-92: a section's open or closed state, remembered on this machine. */
function useFold(id: string): [boolean, () => void] {
  const storage = `flint.today.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(storage) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = useCallback((): void => {
    setOpen((current) => {
      try {
        window.localStorage.setItem(storage, current ? 'closed' : 'open');
      } catch {
        // Not remembered, still toggled.
      }
      return !current;
    });
  }, [storage]);
  return [open, toggle];
}

/** One of the column's cards: a head (folding it, when it folds) and its rows. */
function Section(props: {
  readonly id: string;
  readonly label: string;
  readonly meta?: string;
  readonly folds: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const { id, label, meta, folds, children } = props;
  const [open, toggle] = useFold(id);
  const shown = !folds || open;
  return (
    <section className={`card today-section today-${id}`} aria-label={label}>
      {folds ? (
        <button type="button" className="today-section-head" aria-expanded={open} onClick={toggle}>
          <span className={open ? 'chev open' : 'chev'}>
            <ChevronIcon size={10} />
          </span>
          <span className="panel-label">{label}</span>
          {meta && <span className="panel-meta">{meta}</span>}
        </button>
      ) : (
        <div className="today-section-head">
          <span className="panel-label">{label}</span>
          {meta && <span className="panel-meta">{meta}</span>}
        </div>
      )}
      {/* D-77's fold: the rows stay rendered, the height eases open and closed. */}
      <div className={shown ? 'today-fold open' : 'today-fold'} inert={!shown}>
        <div className="today-fold-inner">{children}</div>
      </div>
    </section>
  );
}

/** An event's height and the least room between two. */
const EVENT = 26;
const EVENT_GAP = 3;
/** The least room between two hour labels, and the most the rail may take. */
const LABEL_GAP = 28;
const RAIL_MAX = 300;

/**
 * The hours the timeline covers (today's reminders and now, padded, on whole hours) and its scale:
 * close reminders get room enough not to overlap, a long day is kept within `RAIL_MAX`, and the
 * hour labels are every 1, 2 or 3 hours, whichever leaves them room.
 */
function railOf(times: readonly number[]): {
  start: number;
  end: number;
  step: number;
  scale: number;
} {
  const sorted = [...times].sort((a, b) => a - b);
  const first = sorted[0] ?? 0;
  const last = sorted.at(-1) ?? 0;
  const from = Math.max(0, Math.floor((first - 30) / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil((last + 30) / 60) * 60);
  let closest = Infinity;
  for (let at = 1; at < sorted.length; at++) {
    const gap = (sorted[at] ?? 0) - (sorted[at - 1] ?? 0);
    if (gap >= 10) closest = Math.min(closest, gap);
  }
  const roomy = Number.isFinite(closest) ? (EVENT + EVENT_GAP) / closest : 0;
  const scale = Math.min(Math.max(roomy, 0.25), RAIL_MAX / Math.max(60, to - from));
  const step = [60, 120, 180].find((each) => each * scale >= LABEL_GAP) ?? 180;
  return {
    start: Math.floor(from / step) * step,
    end: Math.min(24 * 60, Math.ceil(to / step) * step),
    step,
    scale,
  };
}
const two = (value: number): string => String(value).padStart(2, '0');

/**
 * D-92: today's reminders on a slim hour rail: past ones faded and struck through, the next one
 * highlighted, a white line at the current time that moves as the clock does.
 */
function Timeline(props: {
  readonly reminders: readonly TodayReminder[];
  readonly now: Date;
  readonly folds: boolean;
  readonly onOpen: (reminder: TodayReminder) => void;
}): ReactElement {
  const { reminders, now, folds, onOpen } = props;
  const nowAt = minutesOf(now);
  const times = reminders.map((reminder) => {
    const when = parseAt(reminder.at);
    return when ? minutesOf(when) : nowAt;
  });
  const { start, end, step, scale } = railOf([...times, nowAt]);
  const y = (minutes: number): number => (minutes - start) * scale;
  const next = reminders.find((reminder) => isComing(reminder, now))?.key;
  // Centred on their time, pushed down where they would overlap.
  let below = -Infinity;
  const tops = times.map((minutes) => {
    const top = Math.max(y(minutes) - EVENT / 2, below + EVENT_GAP);
    below = top + EVENT;
    return top;
  });
  const labels: number[] = [];
  for (let at = start; at <= end; at += step) labels.push(at);
  const height = Math.max(y(end), below) + EVENT / 2;
  return (
    <Section
      id="timeline"
      label="Timeline"
      meta={`${Math.floor(start / 60)}–${Math.floor(end / 60)}`}
      folds={folds}
    >
      <div className="timeline" style={{ height: `${height}px` }}>
        {labels.map((at) => (
          <div key={at} className="timeline-hour" style={{ top: `${y(at)}px` }}>
            <span className="timeline-hour-label">{`${two(Math.floor(at / 60))}:00`}</span>
            <span className="timeline-hour-line" />
          </div>
        ))}
        {reminders.map((reminder, index) => {
          const past = !isComing(reminder, now);
          const state = reminder.key === next ? 'next' : past ? 'past' : 'later';
          return (
            <button
              key={reminder.key}
              type="button"
              className={`timeline-event ${state}${reminder.done ? ' done' : ''}`}
              style={{ top: `${tops[index] ?? 0}px` }}
              title={`${reminder.time} · ${reminder.title} · ${reminder.listName}`}
              onClick={() => onOpen(reminder)}
            >
              <span className="timeline-dot" />
              <span className="timeline-text">
                {reminder.time} · {reminder.title}
              </span>
            </button>
          );
        })}
        <div
          className="timeline-now"
          style={{ top: `${y(nowAt + now.getSeconds() / 60)}px` }}
          aria-label={`Now, ${two(now.getHours())}:${two(now.getMinutes())}`}
        >
          <span className="timeline-now-line" />
          <span className="timeline-now-time">
            {two(now.getHours())}:{two(now.getMinutes())}
          </span>
        </div>
      </div>
    </Section>
  );
}

/** D-92: the rows of Done today and Captured today; new ones ease in, gone ones ease out. */
function Entries(props: {
  readonly entries: readonly TodayEntry[];
  readonly kind: 'done' | 'captured';
  readonly onOpen: (entry: TodayEntry) => void;
}): ReactElement {
  const { entries: items, kind, onOpen } = props;
  const { entries, gone } = usePresence(items, (entry) => entry.key);
  return (
    <div className="today-entries">
      {entries.map(({ item, key, leaving }) => (
        <button
          key={key}
          type="button"
          className={leaving ? 'today-entry leaving' : 'today-entry'}
          inert={leaving}
          onClick={() => onOpen(item)}
          onAnimationEnd={(event) => {
            if (leaving && event.target === event.currentTarget) gone(key);
          }}
        >
          {kind === 'done' && (
            <span className="today-entry-check">
              <CheckIcon size={10} />
            </span>
          )}
          <span className="today-entry-title">{item.title}</span>
          <span className="today-entry-meta">
            {kind === 'captured' ? `${item.listName} · ${item.time}` : item.time}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * D-92 (mockup 12): Today's column: Timeline, Done today and Captured today, each hidden while
 * empty. Beside Focus on wide screens (in the context panel's place, sticky as it is); stacked
 * under Focus on narrow windows, where the timeline folds too. Opening an entry opens its task.
 */
export function TodayColumn(props: {
  readonly extras: TodayExtras;
  readonly stacked: boolean;
  readonly onOpen: (key: string, listId: string) => void;
  readonly onSortInbox: () => void;
}): ReactElement | null {
  const { extras, stacked, onOpen, onSortInbox } = props;
  const now = useNow(1000);
  const sections: ReactElement[] = [];
  if (extras.reminders.length > 0)
    sections.push(
      <Timeline
        key="timeline"
        reminders={extras.reminders}
        now={now}
        folds={stacked}
        onOpen={(reminder) => onOpen(reminder.key, reminder.listId)}
      />,
    );
  if (extras.done.length > 0)
    sections.push(
      <Section key="done" id="done" label={`Done today · ${extras.done.length}`} folds>
        <Entries
          entries={extras.done}
          kind="done"
          onOpen={(entry) => onOpen(entry.key, entry.listId)}
        />
      </Section>,
    );
  if (extras.captured.length > 0)
    sections.push(
      <Section
        key="captured"
        id="captured"
        label={`Captured today · ${extras.captured.length}`}
        folds
      >
        <Entries
          entries={extras.captured}
          kind="captured"
          onOpen={(entry) => onOpen(entry.key, entry.listId)}
        />
        {extras.inbox.open > 0 && (
          <div className="today-sort-inbox">
            <button type="button" className="soft-button" onClick={onSortInbox}>
              Sort Inbox · {extras.inbox.open}
            </button>
          </div>
        )}
      </Section>,
    );
  if (sections.length === 0 && stacked) return null;
  return (
    <aside
      className={stacked ? 'today-column stacked' : 'today-column'}
      aria-label="Today at a glance"
    >
      {sections}
    </aside>
  );
}
