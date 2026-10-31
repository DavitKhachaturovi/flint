import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { parseCapture, type ListInfo } from '@flint/core/shorthand';
import flintIcon from '../../../../../assets/icon/flint-icon-512.svg';
import type {
  ChangeOutcome,
  ListChange,
  ListSummary,
  ListView,
  TaskRow,
} from '../../shared/ipc.js';
import {
  BellIcon,
  BodyIcon,
  CheckIcon,
  ChevronIcon,
  FlagIcon,
  HashIcon,
  InboxIcon,
  ListIcon,
  NoteIcon,
  PlusIcon,
} from './icons.js';
import { titleHtml } from '../../shared/inline-markdown.js';
import { isTextField, openMenu, textFieldMenu, type MenuEntry } from '../menu/menu.js';
import { ListPicker, type PickedList } from './ListPicker.js';
import { NoteEditor } from './NoteEditor.js';
import { useInertText } from './inert-text.js';

/**
 * The main window (M4, D-48 daily-use slice): the sidebar with the lists, a list's tasks with the
 * non-task content around them (TASK-15), the composer, and the Navigate/Edit model of docs/03 §2:
 * a selected row takes single-key commands, a text cursor types. Completion has an undo toast and
 * the Completed section (TASK-06). Matches docs/design/mockups/01-main-inbox.html.
 */

const INBOX_SUBTITLE = 'Everything you captured, waiting to be sorted.';
const TOAST_MS = 5000;
/** Navigate state: 1 / 2 / 3 / 0 set low / medium / high / none (TASK-03). */
const PRIORITY_KEYS: Readonly<Record<string, TaskRow['priority']>> = {
  '1': 'low',
  '2': 'medium',
  '3': 'high',
  '0': null,
};
const PRIORITY_NAMES = { high: 'High', medium: 'Medium', low: 'Low' } as const;
interface Point {
  readonly x: number;
  readonly y: number;
}

/** A list's name being typed in the sidebar (LIST-01). */
type Naming =
  | { readonly kind: 'new'; readonly mode: 'tasks' | 'note' }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string };

/** Before a list's rows arrive: select its first row once they do. */
const FIRST_ROW = '';

let seq = 0;

interface Toast {
  readonly text: string;
  readonly undo: boolean;
  readonly id: number;
}

/**
 * Edit state (docs/03 §2): a task's title, or a new row below a task (Edit-state Enter). `level`:
 * Tab and Shift+Tab on an empty new row nest it under the task above or lift it out. `seq` starts
 * a fresh text field each time.
 *
 * A new row stays one text field while Enter adds task after task: `added` are the tasks it has
 * added so far, newest last, and the row sits below the newest one already shown. Nothing typed
 * while a save is in flight is lost, and the field is never moved (moving it would drop focus).
 */
type Editing =
  | { readonly kind: 'task'; readonly key: string; readonly seq: number }
  | {
      readonly kind: 'new';
      readonly after: string;
      readonly added: readonly string[];
      readonly level: 'same' | 'in' | 'out';
      readonly seq: number;
    };

type NewEditing = Extract<Editing, { kind: 'new' }>;

const newRow = (after: string): NewEditing => ({
  kind: 'new',
  after,
  added: [],
  level: 'same',
  seq: ++seq,
});

/** How a text field was left. */
type Leave = 'enter' | 'escape' | 'blur' | 'indent' | 'outdent';

/** The rows the keyboard moves through, top to bottom (Navigate state, docs/03 §2). */
function visibleRows(view: ListView | null, completedOpen: boolean): TaskRow[] {
  if (!view) return [];
  const rows: TaskRow[] = [];
  for (const item of view.items) {
    if (item.kind !== 'task') continue;
    rows.push(item.task, ...item.task.subtasks);
  }
  if (completedOpen) for (const task of view.completed) rows.push(task, ...task.subtasks);
  return rows;
}

export function App(): ReactElement {
  const [lists, setLists] = useState<readonly ListSummary[]>([]);
  const [listId, setListId] = useState('inbox');
  const [view, setView] = useState<ListView | null>(null);
  const [selected, setSelected] = useState<string | null>(FIRST_ROW);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [completedOpen, setCompletedOpen] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const composer = useRef<HTMLInputElement>(null);
  /** "Move to…" (TASK-11): the task and where the picker opens. */
  const [picker, setPicker] = useState<{ key: string; at: Point } | null>(null);
  /** A list's name being typed in the sidebar: a new list or note, or a rename (LIST-01). */
  const [naming, setNaming] = useState<Naming | null>(null);
  const [namingProblem, setNamingProblem] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [nextLists, nextView] = await Promise.all([
      window.flintMain.lists(),
      window.flintMain.view(listId),
    ]);
    setLists(nextLists);
    setView(nextView);
  }, [listId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    window.flintMain.onChanged(() => void refreshRef.current());
    // A reminder's Open: its list, with the task selected once the rows are there.
    window.flintMain.onReveal(({ listId: id, key }) => {
      setListId(id);
      setEditing(null);
      setSelected(key);
    });
  }, []);

  const openList = useCallback((id: string): void => {
    setListId(id);
    setSelected(FIRST_ROW);
    setEditing(null);
  }, []);

  const showToast = useCallback((text: string, undo: boolean): void => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const change = useCallback(
    (next: ListChange): Promise<ChangeOutcome | null> => window.flintMain.change(listId, next),
    [listId],
  );

  const rows = useMemo(() => visibleRows(view, completedOpen), [view, completedOpen]);

  // A fresh list selects its first row. A row that went away hands the selection to the row now
  // in its place; a task just added isn't in the rows until the next refresh, so it is waited for.
  const previousRows = useRef<TaskRow[]>([]);
  useEffect(() => {
    const before = previousRows.current;
    previousRows.current = rows;
    if (selected === null || rows.some((row) => row.key === selected)) return;
    if (selected === FIRST_ROW) {
      if (rows[0]) setSelected(rows[0].key);
      return;
    }
    const gone = before.findIndex((row) => row.key === selected);
    if (gone >= 0) setSelected(rows[Math.min(gone, rows.length - 1)]?.key ?? FIRST_ROW);
  }, [rows, selected]);

  const toggle = useCallback(
    async (key: string): Promise<void> => {
      const index = rows.findIndex((row) => row.key === key);
      const row = rows[index];
      const done = await window.flintMain.toggle(listId, key);
      if (!done) return;
      // Completing moves the row away: the selection stays in the open tasks, on the next one.
      if (done === 'Completed' && row) {
        const open = (other: TaskRow): boolean =>
          !other.done && other.key !== key && !row.subtasks.some((sub) => sub.key === other.key);
        const next = rows.slice(index + 1).find(open) ?? rows.slice(0, index).reverse().find(open);
        if (next) setSelected(next.key);
      }
      showToast(done, true);
    },
    [listId, rows, showToast],
  );

  const undo = useCallback(async (): Promise<void> => {
    const undone = await window.flintMain.undo();
    showToast(undone ? `Undid: ${undone}` : 'Nothing to undo', false);
  }, [showToast]);

  const redo = useCallback(async (): Promise<void> => {
    const redone = await window.flintMain.redo();
    showToast(redone ? `Redid: ${redone}` : 'Nothing to redo', false);
  }, [showToast]);

  const edit = useCallback((key: string): void => {
    setSelected(key);
    setEditing({ kind: 'task', key, seq: ++seq });
  }, []);

  // The new row reads the latest Edit state when a key arrives, before React has re-rendered.
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const leaveTask = useCallback(
    (key: string, text: string, how: Leave): void => {
      // Switch first, save after: what is typed next lands in the new row, not in a closed field.
      if (how === 'enter') setEditing(newRow(key));
      else {
        setEditing((current) => (current?.kind === 'task' && current.key === key ? null : current));
        setSelected(key);
      }
      void change({ kind: 'edit', key, text });
    },
    [change],
  );

  /** Tab and Shift+Tab in Edit state (TASK-04): a task moves at once; a new row changes level. */
  const tab = useCallback(
    (how: 'indent' | 'outdent'): void => {
      const current = editingRef.current;
      if (current?.kind === 'task') void change({ kind: how, key: current.key });
      if (current?.kind === 'new') {
        const level = how === 'indent' ? 'in' : 'out';
        setEditing({ ...current, level: current.level === 'same' ? level : 'same' });
      }
    },
    [change],
  );

  const leaveNew = useCallback(
    (text: string, empty: boolean, how: Leave, id: string | null): void => {
      const current = editingRef.current;
      if (current?.kind !== 'new') return;
      if (empty) {
        // Back to Navigate on the last task the row added (or the one it started below).
        setEditing(null);
        setSelected(current.added.at(-1) ?? current.after);
        return;
      }
      // `##list` sends the task elsewhere (D-25): the row stays below the same task here.
      const infos = lists.map((list): ListInfo => ({
        id: list.id,
        name: list.name,
        mode: list.mode,
      }));
      const target = parseCapture(text, { now: new Date(), lists: infos }).target;
      const here =
        target.kind === 'inbox' ||
        target.kind === 'note' ||
        target.kind === 'invalid-name' ||
        ((target.kind === 'existing' || target.kind === 'close-match') &&
          target.list.id === listId);
      const anchor = current.added.at(-1) ?? current.after;
      void change({ kind: 'add', text, where: { after: anchor }, ...(id ? { id } : {}) }).then(
        (outcome) => {
          if (outcome && outcome.listId !== listId) showToast(outcome.label, true);
        },
      );
      const key = here ? id : null;
      if (key && current.level !== 'same')
        void change({ kind: current.level === 'in' ? 'indent' : 'outdent', key });
      if (how === 'enter') {
        setEditing({
          ...current,
          added: key ? [...current.added, key] : current.added,
          level: 'same',
        });
        return;
      }
      setEditing(null);
      if (key) setSelected(key);
    },
    [change, listId, lists, showToast],
  );

  const addFromComposer = useCallback(
    async (text: string): Promise<void> => {
      const outcome = await change({ kind: 'add', text, where: 'top' });
      if (!outcome?.key) return;
      if (outcome.listId !== listId) showToast(outcome.label, true);
      else setSelected(outcome.key);
    },
    [change, listId, showToast],
  );

  /** TASK-12, D-50: to Trash storage, with Undo. */
  const remove = useCallback(
    async (key: string): Promise<void> => {
      const outcome = await change({ kind: 'delete', key });
      if (outcome) showToast(outcome.label, true);
    },
    [change, showToast],
  );

  /** TASK-11: to the top of another list, or a new one, with Undo. */
  const moveTask = useCallback(
    async (key: string, to: PickedList): Promise<void> => {
      setPicker(null);
      const outcome = await change({ kind: 'moveTo', key, to });
      if (outcome) showToast(outcome.label, true);
    },
    [change, showToast],
  );

  /** UI-08, D-55: a task's right-click menu (also Shift+F10 and the Menu key). */
  const taskMenu = useCallback(
    (row: TaskRow, at: Point, keyboard = false): void => {
      const open = !row.done;
      const priority = (label: string, hint: string, value: TaskRow['priority']): MenuEntry => ({
        label,
        hint,
        action: () => void change({ kind: 'priority', key: row.key, priority: value }),
      });
      openMenu(
        [
          ...(open ? [{ label: 'Edit', hint: 'Enter', action: () => edit(row.key) }] : []),
          {
            label: open ? 'Complete' : 'Reopen',
            hint: 'Space',
            action: () => void toggle(row.key),
          },
          'divider',
          ...(open
            ? [
                priority('Priority high', '3', 'high'),
                priority('Priority medium', '2', 'medium'),
                priority('Priority low', '1', 'low'),
                priority('No priority', '0', null),
                'divider' as const,
              ]
            : []),
          { label: 'Move to…', action: () => setPicker({ key: row.key, at }) },
          'divider',
          { label: 'Delete', hint: 'Del', action: () => void remove(row.key) },
        ],
        at,
        { keyboard },
      );
    },
    [change, edit, remove, toggle],
  );

  /** LIST-01, D-52: the + next to "Lists", Ctrl+Shift+N and the sidebar's background. */
  const newListMenu = useCallback((at: Point, keyboard = false): void => {
    const start = (mode: 'tasks' | 'note'): void => {
      setNamingProblem(null);
      setNaming({ kind: 'new', mode });
    };
    openMenu(
      [
        { label: 'New task list', hint: 'Ctrl+Shift+N', action: () => start('tasks') },
        { label: 'New note', action: () => start('note') },
      ],
      at,
      { keyboard },
    );
  }, []);

  const submitName = useCallback(
    async (name: string): Promise<void> => {
      if (!naming) return;
      const outcome = await window.flintMain.listAction(
        naming.kind === 'new'
          ? { kind: 'new', name, mode: naming.mode }
          : { kind: 'rename', id: naming.id, name },
      );
      if (!outcome) return;
      if (!outcome.ok) {
        setNamingProblem(outcome.problem);
        return;
      }
      setNaming(null);
      setNamingProblem(null);
      if (naming.kind === 'new') openList(outcome.listId);
      if (outcome.label) showToast(outcome.label, true);
    },
    [naming, openList, showToast],
  );

  /** D-55: a list's right-click menu; Inbox has none (LIST-03). */
  const listMenu = useCallback(
    (list: ListSummary, at: Point): void => {
      openMenu(
        [
          {
            label: 'Rename',
            action: () => {
              setNamingProblem(null);
              setNaming({ kind: 'rename', id: list.id, name: list.name });
            },
          },
          {
            label: list.mode === 'note' ? 'Delete note' : 'Delete list',
            action: () =>
              void window.flintMain.listAction({ kind: 'delete', id: list.id }).then((outcome) => {
                if (!outcome) return;
                if (!outcome.ok) return showToast(outcome.problem, false);
                if (listId === list.id) openList('inbox');
                showToast(outcome.label, true);
              }),
          },
        ],
        at,
      );
    },
    [listId, openList, showToast],
  );

  // UI-08: every text field keeps Cut / Copy / Paste / Select all; elsewhere Electron shows nothing.
  useEffect(() => {
    const onMenu = (event: MouseEvent): void => {
      event.preventDefault();
      if (isTextField(event.target))
        openMenu(
          textFieldMenu(event.target, (command) => window.flintMain.edit(command)),
          { x: event.clientX, y: event.clientY },
        );
    };
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      // Ctrl+Shift+N works anywhere in the window (LIST-01, D-52).
      if (key === 'n' && event.ctrlKey && event.shiftKey && !event.altKey) {
        event.preventDefault();
        const box = addButton.current?.getBoundingClientRect();
        newListMenu(box ? { x: box.left, y: box.bottom + 4 } : { x: 24, y: 120 }, true);
        return;
      }
      // Ctrl+N works anywhere in the window (docs/03 §2, Q-08 default).
      if (key === 'n' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        composer.current?.focus();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (event.ctrlKey && !event.altKey && (key === 'z' || key === 'y')) {
        event.preventDefault();
        void (key === 'z' && !event.shiftKey ? undo() : redo());
        return;
      }
      if (event.ctrlKey || event.metaKey || view?.mode !== 'tasks') return;
      const index = rows.findIndex((row) => row.key === selected);
      const row = rows[index];
      const open = row && !row.done ? row : undefined;

      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey) {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 'down' : 'up';
        if (event.altKey) {
          // Alt+↑/↓ reorders (TASK-02); single keys never reach Windows.
          if (open) void change({ kind: 'move', key: open.key, direction });
          return;
        }
        const step = direction === 'down' ? 1 : -1;
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
        if (next) setSelected(next.key);
        return;
      }
      if (event.altKey) return;
      if (event.key === ' ' && row) {
        event.preventDefault();
        void toggle(row.key);
      } else if (event.key in PRIORITY_KEYS && open) {
        event.preventDefault();
        void change({
          kind: 'priority',
          key: open.key,
          priority: PRIORITY_KEYS[event.key] ?? null,
        });
      } else if (event.key === 'Enter' && open) {
        event.preventDefault();
        edit(open.key);
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        composer.current?.focus();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        if (open) void change({ kind: event.shiftKey ? 'outdent' : 'indent', key: open.key });
      } else if (event.key === 'Delete' && row) {
        event.preventDefault();
        void remove(row.key);
      } else if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && row) {
        event.preventDefault();
        const box = document
          .querySelector(`[data-key="${CSS.escape(row.key)}"]`)
          ?.getBoundingClientRect();
        taskMenu(row, box ? { x: box.left + 48, y: box.bottom } : { x: 300, y: 200 }, true);
      } else if (event.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selected, view, change, edit, toggle, undo, redo, remove, taskMenu, newListMenu]);

  const taskLists = lists.filter((list) => !list.inbox);
  const inbox = lists.find((list) => list.inbox);
  // UI-04: rows that appear in the list being looked at ease in; opening a list doesn't animate.
  const known = useRef<{ list: string; keys: ReadonlySet<string> }>({ list: '', keys: new Set() });
  const freshKeys = new Set<string>();
  if (view && known.current.list === view.id)
    for (const row of rows) if (!known.current.keys.has(row.key)) freshKeys.add(row.key);
  useEffect(() => {
    if (view) known.current = { list: view.id, keys: new Set(rows.map((row) => row.key)) };
  }, [view, rows]);
  // UI-04: one selection highlight per card glides between rows; a row being edited shows its own.
  const tasksCard = useRef<HTMLElement>(null);
  const completedCard = useRef<HTMLElement>(null);
  const glideTarget = editing ? null : selected;
  const glideVersion = [rows, completedOpen];

  const rowProps: RowHandlers = {
    selected,
    editing,
    onSelect: setSelected,
    onToggle: (key) => void toggle(key),
    onEdit: edit,
    onLeaveTask: leaveTask,
    onTab: tab,
    onMenu: (task, at) => taskMenu(task, at),
  };

  // The task card as one flat run of rows, so a new row keeps its place (and its focus) while
  // the tasks it adds appear above it. It sits below the newest of its tasks already shown.
  const cardRows: ReactElement[] = [];
  if (view?.mode === 'tasks') {
    const fresh = editing?.kind === 'new' ? editing : null;
    const shown = new Set(rows.map((row) => row.key));
    const anchor = fresh
      ? [fresh.after, ...fresh.added].filter((key) => shown.has(key)).at(-1)
      : undefined;
    const placeNew = (after: string, subtask: boolean): void => {
      if (!fresh || after !== anchor) return;
      const nested = fresh.level === 'in' || (subtask && fresh.level !== 'out');
      cardRows.push(
        <NewRow key={`new-${fresh.seq}`} subtask={nested} onLeave={leaveNew} onTab={tab} />,
      );
    };
    view.items.forEach((item, index) => {
      if (item.kind === 'heading')
        cardRows.push(
          <h2 key={`heading-${index}`} className="read-heading">
            {item.text}
          </h2>,
        );
      else if (item.kind === 'text')
        cardRows.push(
          <p key={`text-${index}`} className="read-text">
            {item.text}
          </p>,
        );
      else {
        cardRows.push(
          <Row
            key={item.task.key}
            task={item.task}
            fresh={freshKeys.has(item.task.key)}
            {...rowProps}
          />,
        );
        for (const subtask of item.task.subtasks) {
          cardRows.push(
            <Row
              key={subtask.key}
              task={subtask}
              subtask
              fresh={freshKeys.has(subtask.key)}
              {...rowProps}
            />,
          );
          placeNew(subtask.key, true);
        }
        placeNew(item.task.key, false);
      }
    });
  }

  return (
    <div className="app">
      <aside
        className="sidebar"
        onContextMenu={(event) => {
          event.preventDefault();
          newListMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <div className="brand">
          <img src={flintIcon} alt="" />
          <span>Flint</span>
        </div>
        {inbox && (
          <NavItem
            list={inbox}
            active={listId === inbox.id}
            icon={<InboxIcon />}
            onSelect={() => openList(inbox.id)}
            onMenu={() => undefined}
          />
        )}
        <div className="section-label lists-label">
          <span>Lists</span>
          <button
            ref={addButton}
            type="button"
            className="add-list"
            aria-label="New list or note"
            title="New list or note (Ctrl+Shift+N)"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              newListMenu({ x: box.left, y: box.bottom + 4 });
            }}
          >
            <PlusIcon />
          </button>
        </div>
        {taskLists.map((list) =>
          naming?.kind === 'rename' && naming.id === list.id ? (
            <NameField
              key={list.id}
              initial={list.name}
              icon={list.mode === 'note' ? <NoteIcon /> : <ListIcon />}
              problem={namingProblem}
              onSubmit={(name) => void submitName(name)}
              onCancel={() => setNaming(null)}
            />
          ) : (
            <NavItem
              key={list.id}
              list={list}
              active={listId === list.id}
              icon={list.mode === 'note' ? <NoteIcon /> : <ListIcon />}
              onSelect={() => openList(list.id)}
              onMenu={(at) => listMenu(list, at)}
            />
          ),
        )}
        {naming?.kind === 'new' && (
          <NameField
            key={`new-${naming.mode}`}
            initial=""
            placeholder={naming.mode === 'note' ? 'Note name' : 'List name'}
            icon={naming.mode === 'note' ? <NoteIcon /> : <ListIcon />}
            problem={namingProblem}
            onSubmit={(name) => void submitName(name)}
            onCancel={() => setNaming(null)}
          />
        )}
        {/* Settings returns with the Settings screen (APP-11, M8, D-52). */}
      </aside>

      <main className="main">
        <div className="titlebar" />
        <div className="scroller">
          <div className="content">
            {view && (
              <header className="list-header">
                <h1>
                  {view.name}
                  {view.mode === 'tasks' && <span className="count"> · {view.open} open</span>}
                </h1>
                {lists.find((list) => list.id === view.id)?.inbox && (
                  <span className="subtitle">{INBOX_SUBTITLE}</span>
                )}
                {view.readOnly && (
                  <span className="subtitle">
                    Read-only: Flint can&apos;t change this file ({view.readOnly}).
                  </span>
                )}
              </header>
            )}

            {view?.mode === 'note' && (
              <NoteEditor
                key={view.name}
                id={view.id}
                text={view.noteText ?? ''}
                readOnly={view.readOnly !== null}
                onId={setListId}
              />
            )}

            {view?.mode === 'tasks' && (
              <>
                {!view.readOnly && (
                  <Composer
                    key={view.id}
                    listId={view.id}
                    lists={lists}
                    inputRef={composer}
                    onAdd={addFromComposer}
                  />
                )}

                <section className="card tasks" aria-label="Tasks" ref={tasksCard}>
                  <Glide card={tasksCard} target={glideTarget} version={glideVersion} />
                  {view.items.length === 0 && (
                    <p className="empty">
                      Nothing here. Press Ctrl+N to add a task, or capture from anywhere with your
                      hotkey.
                    </p>
                  )}
                  {cardRows}
                </section>

                {view.completed.length > 0 && (
                  <section className="card completed" aria-label="Completed" ref={completedCard}>
                    <Glide card={completedCard} target={glideTarget} version={glideVersion} />
                    <button
                      type="button"
                      className="completed-head"
                      aria-expanded={completedOpen}
                      onClick={() => setCompletedOpen(!completedOpen)}
                    >
                      <span className={completedOpen ? 'chev open' : 'chev'}>
                        <ChevronIcon />
                      </span>
                      <span>Completed</span>
                      <span className="chip">{view.completed.length}</span>
                    </button>
                    {completedOpen &&
                      view.completed.map((task) => (
                        <Row
                          key={task.key}
                          task={task}
                          fresh={freshKeys.has(task.key)}
                          {...rowProps}
                        />
                      ))}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {picker && view && (
        <ListPicker
          lists={lists}
          exclude={view.id}
          at={picker.at}
          onPick={(to) => void moveTask(picker.key, to)}
          onClose={() => setPicker(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={() => void undo().then(() => setToast(null))}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NavItem(props: {
  readonly list: ListSummary;
  readonly active: boolean;
  readonly icon: ReactElement;
  readonly onSelect: () => void;
  readonly onMenu: (at: Point) => void;
}): ReactElement {
  const { list, active, icon, onSelect, onMenu } = props;
  return (
    <button
      type="button"
      className={active ? 'nav on' : 'nav'}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <span className={active ? 'tile strong' : 'tile'}>{icon}</span>
      <span className="nav-name">{list.name}</span>
      {list.mode === 'tasks' && <span className="nav-count">{list.open}</span>}
    </button>
  );
}

/**
 * The composer (mockup 01, TASK-02): adds to the top of this list with the capture shorthand;
 * `##list` sends the task elsewhere (D-25). Chips show what the shorthand will do.
 */
function Composer(props: {
  readonly listId: string;
  readonly lists: readonly ListSummary[];
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onAdd: (text: string) => Promise<void>;
}): ReactElement {
  const { listId, lists, inputRef, onAdd } = props;
  const text = useInertText('', false);
  const infos = useMemo(
    () => lists.map((list): ListInfo => ({ id: list.id, name: list.name, mode: list.mode })),
    [lists],
  );
  const { escaped, value } = text;
  const parsed = useMemo(
    () => (value.trim() === '' ? null : parseCapture(escaped(), { now: new Date(), lists: infos })),
    [value, escaped, infos],
  );
  const chips: string[] = [];
  if (parsed?.priority) chips.push(PRIORITY_NAMES[parsed.priority]);
  const target = parsed?.target;
  if ((target?.kind === 'existing' || target?.kind === 'close-match') && target.list.id !== listId)
    chips.push(`→ ${target.list.name}`);
  if (target?.kind === 'new') chips.push(`New list ${target.name}`);

  const insert = (token: string): void => {
    text.insertLive(token);
    inputRef.current?.focus();
  };

  return (
    <section className="card composer" aria-label="Add a task">
      <input
        ref={inputRef}
        className="composer-input"
        placeholder="Add a task…"
        value={value}
        spellCheck={false}
        onChange={(event) => text.change(event.target.value)}
        onPaste={text.paste}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            const typed = text.escaped();
            if (typed.trim() === '') return;
            text.reset('', false);
            void onAdd(typed);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <div className="composer-bar">
        <div className="tools">
          <button
            type="button"
            className="tool"
            aria-label="Set priority"
            onClick={() => insert('!h')}
          >
            <FlagIcon />
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Choose list"
            onClick={() => insert('##')}
          >
            <HashIcon />
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Set reminder"
            onClick={() => insert('@')}
          >
            <BellIcon size={15} />
          </button>
        </div>
        {chips.length > 0 || parsed?.reminderLabel ? (
          <span className="composer-chips">
            {chips.map((chip) => (
              <span key={chip} className="chip">
                {chip}
              </span>
            ))}
            {parsed?.reminderLabel && (
              <span className="chip">
                <BellIcon />
                {parsed.reminderLabel}
              </span>
            )}
          </span>
        ) : (
          <span className="hint">
            or type <span className="chip">!h ##list @15:00</span>
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * A list's name typed in the sidebar (LIST-01): Enter saves, Esc or leaving the field cancels; a
 * problem (a name Windows can't use, one already taken) shows under it.
 */
function NameField(props: {
  readonly initial: string;
  readonly placeholder?: string;
  readonly icon: ReactElement;
  readonly problem: string | null;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { initial, placeholder, icon, problem, onSubmit, onCancel } = props;
  const [name, setName] = useState(initial);
  return (
    <div className="name-field">
      <div className="nav on">
        <span className="tile">{icon}</span>
        <input
          className="name-input"
          autoFocus
          value={name}
          placeholder={placeholder}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
          onBlur={onCancel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit(name);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </div>
      {problem && <p className="name-problem">{problem}</p>}
    </div>
  );
}

interface RowHandlers {
  readonly selected: string | null;
  readonly editing: Editing | null;
  readonly onSelect: (key: string) => void;
  readonly onToggle: (key: string) => void;
  readonly onEdit: (key: string) => void;
  readonly onLeaveTask: (key: string, text: string, how: Leave) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
  /** UI-08: the row's right-click menu. */
  readonly onMenu: (task: TaskRow, at: Point) => void;
}

function Row(
  props: RowHandlers & {
    readonly task: TaskRow;
    readonly subtask?: boolean;
    /** Just appeared in the list being looked at: it eases in (UI-04). */
    readonly fresh?: boolean;
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
    fresh = false,
  } = props;
  const isEditing = editing?.kind === 'task' && editing.key === task.key;
  const classes = ['row'];
  if (task.key === selected && editing?.kind !== 'new') classes.push('sel');
  if (subtask) classes.push('subtask');
  if (task.done) classes.push('done');
  if (isEditing) classes.push('editing');
  if (fresh) classes.push('enter');
  return (
    <div
      data-key={task.key}
      className={classes.join(' ')}
      onMouseDown={() => onSelect(task.key)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(task.key);
        props.onMenu(task, { x: event.clientX, y: event.clientY });
      }}
      onDoubleClick={() => !task.done && onEdit(task.key)}
    >
      {!task.done && <div className={`stripe p-${task.priority ?? 'none'}`} />}
      <button
        type="button"
        className={task.done ? 'check on' : 'check'}
        aria-label={task.done ? 'Reopen task' : 'Complete task'}
        onClick={() => onToggle(task.key)}
      >
        {task.done && <CheckIcon />}
      </button>
      {isEditing ? (
        <EditField
          key={editing.seq}
          initial={task.title}
          inert
          onLeave={(text, _empty, how) => onLeaveTask(task.key, text, how)}
          onTab={onTab}
        />
      ) : task.code ? (
        <span className="title code-row">
          <span className="code-kind">
            {task.code.kind} · {task.code.lines} {task.code.lines === 1 ? 'line' : 'lines'}
          </span>
          {task.code.peek && <span className="code-peek">{task.code.peek}</span>}
        </span>
      ) : (
        <Title task={task} />
      )}
      <span className="ind">
        {task.reminder && !task.done && (
          <span className="reminder">
            <BellIcon />
            {task.reminder}
          </span>
        )}
        {task.done && task.completed && <span>{task.completed}</span>}
        {!task.done && !task.code && task.body.trim() !== '' && (
          <span title="Has a body">
            <BodyIcon />
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The selection highlight (UI-04, D-56): one element per card that moves to the selected row with
 * the spring curve, instead of the highlight jumping from row to row. Off with reduce-motion, like
 * all motion (the move is then instant).
 */
function Glide(props: {
  readonly card: RefObject<HTMLElement | null>;
  readonly target: string | null;
  /** Re-measure when the rows change. */
  readonly version: unknown;
}): ReactElement | null {
  const { card, target, version } = props;
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = (): void => {
      const row = target
        ? card.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(target)}"]`)
        : null;
      setBox(
        row
          ? { x: row.offsetLeft, y: row.offsetTop, w: row.offsetWidth, h: row.offsetHeight }
          : null,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [card, target, version]);
  if (!box) return null;
  return (
    <div
      className="sel-glide"
      aria-hidden="true"
      style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
    />
  );
}

/**
 * A task's title with its inline markdown rendered (LIST-02, D-52); the raw text shows while it is
 * edited. markdown-it escapes everything that isn't markdown, so the HTML is safe. A click on a
 * link opens it in the browser and does nothing else.
 */
function Title(props: { readonly task: TaskRow }): ReactElement {
  const { task } = props;
  if (task.title === '') return <span className="title">{task.label}</span>;
  const onLink = (event: React.MouseEvent): HTMLAnchorElement | null =>
    (event.target as HTMLElement).closest('a');
  return (
    <span
      className="title md"
      dangerouslySetInnerHTML={{ __html: titleHtml(task.title) }}
      onMouseDown={(event) => {
        if (onLink(event)) event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        if (onLink(event)) event.stopPropagation();
      }}
      onClick={(event) => {
        const link = onLink(event);
        if (!link) return;
        event.preventDefault();
        window.flintMain.openLink(link.href);
      }}
    />
  );
}

/**
 * Edit-state Enter: a new row below the task (docs/03 §2). Enter adds what was typed and keeps the
 * field for the next task; its ID is fetched ahead, so the next one can go below it at once.
 */
function NewRow(props: {
  readonly subtask: boolean;
  readonly onLeave: (text: string, empty: boolean, how: Leave, id: string | null) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
}): ReactElement {
  const { subtask, onLeave, onTab } = props;
  const nextId = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    nextId.current = window.flintMain.reserveId();
  }, []);
  const leave = (text: string, empty: boolean, how: Leave): void => {
    const id = nextId.current ?? Promise.resolve(null);
    if (!empty) nextId.current = window.flintMain.reserveId();
    // Already there in practice (fetched when the row opened): a microtask, before the next key.
    void id.then((value) => onLeave(text, empty, how, value));
  };
  return (
    <div className={subtask ? 'row sel editing subtask' : 'row sel editing'}>
      <span className="check" aria-hidden="true" />
      <EditField
        initial=""
        inert={false}
        placeholder="New task"
        repeat
        onLeave={leave}
        onTab={onTab}
      />
    </div>
  );
}

/**
 * The text cursor of Edit state. Enter, Esc and leaving the field all keep what was typed; the
 * existing title is inert, so only typed shorthand applies (D-45). With `repeat` (a new row),
 * Enter hands the text over and the field stays, empty, for the next task.
 */
function EditField(props: {
  readonly initial: string;
  readonly inert: boolean;
  readonly placeholder?: string;
  readonly repeat?: boolean;
  readonly onLeave: (text: string, empty: boolean, how: Leave) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
}): ReactElement {
  const { initial, inert, placeholder, repeat = false, onLeave, onTab } = props;
  const text = useInertText(initial, inert);
  const left = useRef(false);
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
      className="title-input"
      autoFocus
      value={text.value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => text.change(event.target.value)}
      onPaste={text.paste}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={() => leave('blur')}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          leave('enter');
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
