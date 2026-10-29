import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import flintIcon from '../../../../../assets/icon/flint-icon-512.svg';
import type { ListItem, ListSummary, ListView, TaskRow } from '../../shared/ipc.js';
import {
  BellIcon,
  BodyIcon,
  CheckIcon,
  ChevronIcon,
  InboxIcon,
  ListIcon,
  NoteIcon,
  SettingsIcon,
} from './icons.js';

/**
 * The main window (M4, D-48 first slice): the sidebar with the lists, a list's tasks with the
 * non-task content around them (TASK-15), completion with an undo toast and the Completed section
 * (TASK-06). Matches docs/design/mockups/01-main-inbox.html.
 */

const INBOX_SUBTITLE = 'Everything you captured, waiting to be sorted.';
const TOAST_MS = 5000;

interface Toast {
  readonly text: string;
  readonly undo: boolean;
  readonly id: number;
}

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
  const [selected, setSelected] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

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

  useEffect(() => {
    window.flintMain.onChanged(() => void refreshRef.current());
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const showToast = useCallback((text: string, undo: boolean): void => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const toggle = useCallback(
    async (key: string): Promise<void> => {
      const done = await window.flintMain.toggle(listId, key);
      if (done) showToast(done, true);
    },
    [listId, showToast],
  );

  const undo = useCallback(async (): Promise<void> => {
    const undone = await window.flintMain.undo();
    if (undone) showToast(`Undid: ${undone}`, false);
    else showToast('Nothing to undo', false);
  }, [showToast]);

  const rows = useMemo(() => visibleRows(view, completedOpen), [view, completedOpen]);

  // Keep a selection on a row that still exists.
  useEffect(() => {
    if (selected && rows.some((row) => row.key === selected)) return;
    setSelected(rows[0]?.key ?? null);
  }, [rows, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      const index = rows.findIndex((row) => row.key === selected);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next =
          rows[
            Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
          ];
        if (next) setSelected(next.key);
      } else if (event.key === ' ' && selected) {
        event.preventDefault();
        void toggle(selected);
      } else if (event.key === 'z' && event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selected, toggle, undo]);

  const taskLists = lists.filter((list) => !list.inbox);
  const inbox = lists.find((list) => list.inbox);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={flintIcon} alt="" />
          <span>Flint</span>
        </div>
        {inbox && (
          <NavItem
            list={inbox}
            active={listId === inbox.id}
            icon={<InboxIcon />}
            onSelect={() => setListId(inbox.id)}
          />
        )}
        {taskLists.length > 0 && <div className="section-label">Lists</div>}
        {taskLists.map((list) => (
          <NavItem
            key={list.id}
            list={list}
            active={listId === list.id}
            icon={list.mode === 'note' ? <NoteIcon /> : <ListIcon />}
            onSelect={() => setListId(list.id)}
          />
        ))}
        <div className="spacer" />
        <button type="button" className="nav quiet" disabled title="Settings arrive in M8">
          <span className="tile">
            <SettingsIcon />
          </span>
          <span className="nav-name">Settings</span>
        </button>
      </aside>

      <main className="main">
        <div className="titlebar" />
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

          {view?.mode === 'note' && <pre className="card note">{view.noteText}</pre>}

          {view?.mode === 'tasks' && (
            <>
              <section className="card tasks" aria-label="Tasks">
                {view.items.length === 0 && (
                  <p className="empty">Nothing here yet. Capture with Ctrl+Shift+Space.</p>
                )}
                {view.items.map((item, index) => (
                  <Item
                    key={item.kind === 'task' ? item.task.key : `${item.kind}-${index}`}
                    item={item}
                    selected={selected}
                    onSelect={setSelected}
                    onToggle={(key) => void toggle(key)}
                  />
                ))}
              </section>

              {view.completed.length > 0 && (
                <section className="card completed" aria-label="Completed">
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
                        selected={selected}
                        onSelect={setSelected}
                        onToggle={(key) => void toggle(key)}
                      />
                    ))}
                </section>
              )}
            </>
          )}
        </div>
      </main>

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
}): ReactElement {
  const { list, active, icon, onSelect } = props;
  return (
    <button type="button" className={active ? 'nav on' : 'nav'} onClick={onSelect}>
      <span className={active ? 'tile strong' : 'tile'}>{icon}</span>
      <span className="nav-name">{list.name}</span>
      {list.mode === 'tasks' && <span className="nav-count">{list.open}</span>}
    </button>
  );
}

interface RowHandlers {
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  readonly onToggle: (key: string) => void;
}

function Item(props: RowHandlers & { readonly item: ListItem }): ReactElement {
  const { item } = props;
  if (item.kind === 'heading') return <h2 className="read-heading">{item.text}</h2>;
  if (item.kind === 'text') return <p className="read-text">{item.text}</p>;
  return (
    <>
      <Row {...props} task={item.task} />
      {item.task.subtasks.map((subtask) => (
        <Row key={subtask.key} {...props} task={subtask} subtask />
      ))}
    </>
  );
}

function Row(
  props: RowHandlers & { readonly task: TaskRow; readonly subtask?: boolean },
): ReactElement {
  const { task, subtask = false, selected, onSelect, onToggle } = props;
  const classes = ['row'];
  if (task.key === selected) classes.push('sel');
  if (subtask) classes.push('subtask');
  if (task.done) classes.push('done');
  return (
    <div className={classes.join(' ')} onMouseDown={() => onSelect(task.key)}>
      {!task.done && <div className={`stripe p-${task.priority ?? 'none'}`} />}
      <button
        type="button"
        className={task.done ? 'check on' : 'check'}
        aria-label={task.done ? 'Reopen task' : 'Complete task'}
        onClick={() => onToggle(task.key)}
      >
        {task.done && <CheckIcon />}
      </button>
      {task.code ? (
        <span className="title code-row">
          <span className="code-kind">
            {task.code.kind} · {task.code.lines} {task.code.lines === 1 ? 'line' : 'lines'}
          </span>
          {task.code.peek && <span className="code-peek">{task.code.peek}</span>}
        </span>
      ) : (
        <span className="title">{task.title === '' ? task.label : task.title}</span>
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
