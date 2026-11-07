/**
 * A task row (TASK-01..07, docs/03 §2, 09 §8), shared by the main window and mini mode (D-110):
 * its checkbox, title, indicators and Edit-state field.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { TaskRow } from '../../shared/ipc.js';
import { bodyImages } from '../../shared/body-markdown.js';
import { rawOffset, titleHtml } from '../../shared/inline-markdown.js';
import { isTextField } from '../menu/menu.js';
import { enableAutoPair } from '../auto-pair.js';
import { useInertText } from '../main-window/inert-text.js';
import { BodyIcon, CheckIcon, ImageIcon, PinIcon, ReminderBellIcon } from '../main-window/icons.js';
import type { Ghost } from './ghosts.js';
import { parseCapture, type ListInfo } from '@flint/core/shorthand';
import { usePresence } from './presence.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const hasBody = (task: TaskRow): boolean => task.body.trim() !== '';

/**
 * Edit state (docs/03 §2): a task's title, or a new row below a task (Edit-state Enter). `level`:
 * Tab and Shift+Tab on an empty new row nest it under the task above or lift it out. `seq` starts
 * a fresh text field each time.
 *
 * A new row stays one text field while Enter adds task after task: `added` are the tasks it has
 * added so far, newest last, and the row sits below the newest one already shown. Nothing typed
 * while a save is in flight is lost, and the field is never moved (moving it would drop focus).
 */
export type Editing =
  | {
      readonly kind: 'task';
      readonly key: string;
      readonly seq: number;
      /** D-71: where the caret starts, in the raw title; the end when not given. */
      readonly caret?: number;
    }
  | {
      readonly kind: 'new';
      readonly after: string;
      readonly added: readonly string[];
      readonly level: 'same' | 'in' | 'out';
      readonly seq: number;
    };

/** How a text field was left. */
/** How a text field was left; `notes` is Shift+Enter, which goes on into the task's body (D-78). */
export type Leave = 'enter' | 'escape' | 'blur' | 'indent' | 'outdent' | 'notes';

export interface RowHandlers {
  readonly selected: string | null;
  readonly editing: Editing | null;
  /** A row picked with the mouse; Ctrl/Shift+click mark rows for bulk actions (TASK-07). */
  readonly onSelect: (
    key: string,
    how?: { readonly ctrl: boolean; readonly shift: boolean },
  ) => void;
  /** TASK-07, D-59: the tasks marked for a bulk action. */
  readonly marked: ReadonlySet<string>;
  /** D-77: whether a marked row joins the marked row above and below into one highlight. */
  readonly markJoins: ReadonlyMap<string, { readonly up: boolean; readonly down: boolean }>;
  readonly onToggle: (key: string) => void;
  /** Edit state, with the caret at `caret` in the raw title (D-71) or at the end. */
  readonly onEdit: (key: string, caret?: number) => void;
  readonly onLeaveTask: (key: string, text: string, how: Leave) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
  /** UI-08: the row's right-click menu. */
  readonly onMenu: (task: TaskRow, at: Point) => void;

  /** REM-12: the bell turns the reminder off or on. */
  readonly onMute: (key: string, muted: boolean) => void;
  /** TODAY-01, D-86: the row's pin unpins. */
  readonly onPin: (task: TaskRow, pinned: boolean) => void;
  /** REM-01, D-68: the time opens the date/time picker for the task. */
  readonly onReminder: (task: TaskRow, anchor: DOMRect) => void;
  /** TASK-05, D-53: bodies shown inline, and the body indicator (inline or the task's page). */
  readonly expanded: ReadonlySet<string>;
  readonly onBody: (task: TaskRow) => void;
  /** D-79: the image indicator opens the lightbox on the task's images. */
  readonly onImages: (task: TaskRow) => void;
  /** D-93: Today's list chip opens the task's own list, the task selected there. */
  readonly onHome: (task: TaskRow) => void;
  /**
   * D-111: the lists the shorthand knows, and the list the rows are in, so the row being edited
   * shows its typed `!h`, `@15:00` and `##list` at once (the stripe, the time, a list chip).
   */
  readonly lists?: readonly ListInfo[];
  readonly listId?: string;
}

/** D-111: what the shorthand typed into a row being edited will do, shown on the row. */
interface LiveShorthand {
  readonly priority: TaskRow['priority'] | undefined;
  readonly reminder: string | null;
  readonly list: string | null;
}

/** D-122: tasks just pinned from the faint pin (when), so their pin settles in with a pop. */
const justPinned = new Map<string, number>();
const pinnedNow = (key: string): boolean => Date.now() - (justPinned.get(key) ?? 0) < 1000;

function liveShorthand(
  text: string,
  lists: readonly ListInfo[],
  listId: string | undefined,
): LiveShorthand {
  if (text.trim() === '') return { priority: undefined, reminder: null, list: null };
  const parsed = parseCapture(text, { now: new Date(), lists });
  const target = parsed.target;
  const list =
    (target.kind === 'existing' || target.kind === 'close-match') && target.list.id !== listId
      ? `→ ${target.list.name}`
      : target.kind === 'new'
        ? `New list ${target.name}`
        : null;
  return {
    priority: parsed.counts.priority > 0 ? parsed.priority : undefined,
    reminder: parsed.reminderLabel,
    list,
  };
}

export function Row(
  props: RowHandlers & {
    readonly task: TaskRow;
    readonly subtask?: boolean;
    /** Just appeared in the list being looked at, or reopened: it eases in (UI-04, D-76). */
    readonly fresh?: 'new' | 'return' | undefined;
    /** D-75: a ghost playing the completion animation where the task was. */
    readonly ghost?: Ghost['direction'];
    /**
     * D-110: mini mode's compact size: smaller type and padding (`.fl-compact`), and only what mini
     * acts on: the check, the pin, the bell and time shown (not buttons), no bodies or home list.
     */
    readonly variant?: 'compact';
    /**
     * D-109: a double-click (and Enter, the caller's) opens the task elsewhere instead of editing;
     * a second click on a selected row then does nothing.
     */
    readonly onActivate?: (task: TaskRow) => void;
  },
): ReactElement {
  const {
    task,
    subtask = false,
    selected,
    editing,
    onSelect,
    onToggle,
    onEdit,
    onLeaveTask,
    onTab,
    fresh,
    ghost,
  } = props;
  const isEditing = !ghost && editing?.kind === 'task' && editing.key === task.key;
  const compact = props.variant === 'compact';
  // D-111: the shorthand typed while editing, shown on the row as it is typed.
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!isEditing) setTyped('');
  }, [isEditing]);
  const live = useMemo(
    () => (isEditing ? liveShorthand(typed, props.lists ?? [], props.listId) : null),
    [isEditing, typed, props.lists, props.listId],
  );
  const priority = live?.priority !== undefined ? live.priority : task.priority;
  const reminder = live?.reminder ?? task.reminder;
  // One chip: it arrives and leaves once; its text changes in place as the name is typed.
  const chips = usePresence(live?.list ? [live.list] : [], () => 'list');
  // D-133: pinned however it was (P, the menu, the panel's chip, the faint pin), the pin settles in
  // with its pop; a row that shows up already pinned doesn't pop.
  const wasPinned = useRef(task.pinned);
  if (task.pinned && !wasPinned.current) justPinned.set(task.key, Date.now());
  wasPinned.current = task.pinned;
  const classes = ['row'];
  if (!ghost && task.key === selected && editing?.kind !== 'new') classes.push('sel');
  if (subtask) classes.push('subtask');
  if (task.done) classes.push('done');
  if (isEditing) classes.push('editing');
  if (fresh) classes.push('enter', fresh);
  // D-111: opened once for a double-click on an already-selected row (its first click opens).
  const activated = useRef(0);
  const activate = (): void => {
    const now = performance.now();
    if (now - activated.current < 500) return;
    activated.current = now;
    props.onActivate?.(task);
  };
  /** D-76: a second single click on an already-selected row edits it, like renaming in Explorer. */
  const wasSelected = useRef(false);
  if (ghost) classes.push('leaving', ghost);
  else if (props.marked.size > 1 && props.marked.has(task.key)) {
    classes.push('marked');
    const joins = props.markJoins.get(task.key);
    if (joins?.up) classes.push('mark-up');
    if (joins?.down) classes.push('mark-down');
  }
  const checked = ghost === 'complete' || (task.done && ghost !== 'reopen');
  // D-80: the body icon for any body (images only too), the image icon as well when it has images.
  const hasImages = useMemo(() => bodyImages(task.body).length > 0, [task.body]);
  const hasText = hasBody(task);
  return (
    <div
      data-key={ghost ? undefined : task.key}
      aria-hidden={ghost ? true : undefined}
      className={classes.join(' ')}
      onMouseDown={(event) => {
        // D-86: a right-click doesn't select by itself: its menu keeps a multi-selection it lands
        // in, or selects just this row (Windows Explorer).
        if (event.button !== 0) return;
        // D-89: Ctrl+click on a title's link opens it (on click) and marks nothing.
        if (event.ctrlKey && titleLink(event.target)) {
          event.preventDefault();
          return;
        }
        // Shift+click marks a range of rows (TASK-07), never a text selection across them; an
        // edit in progress ends (leaving the field saves it).
        if (event.shiftKey) {
          event.preventDefault();
          if (isTextField(document.activeElement)) document.activeElement.blur();
        }
        wasSelected.current =
          task.key === selected && !isEditing && !event.ctrlKey && !event.shiftKey;
        onSelect(task.key, { ctrl: event.ctrlKey, shift: event.shiftKey });
      }}
      onClick={(event) => {
        // D-89: a single click only selects, the title's text and links too. A link opens with
        // Ctrl+click, or with a click on an already-selected row.
        const link = titleLink(event.target);
        if (link) {
          event.preventDefault();
          if (event.ctrlKey || (wasSelected.current && event.detail === 1))
            window.flintMain.openLink(link.href);
          return;
        }
        if (event.detail !== 1 || !wasSelected.current || task.done || ghost) return;
        if ((event.target as Element).closest('button, a, input, textarea')) return;
        // D-111: with no editing here (mini), a second click on a selected row opens it.
        if (props.onActivate) return activate();
        // D-76, D-89: a second single click on a selected row edits, the caret where it landed.
        onEdit(task.key, titleCaret(task, event));
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // D-86: the menu selects this row unless it is inside a multi-selection (taskMenu).
        props.onMenu(task, { x: event.clientX, y: event.clientY });
      }}
      // D-71, D-89: double-click anywhere edits (the caret where it landed on the title); inside
      // the field it is the field's own (word selection); never on a link.
      onDoubleClick={(event) => {
        if (task.done || isEditing || titleLink(event.target)) return;
        if (props.onActivate) {
          if (!ghost && !(event.target as Element).closest('button')) activate();
          return;
        }
        onEdit(task.key, titleCaret(task, event));
      }}
    >
      {!task.done && <div className={`stripe p-${priority ?? 'none'}`} />}
      <button
        type="button"
        className={checked ? 'check on' : 'check'}
        aria-label={task.done ? 'Reopen task' : 'Complete task'}
        onClick={() => {
          if (ghost) return;
          // APP-14, D-113: completed with the mouse (the keyboard tip counts it; main window only).
          if (!task.done)
            window.dispatchEvent(new CustomEvent('flint:tip', { detail: 'keyboardComplete' }));
          onToggle(task.key);
        }}
      >
        {checked && <CheckIcon />}
      </button>
      {isEditing ? (
        <EditField
          key={editing.seq}
          initial={task.title}
          {...(editing.caret !== undefined && { caret: editing.caret })}
          inert
          onText={setTyped}
          onLeave={(text, _empty, how) => onLeaveTask(task.key, text, how)}
          onTab={onTab}
        />
      ) : task.code ? (
        <span className="title code-row" onClick={() => props.onBody(task)}>
          <span className="code-kind">
            {task.code.kind} · {task.code.lines} {task.code.lines === 1 ? 'line' : 'lines'}
          </span>
          {task.code.peek && <span className="code-peek">{task.code.peek}</span>}
        </span>
      ) : (
        <Title task={task} />
      )}
      <span className="ind">
        {chips.entries.map(({ item: name, key, leaving }) => (
          // D-111: `##list` typed while editing: where the task goes on save.
          <span
            key={key}
            className={leaving ? 'chip live-list leaving' : 'chip live-list'}
            onAnimationEnd={(event) => {
              if (leaving && event.target === event.currentTarget) chips.gone(key);
            }}
          >
            <MorphText text={name} />
          </span>
        ))}
        {task.pinned && !(task.home && task.done) ? (
          // D-86: the pin unpins. D-122: just pinned from the faint pin, it settles in with a pop.
          <button
            type="button"
            className={pinnedNow(task.key) ? 'pin-ind pinned-now' : 'pin-ind'}
            title="Unpin (P)"
            onClick={(event) => {
              event.stopPropagation();
              props.onPin(task, false);
            }}
          >
            <PinIcon />
          </button>
        ) : (
          !task.done &&
          !compact &&
          !ghost && (
            // D-122: a faint pin on hover, where the pin of a pinned task shows; a click pins.
            <button
              type="button"
              className="pin-hover"
              title="Pin to Today (P)"
              aria-label="Pin to Today"
              onClick={(event) => {
                event.stopPropagation();
                justPinned.set(task.key, Date.now());
                props.onPin(task, true);
              }}
            >
              <PinIcon />
            </button>
          )
        )}
        {reminder && !task.done && compact && (
          // D-110, D-111: in mini the bell turns the reminder off and on, struck as in the main
          // window; the time is shown, not a button (D-109: the picker stays in the main window).
          <span className={`reminder ${task.reminder ? (task.reminderState ?? 'on') : 'on live'}`}>
            <button
              type="button"
              className="reminder-bell"
              title={
                task.reminderState === 'muted' ? 'Turn the reminder on' : 'Turn the reminder off'
              }
              aria-pressed={task.reminderState === 'muted'}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                props.onMute(task.key, task.reminderState !== 'muted');
              }}
            >
              <ReminderBellIcon />
              <span className="overdue-dot" aria-hidden="true" />
            </button>
            <span className="reminder-time">
              <MorphText text={reminder} />
            </span>
          </span>
        )}
        {reminder && !task.done && !compact && (
          // REM-11, REM-12, D-68: the bell never moves; it is the off/on toggle, carries the
          // overdue dot, and the time next to it opens the date/time picker (REM-01).
          <span className={`reminder ${task.reminder ? (task.reminderState ?? 'on') : 'on live'}`}>
            <button
              type="button"
              className="reminder-bell"
              title={
                task.reminderState === 'muted' ? 'Turn the reminder on' : 'Turn the reminder off'
              }
              aria-pressed={task.reminderState === 'muted'}
              onClick={(event) => {
                event.stopPropagation();
                props.onMute(task.key, task.reminderState !== 'muted');
              }}
            >
              <ReminderBellIcon />
              <span className="overdue-dot" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="reminder-time"
              title="Change the reminder"
              onClick={(event) => {
                event.stopPropagation();
                props.onReminder(task, event.currentTarget.getBoundingClientRect());
              }}
            >
              <MorphText text={reminder} />
            </button>
          </span>
        )}
        {task.done && task.completed && <span>{task.completed}</span>}
        {!compact && !task.code && hasImages && (
          <button
            type="button"
            className="body-toggle image-toggle"
            title="Show the images"
            onClick={(event) => {
              event.stopPropagation();
              props.onImages(task);
            }}
          >
            <ImageIcon />
          </button>
        )}
        {!compact && !task.code && hasText && (
          <button
            type="button"
            className={props.expanded.has(task.key) ? 'body-toggle open' : 'body-toggle'}
            title={props.expanded.has(task.key) ? 'Hide the body (←)' : 'Show the body (→)'}
            aria-expanded={props.expanded.has(task.key)}
            onClick={(event) => {
              event.stopPropagation();
              props.onBody(task);
            }}
          >
            <BodyIcon />
          </button>
        )}
        {/* TODAY-01 (M6): in Today, the task's home list, subtly, at the end (03 §4). */}
        {!compact && task.home && !task.done && (
          <button
            type="button"
            className="chip home-list"
            title={`Open ${task.home.listName}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onHome(task);
            }}
          >
            {task.home.listName}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Text that changes in place, like a reminder time (D-69, 09 §9): the old text fades out over the
 * new one while the box's width eases from the old width to the new, in --fl-dur-state. Instant
 * with reduce-motion.
 */
export function MorphText(props: { readonly text: string }): ReactElement {
  const { text } = props;
  const box = useRef<HTMLSpanElement>(null);
  const last = useRef({ text, width: 0 });
  const [old, setOld] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const width = element.getBoundingClientRect().width;
    const before = last.current;
    last.current = { text, width };
    if (before.text === text || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    setOld(before.text);
    const duration = parseFloat(
      getComputedStyle(element).getPropertyValue('--fl-dur-state') || '260',
    );
    element.animate([{ width: `${before.width}px` }, { width: `${width}px` }], {
      duration,
      easing: 'ease',
    });
  }, [text]);
  return (
    <span className="morph" ref={box}>
      {old !== null && (
        <span className="morph-old" aria-hidden="true" onAnimationEnd={() => setOld(null)}>
          {old}
        </span>
      )}
      <span key={text} className={old !== null ? 'morph-new in' : 'morph-new'}>
        {text}
      </span>
    </span>
  );
}

/**
 * A task's title with its inline markdown rendered (LIST-02, D-52); the raw text shows while it is
 * edited. markdown-it escapes everything that isn't markdown, so the HTML is safe. Clicks are the
 * row's (D-89): a single click selects, wherever it lands; links open with Ctrl+click or a click on
 * an already-selected row.
 */
export function Title(props: { readonly task: TaskRow }): ReactElement {
  const { task } = props;
  if (task.title === '') return <span className="title">{task.label}</span>;
  return <span className="title md" dangerouslySetInnerHTML={{ __html: titleHtml(task.title) }} />;
}

/** D-89: the link in a row's rendered title under a click, if any. */
export function titleLink(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('.title.md a') : null;
}

/**
 * D-71, D-89: where the caret goes when a click starts editing: the matching place in the raw
 * title when the click is on its text, else the end (undefined).
 */
export function titleCaret(task: TaskRow, event: React.MouseEvent): number | undefined {
  const span = (event.target as Element).closest<HTMLElement>('.title.md');
  if (!span) return undefined;
  const at = textOffsetAt(span, event.clientX, event.clientY);
  return at === null ? undefined : rawOffset(task.title, span.textContent ?? '', at);
}

/** D-71: the offset in `element`'s text under a point, or null when the point is beside the text. */
function textOffsetAt(element: HTMLElement, x: number, y: number): number | null {
  const text = document.createRange();
  text.selectNodeContents(element);
  const onText = [...text.getClientRects()].some(
    (rect) => x >= rect.left && x <= rect.right + 2 && y >= rect.top && y <= rect.bottom,
  );
  const position = onText ? document.caretPositionFromPoint(x, y) : null;
  if (!position || !element.contains(position.offsetNode)) return null;
  const before = document.createRange();
  before.setStart(element, 0);
  before.setEnd(position.offsetNode, position.offset);
  return before.toString().length;
}

/**
 * The text cursor of Edit state. Enter, Esc and leaving the field all keep what was typed; the
 * existing title is inert, so only typed shorthand applies (D-45). With `repeat` (a new row),
 * Enter hands the text over and the field stays, empty, for the next task.
 */
export function EditField(props: {
  readonly initial: string;
  /** D-71: the caret's starting place; the end when not given. */
  readonly caret?: number;
  readonly inert: boolean;
  readonly placeholder?: string;
  readonly repeat?: boolean;
  readonly onLeave: (text: string, empty: boolean, how: Leave) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
  /** D-111: the text as typed (inert stretches escaped), for the row to show its shorthand. */
  readonly onText?: (escaped: string) => void;
}): ReactElement {
  const { initial, inert, placeholder, repeat = false, onLeave, onTab, onText } = props;
  const text = useInertText(initial, inert);
  const left = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // UI-09: auto-closing brackets and quotes while editing a task.
  useEffect(() => (field.current ? enableAutoPair(field.current) : undefined), []);
  useEffect(() => {
    if (props.caret !== undefined) field.current?.setSelectionRange(props.caret, props.caret);
    // Only where editing starts.
  }, []);
  const leave = (how: Leave): void => {
    if (left.current) return;
    const empty = text.value.trim() === '';
    if (repeat && how === 'enter' && !empty) {
      onLeave(text.escaped(), false, how);
      text.reset('', false);
      return;
    }
    left.current = true;
    onLeave(text.escaped(), empty, how);
  };
  return (
    <input
      ref={field}
      className="title-input"
      autoFocus
      value={text.value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => {
        text.change(event.target.value);
        onText?.(text.escaped());
      }}
      onPaste={text.paste}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={() => leave('blur')}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          // D-78: Shift+Enter goes on into the task's notes (its body).
          leave(event.shiftKey ? 'notes' : 'enter');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          leave('escape');
        } else if (event.key === 'Tab') {
          event.preventDefault();
          onTab(event.shiftKey ? 'outdent' : 'indent');
        }
      }}
    />
  );
}
