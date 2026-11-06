import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
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
import { MorphText, Title } from '../ui/Row.js';
import { durationMs, reducedMotion } from '../ui/motion.js';
import { BodyBlock, type ShowImage } from './Body.js';
import { BackIcon, BellIcon, HashIcon, PinIcon } from './icons.js';
import { useInertText } from './inert-text.js';

/**
 * TASK-14, D-113: Inbox triage. Inbox's open tasks one at a time, oldest first, each as one large
 * card (the task, its notes, when it was captured) with its actions and their keys below; "3 of
 * 18" and a progress line at the top. What takes the task out of Inbox goes to the next one at
 * once: M move (the list picker), Space done, Delete delete. Priority (3 / 2 / 1 / 0, as everywhere
 * in Flint), P pin and R reminder change the card in place. → or Enter keeps it in Inbox and goes
 * on, ← goes back, E edits the title, Ctrl+Z undoes the last action (its card comes back), Esc
 * leaves. New captures meanwhile join at the end. At the end, a short summary.
 *
 * D-114: the place is kept for the session (left on task 7, it opens on task 7 again) until the
 * summary is reached and left, or Start over; the card's height eases between tasks; the progress
 * line jumps to a task; a click on the notes shows the whole task (the side panel, or the card).
 */

type Outcome = 'moved' | 'done' | 'deleted' | 'kept';

interface Step {
  /** The card it was on. */
  readonly at: number;
  /** What it counted; null: a change on the card (priority, pin, reminder, title). */
  readonly outcome: Outcome | null;
}

/** D-114: where triage was, kept by App for the session. */
export interface TriageMemory {
  readonly queue: readonly string[];
  readonly at: number;
  readonly steps: readonly Step[];
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

const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

export function Triage(props: {
  readonly view: ListView;
  readonly lists: readonly ListSummary[];
  readonly change: (change: ListChange) => Promise<ChangeOutcome | null>;
  readonly undo: () => Promise<void>;
  readonly onImage: ShowImage;
  readonly onExit: () => void;
  /** D-114: the place kept for the session (App's). */
  readonly memory: MutableRefObject<TriageMemory | null>;
  /** D-114: where the whole task shows on a click on its notes: the side panel or the card. */
  readonly details: 'panel' | 'card';
  /** D-114: the task the side panel shows (null: none). */
  readonly onDetails: (key: string | null) => void;
}): ReactElement {
  const { view, lists, change, undo, onImage, onExit, memory, details, onDetails } = props;
  const open = openTasks(view);
  const byKey = new Map(open.map((task) => [task.key, task]));
  const kept = useRef(memory.current);
  // The queue, fixed when triage starts; captures that arrive join at the end.
  const [queue, setQueue] = useState<readonly string[]>(
    () => kept.current?.queue ?? oldestFirst(open),
  );
  useEffect(() => {
    const known = new Set(queue);
    const arrived = oldestFirst(open).filter((key) => !known.has(key));
    if (arrived.length > 0) setQueue((current) => [...current, ...arrived]);
  }, [view, queue]);
  const [index, setIndex] = useState(() => kept.current?.at ?? 0);
  const [steps, setSteps] = useState<readonly Step[]>(() => kept.current?.steps ?? []);
  const [editing, setEditing] = useState(false);
  const [direction, setDirection] = useState<'next' | 'back'>('next');
  // A card that left plays out over the next one coming in.
  const [leaving, setLeaving] = useState<{ task: TaskRow; direction: 'next' | 'back' } | null>(
    null,
  );
  // D-114: the whole task: the side panel follows the card while it is open; on a narrow window,
  // the card's notes unfold.
  const [showing, setShowing] = useState(false);

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

  // D-114: kept for the session; reaching the summary and leaving it starts the next one afresh.
  useEffect(() => {
    memory.current = { queue, at, steps };
  }, [memory, queue, at, steps]);
  const leave = (): void => {
    if (!task) memory.current = null;
    onExit();
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  const panelKey = details === 'panel' && showing ? (task?.key ?? null) : null;
  useEffect(() => {
    if (details === 'panel' && showing) onDetails(panelKey);
  }, [details, showing, panelKey, onDetails]);

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
    if (details === 'card') setShowing(false);
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
  /** D-114: a key's action shows on its button, as a press would. */
  const press = (action: string): void => {
    if (reducedMotion()) return;
    section.current
      ?.querySelector<HTMLElement>(`[data-action="${action}"]`)
      ?.animate([{ scale: '1' }, { scale: '0.94' }, { scale: '1' }], {
        duration: durationMs('--fl-dur-base', 180),
        easing: 'ease-out',
      });
  };
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
      else leave();
    },
    back: (): void => {
      if (at > 0) go(at - 1, 'back');
    },
    /** D-114: to a place on the progress line. */
    jump: (to: number): void => {
      if (to !== at) go(to, to < at ? 'back' : 'next');
    },
    /** D-114: from the first task again, the summary's counts afresh. */
    restart: (): void => {
      setQueue(oldestFirst(open));
      setSteps([]);
      go(0, 'back');
    },
    undo: (): void => {
      const last = steps.at(-1);
      void undo();
      if (!last) return;
      setSteps((current) => current.slice(0, -1));
      // The card it was on comes back (a moved, done or deleted task is in Inbox again).
      if (last.outcome) go(last.at, 'back');
    },
    /** D-114: the whole task, beside the card or on it. */
    show: (): void => {
      if (details === 'panel') setShowing(true);
      else setShowing((current) => !current);
    },
  };

  // The keys, while triage is open (App leaves them to it). Never while a field has the caret, nor
  // for the side panel (its own buttons and fields).
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (document.querySelector('.fl-picker, .fl-menu, .palette, .cheat-sheet')) return;
      if (event.target instanceof Element && event.target.closest('.context-panel')) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && !event.altKey && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        latest.current.undo();
        return;
      }
      if (isTextField(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
      const act = latest.current;
      const handled = ((): boolean => {
        if (key === 'escape') leaveRef.current();
        else if (key === 'm') {
          press('move');
          act.move();
        } else if (key === 'p') {
          press('pin');
          act.pin();
        } else if (key === 'r') {
          press('reminder');
          act.reminder();
        } else if (key === 'e') setEditing(true);
        else if (event.key === ' ') {
          press('done');
          act.done();
        } else if (key === 'delete') {
          press('delete');
          act.remove();
        } else if (key === 'arrowright' || key === 'enter') {
          press('keep');
          act.keep();
        } else if (key === 'arrowleft') {
          press('back');
          act.back();
        } else {
          const priority = PRIORITIES.find((each) => each.key === event.key);
          if (!priority) return false;
          press(`priority-${priority.key}`);
          act.priority(priority.priority);
        }
        return true;
      })();
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // D-114: the stage's height eases to the card's (another task, the notes unfolding, the summary);
  // the actions below follow it. Interrupted, it goes on from where it is.
  const stage = useRef<HTMLDivElement>(null);
  const stageHeight = useRef<number | null>(null);
  const shownKey = task ? `${task.key}/${showing ? 'all' : 'part'}` : 'summary';
  useLayoutEffect(() => {
    const element = stage.current;
    const card = element?.querySelector<HTMLElement>(
      ':scope > .arriving, :scope > .triage-summary',
    );
    if (!element || !card) return;
    const ease = (): void => {
      const to = card.offsetHeight;
      const running = element
        .getAnimations()
        .find((each) => each.id === 'triage-height' && each.playState === 'running');
      const from = running ? element.getBoundingClientRect().height : stageHeight.current;
      running?.cancel();
      stageHeight.current = to;
      if (from === null || Math.abs(from - to) < 1 || reducedMotion()) return;
      const easing = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: durationMs('--fl-dur-page', 320),
        easing: EASE_OUT,
      });
      easing.id = 'triage-height';
    };
    ease();
    const observer = new ResizeObserver(ease);
    observer.observe(card);
    return () => observer.disconnect();
  }, [shownKey]);

  // The actions fold away under the summary and come back with a card; the last card's are kept
  // for that.
  const lastTask = useRef(task);
  if (task) lastTask.current = task;
  const shown = task ?? lastTask.current;

  const progress = total === 0 ? 1 : Math.min(at, total) / total;
  return (
    <section className="triage" aria-label="Inbox triage" ref={section} tabIndex={-1}>
      <header className="triage-head">
        <button
          type="button"
          className="tile triage-back"
          title="Back to Inbox (Esc)"
          aria-label="Back to Inbox"
          onClick={leave}
        >
          <BackIcon />
        </button>
        <h1>
          Inbox <span className="triage-title-soft">· Triage</span>
        </h1>
        <span className="triage-head-space" />
        {(at > 0 || steps.length > 0) && (
          <button type="button" className="triage-restart" onClick={actions.restart}>
            Start over
          </button>
        )}
        {task && (
          <span className="triage-count">
            <MorphText text={`${Math.min(at + 1, total)} of ${total}`} />
          </span>
        )}
      </header>
      <ProgressLine progress={progress} total={total} at={at} onJump={actions.jump} />

      <div className="triage-stage" ref={stage}>
        {leaving && (
          <TriageCard
            key={`leaving-${leaving.task.key}-${String(steps.length)}`}
            task={leaving.task}
            className={`triage-card leaving ${leaving.direction}`}
            onImage={onImage}
            whole={false}
            onGone={() => setLeaving(null)}
          />
        )}
        {task ? (
          <TriageCard
            key={task.key}
            task={task}
            className={`triage-card arriving ${direction}`}
            onImage={onImage}
            whole={details === 'card' && showing}
            editing={editing}
            onTitle={(text) => {
              setEditing(false);
              if (text.trim() !== '' && text !== task.title)
                onCard(change({ kind: 'edit', key: task.key, text }));
            }}
            onEdit={() => setEditing(true)}
            onShow={actions.show}
          />
        ) : (
          <div className="card triage-summary">
            <h2>Inbox sorted</h2>
            <p className="triage-summary-counts">
              {counts.moved} moved · {counts.done} done · {counts.deleted} deleted · {counts.kept}{' '}
              kept
            </p>
            <div className="triage-summary-actions">
              <button type="button" className="primary-button" autoFocus onClick={leave}>
                Done
              </button>
              {open.length > 0 && (
                <button type="button" className="secondary-button" onClick={actions.restart}>
                  Start over
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {shown && (
        <div className={task ? 'triage-actions-fold' : 'triage-actions-fold gone'} inert={!task}>
          <div className="triage-actions" role="toolbar" aria-label="Triage actions">
            {/* What takes the task out of Inbox (or keeps it): the next card comes. */}
            <div className="triage-row">
              <button
                type="button"
                ref={moveButton}
                className="secondary-button"
                data-action="move"
                data-picker-trigger
                onClick={actions.move}
              >
                <HashIcon size={13} /> Move <span className="keycap">M</span>
              </button>
              <button
                type="button"
                className="secondary-button"
                data-action="done"
                onClick={actions.done}
              >
                Done <span className="keycap">Space</span>
              </button>
              <button
                type="button"
                className="secondary-button"
                data-action="delete"
                onClick={actions.remove}
              >
                Delete <span className="keycap">Del</span>
              </button>
              <span className="triage-actions-space" />
              <button
                type="button"
                className="secondary-button"
                data-action="back"
                disabled={at === 0}
                onClick={actions.back}
              >
                <span className="keycap">←</span> Back
              </button>
              <button
                type="button"
                className="primary-button"
                data-action="keep"
                onClick={actions.keep}
              >
                Keep in Inbox <span className="keycap">→</span>
              </button>
            </div>
            {/* What changes the card, which stays. */}
            <div className="triage-row">
              <Priorities
                priority={shown.priority}
                onPick={(priority) => actions.priority(priority)}
              />
              <button
                type="button"
                className={shown.pinned ? 'secondary-button on' : 'secondary-button'}
                data-action="pin"
                onClick={actions.pin}
              >
                <PinIcon size={13} /> <MorphText text={shown.pinned ? 'Pinned' : 'Pin'} />{' '}
                <span className="keycap">P</span>
              </button>
              <button
                type="button"
                ref={reminderButton}
                className={shown.reminder ? 'secondary-button on' : 'secondary-button'}
                data-action="reminder"
                data-picker-trigger
                onClick={actions.reminder}
              >
                <BellIcon size={13} /> Reminder <span className="keycap">R</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * D-114: the progress line, as it looks, and a way to a task: hovering shows the task at that point
 * ("7 of 18"), a click goes there.
 */
function ProgressLine(props: {
  readonly progress: number;
  readonly total: number;
  readonly at: number;
  readonly onJump: (to: number) => void;
}): ReactElement {
  const { progress, total, at, onJump } = props;
  const [hover, setHover] = useState<{ x: number; place: number } | null>(null);
  const placeAt = (event: ReactMouseEvent<HTMLDivElement>): { x: number; place: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - box.left, 0), box.width);
    const place = Math.min(
      total - 1,
      Math.max(0, Math.floor((x / Math.max(1, box.width)) * total)),
    );
    return { x, place };
  };
  return (
    <div
      className={hover ? 'triage-progress hover' : 'triage-progress'}
      aria-hidden="true"
      onPointerMove={(event) => {
        if (total > 0) setHover(placeAt(event));
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(event) => {
        if (total > 0) onJump(placeAt(event).place);
      }}
    >
      <div className="triage-progress-line">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      {hover && (
        <span
          className={hover.place === at ? 'triage-progress-tip here' : 'triage-progress-tip'}
          style={{ left: `${hover.x}px` }}
        >
          {hover.place + 1} of {total}
        </span>
      )}
    </div>
  );
}

/** The priorities as a segmented control; the highlight glides to the one set (D-114). */
function Priorities(props: {
  readonly priority: TaskRow['priority'];
  readonly onPick: (priority: TaskRow['priority']) => void;
}): ReactElement {
  const { priority, onPick } = props;
  const group = useRef<HTMLSpanElement>(null);
  const [glide, setGlide] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const on = group.current?.querySelector<HTMLElement>('.triage-priority.on');
    setGlide(on ? { x: on.offsetLeft, w: on.offsetWidth } : null);
  }, [priority]);
  return (
    <span className="triage-priorities" role="group" aria-label="Priority" ref={group}>
      {glide && (
        <span
          className="triage-priority-glide"
          aria-hidden="true"
          style={{ transform: `translateX(${glide.x}px)`, width: `${glide.w}px` }}
        />
      )}
      {PRIORITIES.map((each) => (
        <button
          key={each.key}
          type="button"
          className={priority === each.priority ? 'triage-priority on' : 'triage-priority'}
          data-action={`priority-${each.key}`}
          title={`${each.name} priority (${each.key})`}
          onClick={() => onPick(each.priority)}
        >
          <span className={`triage-swatch p-${each.priority ?? 'none'}`} />
          <span className="keycap">{each.key}</span>
        </button>
      ))}
    </span>
  );
}

/**
 * D-114: the title edited in its own type, wrapping as it shows, so nothing moves when editing
 * starts or ends. Its shorthand stays text (D-45); Enter and leaving save, Esc puts it back.
 */
function TitleEdit(props: {
  readonly initial: string;
  readonly onLeave: (text: string, cancelled: boolean) => void;
}): ReactElement {
  const { initial, onLeave } = props;
  const text = useInertText(initial, true);
  const left = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const length = field.current?.value.length ?? 0;
    field.current?.setSelectionRange(length, length);
  }, []);
  const leave = (cancelled: boolean): void => {
    if (left.current) return;
    left.current = true;
    onLeave(text.escaped(), cancelled);
  };
  return (
    <textarea
      ref={field}
      className="triage-title-input"
      aria-label="Title"
      autoFocus
      rows={1}
      value={text.value}
      spellCheck={false}
      onChange={(event) => text.change(event.target.value.replace(/\r?\n/g, ' '))}
      onPaste={text.paste}
      onBlur={() => leave(false)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        leave(event.key === 'Escape');
      }}
    />
  );
}

/** One task as triage's card: its priority stripe, title, notes, when it was captured. */
function TriageCard(props: {
  readonly task: TaskRow;
  readonly className: string;
  readonly onImage: ShowImage;
  /** D-114: the whole notes, unfolded (a narrow window). */
  readonly whole: boolean;
  readonly editing?: boolean;
  readonly onTitle?: (text: string) => void;
  readonly onEdit?: () => void;
  readonly onShow?: () => void;
  readonly onGone?: () => void;
}): ReactElement {
  const {
    task,
    className,
    onImage,
    whole,
    editing = false,
    onTitle,
    onEdit,
    onShow,
    onGone,
  } = props;
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
          <TitleEdit
            initial={task.title}
            onLeave={(text, cancelled) => onTitle(cancelled ? task.title : text)}
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
        // D-114: a click on the notes shows the whole task (links and buttons in them still work).
        <div
          className={whole ? 'triage-body whole' : 'triage-body'}
          title={onShow ? 'Show the whole task' : undefined}
          onClick={(event) => {
            if (!onShow) return;
            if (event.target instanceof Element && event.target.closest('a, button, img')) return;
            onShow();
          }}
        >
          <BodyBlock
            body={task.body}
            inline={!whole}
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
