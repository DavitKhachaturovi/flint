import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { parseLocalDateTime } from '@flint/core/time';
import type {
  ChangeOutcome,
  ListChange,
  ListSummary,
  ListView,
  TaskRow,
} from '../../shared/ipc.js';
import { isTextField } from '../menu/menu.js';
import { openListPicker, openTimePicker } from '../pickers/pickers.js';
import { listInfos } from '../ui/Composer.js';
import { EditField, Title } from '../ui/Row.js';
import { reducedMotion } from '../ui/motion.js';
import { BodyBlock, type ShowImage } from './Body.js';
import { BackIcon, BellIcon, HashIcon, PinIcon } from './icons.js';

/**
 * TASK-14, D-113: Inbox triage. Inbox's open tasks one at a time, oldest first, each as one large
 * card (the task, its notes, when it was captured) with its actions and their keys below; "3 of
 * 18" and a progress line at the top. What takes the task out of Inbox goes to the next one at
 * once: M move (the list picker), Space done, Delete delete. Priority (3 / 2 / 1 / 0, as everywhere
 * in Flint), P pin and R reminder change the card in place. → or Enter keeps it in Inbox and goes
 * on, ← goes back, E edits the title, Ctrl+Z undoes the last action (its card comes back), Esc
 * leaves. New captures meanwhile join at the end. At the end, a short summary.
 */

type Outcome = 'moved' | 'done' | 'deleted' | 'kept';

interface Step {
  /** The card it was on. */
  readonly at: number;
  /** What it counted; null: a change on the card (priority, pin, reminder, title). */
  readonly outcome: Outcome | null;
}

/** Oldest first: when Flint first saw it; those it never saw, from the bottom of the file up. */
function oldestFirst(tasks: readonly TaskRow[]): string[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const ca = a.task.createdAt ?? '';
      const cb = b.task.createdAt ?? '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return b.index - a.index;
    })
    .map(({ task }) => task.key);
}

const openTasks = (view: ListView): TaskRow[] =>
  view.items.flatMap((item) => (item.kind === 'task' && !item.task.done ? [item.task] : []));

const PRIORITIES = [
  { key: '3', priority: 'high', name: 'High' },
  { key: '2', priority: 'medium', name: 'Medium' },
  { key: '1', priority: 'low', name: 'Low' },
  { key: '0', priority: null, name: 'None' },
] as const;

export function Triage(props: {
  readonly view: ListView;
  readonly lists: readonly ListSummary[];
  readonly change: (change: ListChange) => Promise<ChangeOutcome | null>;
  readonly undo: () => Promise<void>;
  readonly onImage: ShowImage;
  readonly onExit: () => void;
}): ReactElement {
  const { view, lists, change, undo, onImage, onExit } = props;
  const open = openTasks(view);
  const byKey = new Map(open.map((task) => [task.key, task]));
  // The queue, fixed when triage starts; captures that arrive join at the end.
  const [queue, setQueue] = useState<readonly string[]>(() => oldestFirst(open));
  useEffect(() => {
    const known = new Set(queue);
    const arrived = oldestFirst(open).filter((key) => !known.has(key));
    if (arrived.length > 0) setQueue((current) => [...current, ...arrived]);
  }, [view]);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<readonly Step[]>([]);
  const [editing, setEditing] = useState(false);
  const [direction, setDirection] = useState<'next' | 'back'>('next');
  // A card that left plays out over the next one coming in.
  const [leaving, setLeaving] = useState<{ task: TaskRow; direction: 'next' | 'back' } | null>(
    null,
  );

  // The card shown: the queue's task still in Inbox at that place; one gone meanwhile (moved, done,
  // deleted) is passed, going the way triage was going (back: to the one before it).
  const present = (place: number): boolean => byKey.has(queue[place] ?? '');
  let at = index;
  if (!present(at) && direction === 'back') {
    let before = at;
    while (before >= 0 && !present(before)) before--;
    if (before >= 0) at = before;
  }
  while (at < queue.length && !present(at)) at++;
  const task = at < queue.length ? (byKey.get(queue[at] ?? '') ?? null) : null;
  const total = queue.length;

  // The summary counts tasks, each by what happened to it last (kept twice after ← is one).
  const counts = useMemo(() => {
    const last = new Map<string, Outcome>();
    for (const step of steps) if (step.outcome) last.set(queue[step.at] ?? '', step.outcome);
    const result: Record<Outcome, number> = { moved: 0, done: 0, deleted: 0, kept: 0 };
    for (const outcome of last.values()) result[outcome]++;
    return result;
  }, [steps, queue]);

  const go = (to: number, how: 'next' | 'back'): void => {
    if (task && !reducedMotion()) setLeaving({ task, direction: how });
    setDirection(how);
    setEditing(false);
    setIndex(Math.max(0, to));
  };
  /** An action that takes the task out of Inbox (or keeps it): counted, then the next card. */
  const advance = (outcome: Outcome, made?: Promise<ChangeOutcome | null>): void => {
    setSteps((current) => [...current, { at, outcome }]);
    go(at + 1, 'next');
    void made;
  };
  const onCard = (made: Promise<ChangeOutcome | null>): void => {
    setSteps((current) => [...current, { at, outcome: null }]);
    void made;
  };

  // The pickers give the focus back here, so the keys reach triage again at once.
  const section = useRef<HTMLElement>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const reminderButton = useRef<HTMLButtonElement>(null);
  const actions = {
    move: (): void => {
      if (!task) return;
      const anchor = moveButton.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
      const key = task.key;
      openListPicker(
        {
          anchor,
          returnFocus: section.current,
          ...(moveButton.current && { trigger: moveButton.current }),
        },
        listInfos(lists),
        { exclude: view.id, placeholder: 'Move to…' },
        (pick) =>
          advance(
            'moved',
            change({
              kind: 'moveTo',
              key,
              to: 'newList' in pick ? { newList: pick.newList } : { list: pick.list.id },
            }),
          ),
      );
    },
    priority: (priority: TaskRow['priority']): void => {
      if (task) onCard(change({ kind: 'priority', key: task.key, priority }));
    },
    pin: (): void => {
      if (task) onCard(change({ kind: 'pin', key: task.key, pinned: task.pinned !== true }));
    },
    reminder: (): void => {
      if (!task) return;
      const anchor = reminderButton.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
      const key = task.key;
      const current = task.reminderAt ? (parseLocalDateTime(task.reminderAt)?.value ?? null) : null;
      openTimePicker(
        {
          anchor,
          returnFocus: section.current,
          ...(reminderButton.current && { trigger: reminderButton.current }),
        },
        new Date(),
        current,
        (when) => onCard(change({ kind: 'reminder', key, at: when })),
      );
    },
    done: (): void => {
      if (task) advance('done', change({ kind: 'complete', key: task.key, done: true }));
    },
    remove: (): void => {
      if (task) advance('deleted', change({ kind: 'delete', key: task.key }));
    },
    keep: (): void => {
      // At the summary, Enter (or →) is its Done.
      if (task) advance('kept');
      else onExit();
    },
    back: (): void => {
      if (at > 0) go(at - 1, 'back');
    },
    undo: (): void => {
      const last = steps.at(-1);
      void undo();
      if (!last) return;
      setSteps((current) => current.slice(0, -1));
      // The card it was on comes back (a moved, done or deleted task is in Inbox again).
      if (last.outcome) go(last.at, 'back');
    },
  };

  // The keys, while triage is open (App leaves them to it). Never while a field has the caret.
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (document.querySelector('.fl-picker, .fl-menu, .palette, .cheat-sheet')) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && !event.altKey && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        latest.current.undo();
        return;
      }
      if (isTextField(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
      const act = latest.current;
      const handled = ((): boolean => {
        if (key === 'escape') onExit();
        else if (key === 'm') act.move();
        else if (key === 'p') act.pin();
        else if (key === 'r') act.reminder();
        else if (key === 'e') setEditing(true);
        else if (event.key === ' ') act.done();
        else if (key === 'delete') act.remove();
        else if (key === 'arrowright' || key === 'enter') act.keep();
        else if (key === 'arrowleft') act.back();
        else {
          const priority = PRIORITIES.find((each) => each.key === event.key);
          if (!priority) return false;
          act.priority(priority.priority);
        }
        return true;
      })();
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const progress = total === 0 ? 1 : Math.min(at, total) / total;
  return (
    <section className="triage" aria-label="Inbox triage" ref={section} tabIndex={-1}>
      <header className="triage-head">
        <button
          type="button"
          className="tile triage-back"
          title="Back to Inbox (Esc)"
          aria-label="Back to Inbox"
          onClick={onExit}
        >
          <BackIcon />
        </button>
        <h1>
          Inbox <span className="triage-title-soft">· Triage</span>
        </h1>
        {task && (
          <span className="triage-count">
            {Math.min(at + 1, total)} of {total}
          </span>
        )}
      </header>
      <div className="triage-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="triage-stage">
        {leaving && (
          <TriageCard
            key={`leaving-${leaving.task.key}-${String(steps.length)}`}
            task={leaving.task}
            className={`triage-card leaving ${leaving.direction}`}
            onImage={onImage}
            onGone={() => setLeaving(null)}
          />
        )}
        {task ? (
          <TriageCard
            key={task.key}
            task={task}
            className={`triage-card arriving ${direction}`}
            onImage={onImage}
            editing={editing}
            onTitle={(text) => {
              setEditing(false);
              if (text.trim() !== '') onCard(change({ kind: 'edit', key: task.key, text }));
            }}
            onEdit={() => setEditing(true)}
          />
        ) : (
          <div className="card triage-summary">
            <h2>Inbox sorted</h2>
            <p className="triage-summary-counts">
              {counts.moved} moved · {counts.done} done · {counts.deleted} deleted · {counts.kept}{' '}
              kept
            </p>
            <button type="button" className="primary-button" autoFocus onClick={onExit}>
              Done
            </button>
          </div>
        )}
      </div>

      {task && (
        <div className="triage-actions" role="toolbar" aria-label="Triage actions">
          {/* What takes the task out of Inbox (or keeps it): the next card comes. */}
          <div className="triage-row">
            <button
              type="button"
              ref={moveButton}
              className="secondary-button"
              data-picker-trigger
              onClick={actions.move}
            >
              <HashIcon size={13} /> Move <span className="keycap">M</span>
            </button>
            <button type="button" className="secondary-button" onClick={actions.done}>
              Done <span className="keycap">Space</span>
            </button>
            <button type="button" className="secondary-button" onClick={actions.remove}>
              Delete <span className="keycap">Del</span>
            </button>
            <span className="triage-actions-space" />
            <button
              type="button"
              className="secondary-button"
              disabled={at === 0}
              onClick={actions.back}
            >
              <span className="keycap">←</span> Back
            </button>
            <button type="button" className="primary-button" onClick={actions.keep}>
              Keep in Inbox <span className="keycap">→</span>
            </button>
          </div>
          {/* What changes the card, which stays. */}
          <div className="triage-row">
            <span className="triage-priorities" role="group" aria-label="Priority">
              {PRIORITIES.map((each) => (
                <button
                  key={each.key}
                  type="button"
                  className={
                    task.priority === each.priority ? 'triage-priority on' : 'triage-priority'
                  }
                  title={`${each.name} priority (${each.key})`}
                  onClick={() => actions.priority(each.priority)}
                >
                  <span className={`triage-swatch p-${each.priority ?? 'none'}`} />
                  <span className="keycap">{each.key}</span>
                </button>
              ))}
            </span>
            <button
              type="button"
              className={task.pinned ? 'secondary-button on' : 'secondary-button'}
              onClick={actions.pin}
            >
              <PinIcon size={13} /> {task.pinned ? 'Pinned' : 'Pin'}{' '}
              <span className="keycap">P</span>
            </button>
            <button
              type="button"
              ref={reminderButton}
              className="secondary-button"
              data-picker-trigger
              onClick={actions.reminder}
            >
              <BellIcon size={13} /> Reminder <span className="keycap">R</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** One task as triage's card: its priority stripe, title, notes, when it was captured. */
function TriageCard(props: {
  readonly task: TaskRow;
  readonly className: string;
  readonly onImage: ShowImage;
  readonly editing?: boolean;
  readonly onTitle?: (text: string) => void;
  readonly onEdit?: () => void;
  readonly onGone?: () => void;
}): ReactElement {
  const { task, className, onImage, editing = false, onTitle, onEdit, onGone } = props;
  return (
    <article
      className={`card ${className}`}
      aria-hidden={onGone ? true : undefined}
      inert={onGone !== undefined}
      onAnimationEnd={(event) => {
        if (onGone && event.target === event.currentTarget) onGone();
      }}
    >
      <div className={`stripe p-${task.priority ?? 'none'}`} />
      <div className="triage-card-title">
        {editing && onTitle ? (
          <EditField
            initial={task.title}
            inert
            onLeave={(text, _empty, how) => onTitle(how === 'escape' ? task.title : text)}
            onTab={() => undefined}
          />
        ) : (
          <span className="triage-title" onClick={onEdit} title="Edit the title (E)">
            <Title task={task} />
          </span>
        )}
      </div>
      <div className="triage-meta">
        {task.created && <span>Captured {task.created}</span>}
        {task.pinned && (
          <span className="chip">
            <PinIcon size={11} /> Pinned
          </span>
        )}
        {task.reminder && (
          <span className="chip">
            <BellIcon size={11} /> {task.reminder}
          </span>
        )}
      </div>
      {task.body.trim() !== '' && (
        <div className="triage-body">
          <BodyBlock
            body={task.body}
            inline
            editing={false}
            editable={false}
            onImage={onImage}
            onEdit={() => undefined}
            onDone={() => undefined}
          />
        </div>
      )}
    </article>
  );
}
