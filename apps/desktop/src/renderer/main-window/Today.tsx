import { useEffect, useState, type ReactElement } from 'react';
import type { TodayExtras, TodayReminder } from '../../shared/ipc.js';
import { BellIcon, CloseIcon, HashIcon } from './icons.js';

/**
 * The Today view's own parts (TODAY-01, TODAY-02, TODAY-03; M6, D-89; mockup 03): the greeting,
 * the rollover prompt and today's reminder cards. Its tasks (Focus) are the task list's rows.
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

/** "Good morning. Four tasks are in focus." (09 §4: the key phrase in white). */
export function TodayGreeting(props: {
  readonly open: number;
  readonly reminders: number;
}): ReactElement {
  const { open, reminders } = props;
  const now = new Date();
  const hour = now.getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const count = NUMBERS[open] ?? String(open);
  const lead = open === 0 ? 'Nothing is ' : open === 1 ? 'One task is ' : `${count} tasks are `;
  const date = `${now.toLocaleDateString('en-GB', { weekday: 'long' })}, ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  const due =
    reminders === 0 ? '' : ` · ${reminders} ${reminders === 1 ? 'reminder' : 'reminders'} today`;
  return (
    <header className="today-header">
      <h1 className="today-greeting">
        Good {part}. {lead}
        <span className="today-key">{open === 0 ? 'in focus yet.' : 'in focus.'}</span>
      </h1>
      <span className="today-date">
        {date}
        {due}
      </span>
    </header>
  );
}

/**
 * TODAY-02 (Q-04, D-89): "Unfinished from yesterday": Roll over keeps them pinned, Clear unpins
 * them, × is Roll over without a word. It folds away once answered (the answer is taken at once).
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setShown([]);
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
    </section>
  );
}

/** "in 2 h", "in 4 h 30 min", "in 5 min". */
function untilLabel(at: string, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!match) return '';
  const when = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const minutes = Math.max(1, Math.ceil((when.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `in ${rest} min`;
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`;
}

/** TODAY-03 (D-89): the reminders still to come today, two cards a row; the next one stands out. */
export function ReminderCards(props: {
  readonly reminders: readonly TodayReminder[];
  readonly onOpen: (reminder: TodayReminder) => void;
}): ReactElement | null {
  const { reminders, onOpen } = props;
  if (reminders.length === 0) return null;
  const now = new Date();
  return (
    <div className="today-reminders">
      {reminders.map((reminder, index) => (
        <button
          key={reminder.key}
          type="button"
          className="card reminder-card"
          onClick={() => onOpen(reminder)}
        >
          <span className="reminder-card-when">
            <span className={index === 0 ? 'tile strong' : 'tile'}>
              <BellIcon size={14} />
            </span>
            <span className="reminder-card-time">{reminder.time}</span>
            <span className="reminder-card-until">{untilLabel(reminder.at, now)}</span>
          </span>
          <span className="reminder-card-title">{reminder.title}</span>
          <span className="chip reminder-card-list">
            <HashIcon size={11} />
            {reminder.listName}
          </span>
        </button>
      ))}
    </div>
  );
}
