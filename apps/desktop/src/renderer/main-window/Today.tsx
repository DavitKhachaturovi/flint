import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { TodayEntry, TodayExtras, TodayReminder } from '../../shared/ipc.js';
import { BellIcon, CheckIcon, ChevronIcon, CloseIcon, HashIcon } from './icons.js';
import { useScrollsWhenTaller } from '../ui/scrolls.js';
import { parseAt, untilLabel, useNow, usePresence } from '../ui/presence.js';
import { dayPart } from './greeting.js';
import { openMenu } from '../menu/menu.js';

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

const minutesOf = (when: Date): number => when.getHours() * 60 + when.getMinutes();
const isComing = (reminder: TodayReminder, now: Date): boolean =>
  !reminder.done && (parseAt(reminder.at)?.getTime() ?? 0) > now.getTime();

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
  const part = dayPart(hour);
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When an overdue reminder was: "14:00" today, "Yesterday 17:00", "Mon 2 Nov 09:30". */
function overdueWhen(at: string, now: Date): string {
  const when = parseAt(at);
  if (!when) return '';
  const clock = `${two(when.getHours())}:${two(when.getMinutes())}`;
  const day = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return clock;
  if (day === today - 86_400_000) return `Yesterday ${clock}`;
  const weekday = when.toLocaleDateString('en-GB', { weekday: 'short' });
  return `${weekday} ${when.getDate()} ${MONTHS[when.getMonth()] ?? ''} ${clock}`;
}

/**
 * REM-07, REM-11 (D-94): "Overdue · N": the open tasks whose reminder has passed (missed while
 * Flint was off or the PC slept, or simply not done yet), oldest first, under the rollover card;
 * quieter than it, folding, its open or closed state remembered. Each row: Done, Snooze ▸, and a
 * click opens the task; it leaves when its task is done or snoozed or its reminder turned off.
 * Today's reminders join it as their time passes. `called` (the missed-reminders toast's Open)
 * opens it and brings it into view, once it is there (`onCalled`).
 */
export function OverdueCard(props: {
  readonly overdue: readonly TodayReminder[];
  readonly reminders: readonly TodayReminder[];
  readonly called: boolean;
  readonly onCalled: () => void;
  readonly onOpen: (reminder: TodayReminder) => void;
  readonly onDone: (reminder: TodayReminder) => void;
  readonly onSnooze: (reminder: TodayReminder, anchor: DOMRect) => void;
}): ReactElement | null {
  const { overdue, reminders, called, onCalled, onOpen, onDone, onSnooze } = props;
  const now = useNow(1000);
  const [open, toggle, setOpen] = useFold('overdue');
  // Today's reminders become overdue as the clock passes them, before the list says so.
  const known = new Set(overdue.map((reminder) => reminder.key));
  const passed = reminders.filter(
    (reminder) => !reminder.done && !known.has(reminder.key) && !isComing(reminder, now),
  );
  const items = [...overdue, ...passed].sort((a, b) => a.at.localeCompare(b.at));
  const { entries, gone } = usePresence(items, (reminder) => reminder.key);
  const card = useRef<HTMLElement>(null);
  // Shown a moment longer while it folds away (03 §5), like the rollover card.
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(items.length > 0);
  useEffect(() => {
    if (items.length > 0) {
      setShown(true);
      setLeaving(false);
    } else if (shown) {
      if (reducedMotion()) setShown(false);
      else setLeaving(true);
    }
  }, [items.length > 0]);
  useEffect(() => {
    const element = card.current;
    if (!called || !element) return;
    onCalled();
    setOpen(true);
    element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    element.classList.remove('fl-flash');
    void element.offsetWidth;
    element.classList.add('fl-flash');
    window.setTimeout(() => element.classList.remove('fl-flash'), 900);
  }, [called, shown]);
  if (!shown) return null;
  return (
    <section
      ref={card}
      className={leaving ? 'card overdue leaving' : 'card overdue'}
      aria-label="Overdue reminders"
      inert={leaving}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) setShown(false);
      }}
    >
      <button type="button" className="overdue-head" aria-expanded={open} onClick={toggle}>
        <span className={open ? 'chev open' : 'chev'}>
          <ChevronIcon size={10} />
        </span>
        <span className="panel-label">Overdue · {items.length}</span>
      </button>
      <div className={open ? 'today-fold open' : 'today-fold'} inert={!open}>
        <div className="today-fold-inner">
          <div className="overdue-rows">
            {entries.map(({ item, key, leaving: going }) => (
              <div
                key={key}
                className={going ? 'overdue-row leaving' : 'overdue-row'}
                inert={going}
                onAnimationEnd={(event) => {
                  if (going && event.target === event.currentTarget) gone(key);
                }}
              >
                <button
                  type="button"
                  className="overdue-open"
                  title={`Open ${item.title}`}
                  onClick={() => onOpen(item)}
                >
                  <span className="overdue-bell">
                    <BellIcon size={12} />
                  </span>
                  <span className="overdue-title">{item.title}</span>
                  <span className="overdue-meta">
                    {item.listName} · {overdueWhen(item.at, now)}
                  </span>
                </button>
                <button type="button" className="overdue-action" onClick={() => onDone(item)}>
                  <CheckIcon size={10} />
                  Done
                </button>
                <button
                  type="button"
                  className="overdue-action"
                  data-picker-trigger
                  aria-haspopup="menu"
                  onClick={(event) => onSnooze(item, event.currentTarget.getBoundingClientRect())}
                >
                  Snooze
                  <ChevronIcon size={9} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
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
                <span className="chip reminder-card-list" title={reminder.listName}>
                  <HashIcon size={11} />
                  <span className="reminder-card-list-name">{reminder.listName}</span>
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
function useFold(id: string): [boolean, () => void, (open: boolean) => void] {
  const storage = `flint.today.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(storage) !== 'closed';
    } catch {
      return true;
    }
  });
  const set = useCallback(
    (next: boolean): void => {
      try {
        window.localStorage.setItem(storage, next ? 'open' : 'closed');
      } catch {
        // Not remembered, still changed.
      }
      setOpen(next);
    },
    [storage],
  );
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
  return [open, toggle, set];
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
/** D-163: the height of a row's "+N" badge. */
const MORE = 18;
/** The least room between two hour labels, and the most the rail may take. */
const LABEL_GAP = 28;
const RAIL_MAX = 300;
/**
 * D-167: the least scale, pixels a minute: reminders an hour apart always get rows of their own
 * (a long day grows past `RAIL_MAX` for it), so only reminders under an hour apart share one.
 */
const HOUR_SCALE = (EVENT + EVENT_GAP) / 60;
/** D-167: the now line's time pill: its width and half its height, for the "+N" beside it. */
const NOW_PILL = 44;
const NOW_PILL_HALF = 8;

/**
 * The hours the timeline covers (today's reminders and now, padded, on whole hours) and its scale:
 * close reminders get room enough not to overlap, a long day is kept within `RAIL_MAX` unless that
 * would put reminders an hour apart in one row (D-167), and the hour labels are every 1, 2 or 3
 * hours, whichever leaves them room.
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
  const scale = Math.max(Math.min(roomy, RAIL_MAX / Math.max(60, to - from)), HOUR_SCALE);
  const step = [60, 120, 180].find((each) => each * scale >= LABEL_GAP) ?? 180;
  return {
    start: Math.floor(from / step) * step,
    end: Math.min(24 * 60, Math.ceil(to / step) * step),
    step,
    scale,
  };
}
const two = (value: number): string => String(value).padStart(2, '0');

/** D-93: a dragged reminder snaps to quarter hours, to 5 minutes with Alt held. */
const SNAP = 15;
const FINE_SNAP = 5;
/** How far the pointer moves before a press on a reminder becomes a drag (else it's a click). */
const DRAG_START = 4;

type Rail = ReturnType<typeof railOf>;

/** A reminder being dragged on the timeline: where it started, and where it is now. */
interface TimelineDrag {
  readonly key: string;
  readonly pointer: number;
  readonly startY: number;
  readonly fromTop: number;
  readonly from: number;
  readonly rail: Rail;
  readonly moved: boolean;
  readonly top: number;
  readonly minutes: number;
}

/**
 * D-92: today's reminders on a slim hour rail: past ones faded and struck through, the next one
 * highlighted, a white line at the current time that moves as the clock does. D-93: a reminder
 * dragged up or down gets a new time (quarter hours, 5 minutes with Alt), shown as it moves; let
 * go, it slides into place, or back where it was when the time has passed.
 */
function Timeline(props: {
  readonly reminders: readonly TodayReminder[];
  readonly now: Date;
  readonly folds: boolean;
  readonly onOpen: (reminder: TodayReminder) => void;
  readonly onMove: (reminder: TodayReminder, minutes: number) => void;
}): ReactElement {
  const { reminders, now, folds, onOpen, onMove } = props;
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Dropped: shown at its new time until the list brings it (or a moment has passed).
  const [placed, setPlaced] = useState<{ readonly key: string; readonly minutes: number } | null>(
    null,
  );
  const dragged = useRef(false);
  const nowAt = minutesOf(now);
  const timeOf = (reminder: TodayReminder): number => {
    const when = parseAt(reminder.at);
    return when ? minutesOf(when) : nowAt;
  };
  useEffect(() => {
    if (!placed) return;
    const reminder = reminders.find((each) => each.key === placed.key);
    if (!reminder || timeOf(reminder) === placed.minutes) {
      setPlaced(null);
      return;
    }
    const timer = window.setTimeout(() => setPlaced(null), 2000);
    return () => window.clearTimeout(timer);
  }, [reminders, placed]);
  const times = reminders.map((reminder) =>
    placed?.key === reminder.key ? placed.minutes : timeOf(reminder),
  );
  // While dragging, the rail keeps its scale (it only grows downwards, for a later time).
  const rail: Rail = drag
    ? {
        ...drag.rail,
        end: Math.min(
          24 * 60,
          Math.max(drag.rail.end, Math.ceil((drag.minutes + 30) / drag.rail.step) * drag.rail.step),
        ),
      }
    : railOf([...times, nowAt]);
  const { start, end, step, scale } = rail;
  const y = (minutes: number): number => (minutes - start) * scale;
  const next = reminders.find((reminder) => isComing(reminder, now))?.key;
  // Centred on their time, in order of time, the dragged one aside (it follows the pointer, above
  // the others). D-163: reminders too close to show apart (under an hour, D-167) share one row at
  // the earliest's time, so no row drifts from its hour: the next one shows if it is among them
  // (else the earliest), with "+N" opening the others.
  const order = reminders
    .map((reminder, index) => ({ reminder, index, minutes: times[index] ?? nowAt }))
    .filter(({ reminder }) => reminder.key !== drag?.key || !drag.moved)
    .sort((a, b) => a.minutes - b.minutes);
  const rows: { top: number; members: (typeof order)[number][] }[] = [];
  for (const entry of order) {
    const last = rows.at(-1);
    // Half a pixel's grace: an hour at the least scale is exactly a row and its gap.
    if (last && y(entry.minutes) - EVENT / 2 - last.top < EVENT + EVENT_GAP - 0.5)
      last.members.push(entry);
    else rows.push({ top: y(entry.minutes) - EVENT / 2, members: [entry] });
  }
  const tops = new Map<string, number>();
  /** The row each shown reminder leads, by key, when it has others behind it. */
  const groups = new Map<string, (typeof order)[number][]>();
  const isPast = (minutes: number): boolean => minutes * 60 <= nowAt * 60 + now.getSeconds();
  // D-168: the now line never crosses a row (through the text it read as a strike-through, and
  // under the row it was hidden): where it would, it runs along the row's edge instead, above a
  // row still to come and below a passed one, so now stays in order with the reminders. Its pill
  // still says the time.
  let nowY = y(nowAt + now.getSeconds() / 60);
  for (const row of rows) {
    const lead = row.members.find(({ reminder }) => reminder.key === next) ?? row.members[0];
    if (!lead) continue;
    tops.set(lead.reminder.key, row.top);
    if (row.members.length > 1) groups.set(lead.reminder.key, row.members);
    if (nowY > row.top && nowY < row.top + EVENT)
      nowY = isPast(lead.minutes) ? row.top + EVENT + EVENT_GAP / 2 : row.top - EVENT_GAP / 2;
  }
  const below = (rows.at(-1)?.top ?? -Infinity) + EVENT;
  if (drag?.moved) tops.set(drag.key, drag.top);
  const labels: number[] = [];
  for (let at = start; at <= end; at += step) labels.push(at);
  const height = Math.max(y(end), below, drag?.moved ? drag.top + EVENT : 0) + EVENT / 2;
  const clock = (minutes: number): string =>
    `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
  /**
   * D-163, D-169: the reminders behind a row's shown one (as many as its "+N" says), each with its
   * own time; one opens it as a click would.
   */
  const showGroup = (members: (typeof order)[number][], shown: string, from: HTMLElement): void => {
    const box = from.getBoundingClientRect();
    openMenu(
      members
        .filter(({ reminder }) => reminder.key !== shown)
        .map(({ reminder, minutes }) => ({
          label: `${clock(minutes)} · ${reminder.title}`,
          hint: reminder.listName,
          action: () => onOpen(reminder),
        })),
      { x: box.left, y: box.bottom + 4 },
    );
  };
  const release = (cancelled: boolean): void => {
    const current = dragRef.current;
    setDrag(null);
    if (!current?.moved) return;
    dragged.current = true;
    const reminder = reminders.find((each) => each.key === current.key);
    // In the past, or where it was: it slides back.
    if (cancelled || !reminder || isPast(current.minutes) || current.minutes === current.from)
      return;
    setPlaced({ key: current.key, minutes: current.minutes });
    onMove(reminder, current.minutes);
  };
  // D-114: always there; with no reminders today, a quiet line instead of the rail.
  if (reminders.length === 0)
    return (
      <Section id="timeline" label="Timeline" folds={folds}>
        <p className="today-none">No reminders today.</p>
      </Section>
    );
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
          // D-163: one behind another in its row isn't drawn.
          if (!tops.has(reminder.key)) return null;
          const group = groups.get(reminder.key);
          const moving = drag?.key === reminder.key && drag.moved ? drag : null;
          const shownAt = placed?.key === reminder.key ? placed.minutes : null;
          const past = moving ? isPast(moving.minutes) : !isComing(reminder, now);
          // D-164: a passed reminder whose task isn't done is overdue, not struck through as done
          // (while dragged over the past it reads as past: dropped there, it slides back).
          const state =
            !moving && reminder.key === next
              ? 'next'
              : !moving && past && !reminder.done
                ? 'overdue'
                : past
                  ? 'past'
                  : 'later';
          return (
            <button
              key={reminder.key}
              type="button"
              className={[
                'timeline-event',
                state,
                reminder.done ? 'done' : '',
                moving ? 'dragging' : '',
                group && !moving ? 'grouped' : '',
              ].join(' ')}
              style={{ top: `${tops.get(reminder.key) ?? 0}px` }}
              title={`${reminder.time} · ${reminder.title} · ${reminder.listName}${reminder.done ? '' : ' (drag to change the time)'}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || reminder.done || drag) return;
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Not a live pointer (a synthetic event): it follows without capture.
                }
                const minutes = times[index] ?? nowAt;
                setDrag({
                  key: reminder.key,
                  pointer: event.pointerId,
                  startY: event.clientY,
                  fromTop: tops.get(reminder.key) ?? 0,
                  from: minutes,
                  rail,
                  moved: false,
                  top: tops.get(reminder.key) ?? 0,
                  minutes,
                });
              }}
              onPointerMove={(event) => {
                const current = dragRef.current;
                if (current?.key !== reminder.key || current.pointer !== event.pointerId) return;
                const dy = event.clientY - current.startY;
                if (!current.moved && Math.abs(dy) < DRAG_START) return;
                const snap = event.altKey ? FINE_SNAP : SNAP;
                const raw = current.from + dy / current.rail.scale;
                const minutes = Math.min(
                  24 * 60 - snap,
                  Math.max(current.rail.start, Math.round(raw / snap) * snap),
                );
                setDrag({
                  ...current,
                  moved: true,
                  top: Math.max(-EVENT / 2, current.fromTop + dy),
                  minutes,
                });
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointer === event.pointerId) release(false);
              }}
              onPointerCancel={(event) => {
                if (dragRef.current?.pointer === event.pointerId) release(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && dragRef.current) {
                  event.stopPropagation();
                  release(true);
                }
              }}
              onClick={() => {
                // A drag isn't a click.
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                onOpen(reminder);
              }}
            >
              <span className="timeline-dot" />
              <span className="timeline-text">
                {moving ? clock(moving.minutes) : shownAt !== null ? clock(shownAt) : reminder.time}{' '}
                · {reminder.title}
              </span>
            </button>
          );
        })}
        {[...groups].map(([key, members]) => {
          if (drag?.moved && drag.key === key) return null;
          const top = (tops.get(key) ?? 0) + (EVENT - MORE) / 2;
          // D-167: beside the now line's time pill, never under it.
          const besideNow = nowY + NOW_PILL_HALF > top && nowY - NOW_PILL_HALF < top + MORE;
          return (
            <button
              key={`more:${key}`}
              type="button"
              className={besideNow ? 'timeline-more beside-now' : 'timeline-more'}
              style={{
                top: `${top}px`,
                ...(besideNow && { right: `${NOW_PILL + 6}px` }),
              }}
              aria-label={`${members.length - 1} more at this time`}
              title={`${members.length - 1} more at this time`}
              onClick={(event) => showGroup(members, key, event.currentTarget)}
            >
              +{members.length - 1}
            </button>
          );
        })}
        <div
          className="timeline-now"
          style={{ top: `${nowY}px` }}
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
 * D-92 (mockup 12): Today's column: Timeline (always, D-114: a quiet line without reminders), Done today and
 * Captured today (always, D-93: "· 0" and a quiet line when empty). Beside Focus on wide screens
 * (in the context panel's place, sticky as it is); stacked under Focus on narrow windows, where
 * the timeline folds too. Opening an entry opens its task.
 */
export function TodayColumn(props: {
  readonly extras: TodayExtras;
  readonly stacked: boolean;
  readonly onOpen: (key: string, listId: string) => void;
  readonly onMoveReminder: (reminder: TodayReminder, minutes: number) => void;
  readonly onSortInbox: () => void;
}): ReactElement | null {
  const { extras, stacked, onOpen, onMoveReminder, onSortInbox } = props;
  const now = useNow(1000);
  const column = useRef<HTMLElement>(null);
  useScrollsWhenTaller(column);
  const sections: ReactElement[] = [];
  sections.push(
    <Timeline
      key="timeline"
      reminders={extras.reminders}
      now={now}
      folds={stacked}
      onOpen={(reminder) => onOpen(reminder.key, reminder.listId)}
      onMove={onMoveReminder}
    />,
  );
  sections.push(
    <Section key="done" id="done" label={`Done today · ${extras.done.length}`} folds>
      {extras.done.length === 0 && <p className="today-none">Nothing done yet today.</p>}
      <Entries
        entries={extras.done}
        kind="done"
        onOpen={(entry) => onOpen(entry.key, entry.listId)}
      />
    </Section>,
  );
  sections.push(
    <Section
      key="captured"
      id="captured"
      label={`Captured today · ${extras.captured.length}`}
      folds
    >
      {extras.captured.length === 0 && <p className="today-none">Nothing captured today.</p>}
      <Entries
        entries={extras.captured}
        kind="captured"
        onOpen={(entry) => onOpen(entry.key, entry.listId)}
      />
      {extras.inbox.open > 0 && (
        <div className="today-sort-inbox">
          {/* D-93: the column's one primary action. */}
          <button type="button" className="primary-button" onClick={onSortInbox}>
            Sort Inbox · {extras.inbox.open}
          </button>
        </div>
      )}
    </Section>,
  );
  return (
    <aside
      ref={column}
      className={stacked ? 'today-column stacked' : 'today-column'}
      aria-label="Today at a glance"
    >
      {sections}
    </aside>
  );
}
