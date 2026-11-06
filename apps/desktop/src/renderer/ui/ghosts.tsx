/** TASK-06, D-75, D-77: completion and removal ghosts, shared by the main window and mini mode. */
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { durationMs, reducedMotion } from './motion.js';
import type { ListView, TaskRow } from '../../shared/ipc.js';
import { BodyBlock } from '../main-window/Body.js';
import { Row, type RowHandlers } from './Row.js';

/**
 * D-75, D-77: a copy of a row that has just been completed, reopened or removed (deleted, moved to
 * another list, an undone duplicate), playing its animation where the row was, while the task is
 * already in its new place, or gone. Not interactive.
 */
export interface Ghost {
  readonly id: number;
  readonly task: TaskRow;
  readonly subtask: boolean;
  readonly direction: 'complete' | 'reopen' | 'remove';
  /** The open tasks, or Completed. */
  readonly section: 'open' | 'done';
  /** The row it follows in its section (the open tasks, or Completed); null: the first. */
  readonly after: string | null;
  /** D-80: it was expanded: its body closes first, then the row plays out. */
  readonly expanded?: boolean;
}

let ghostSeq = 0;

export const withSubtasks = (tasks: readonly TaskRow[]): TaskRow[] =>
  tasks.flatMap((task) => [task, ...task.subtasks]);

/**
 * The rows that changed sides, or went away, between two views of a list, by any cause (Space,
 * Delete, undo, redo, a reminder's Done): a ghost where each was, and the keys that now ease in at
 * their new place.
 */
export function departed(before: ListView, after: ListView): { ghosts: Ghost[]; moved: string[] } {
  const openTasks = (view: ListView): TaskRow[] =>
    view.items.flatMap((item) => (item.kind === 'task' ? [item.task] : []));
  const nowOpen = new Set(withSubtasks(openTasks(after)).map((row) => row.key));
  const nowDone = new Set(withSubtasks(after.completed).map((row) => row.key));
  const ghosts: Ghost[] = [];
  const moved: string[] = [];
  for (const [tasks, direction, section, there, here] of [
    [openTasks(before), 'complete', 'open', nowDone, nowOpen],
    [before.completed, 'reopen', 'done', nowOpen, nowDone],
  ] as const) {
    const rows = withSubtasks(tasks);
    const gone = (key: string): boolean => !here.has(key) && !there.has(key);
    for (const task of tasks) {
      // The task (its subtasks go with it), or a subtask that moved or went on its own.
      const went: [TaskRow, Ghost['direction']][] =
        there.has(task.key) || gone(task.key)
          ? [[task, there.has(task.key) ? direction : 'remove']]
          : task.subtasks
              .filter((sub) => there.has(sub.key) || gone(sub.key))
              .map((sub) => [sub, there.has(sub.key) ? direction : 'remove']);
      for (const [row, how] of went) {
        const index = rows.indexOf(row);
        const previous = rows
          .slice(0, index)
          .reverse()
          .find((other) => here.has(other.key));
        ghosts.push({
          id: ++ghostSeq,
          task: row,
          subtask: row !== task,
          direction: how,
          section,
          after: previous?.key ?? null,
        });
        if (how !== 'remove')
          moved.push(row.key, ...(row === task ? task.subtasks.map((sub) => sub.key) : []));
      }
    }
  }
  return { ghosts, moved };
}

/** The ghosts of a section that follow row `after` (null: the section's first rows), D-75. */
export function ghostRows(
  ghosts: readonly Ghost[],
  section: Ghost['section'],
  after: string | null,
  handlers: RowHandlers,
  /** D-110: mini mode's compact rows. */
  variant?: 'compact',
): ReactElement[] {
  const size = variant ? { variant } : {};
  return ghosts
    .filter((ghost) => ghost.section === section && ghost.after === after)
    .flatMap((ghost) => [
      ghost.expanded ? (
        // D-80: an expanded task leaves as its card: the body closes, then the row plays out.
        <div
          key={`ghost-${ghost.id}`}
          className={ghost.subtask ? 'row-group subtask leaving-group' : 'row-group leaving-group'}
          aria-hidden="true"
        >
          <Row
            task={ghost.task}
            subtask={ghost.subtask}
            ghost={ghost.direction}
            {...handlers}
            {...size}
          />
          <div className={ghost.subtask ? 'row-body subtask closing' : 'row-body closing'}>
            <BodyBlock
              body={ghost.task.body}
              inline
              editing={false}
              editable={false}
              onEdit={() => undefined}
              onDone={() => undefined}
            />
          </div>
        </div>
      ) : (
        <Row
          key={`ghost-${ghost.id}`}
          task={ghost.task}
          subtask={ghost.subtask}
          ghost={ghost.direction}
          {...handlers}
          {...size}
        />
      ),
      ...(ghost.subtask ? [] : ghost.task.subtasks).map((sub) => (
        <Row
          key={`ghost-${ghost.id}-${sub.key}`}
          task={sub}
          subtask
          ghost={ghost.direction}
          {...handlers}
          {...size}
        />
      )),
    ]);
}

/**
 * D-110: the same ghosts for a plain run of rows made from views (mini mode's Today and Inbox): a
 * row that left plays its completion (or, not done, its removal) where it was, and a row that
 * arrived eases in (`return`: it was completed here a moment ago, so undo brings it back). A new
 * `scope` (another tab) starts afresh. Nothing waits for the animations; none with reduce-motion.
 */
export function useRowGhosts(
  rows: readonly TaskRow[],
  scope: string,
  isDone: (key: string) => boolean,
): { readonly ghosts: readonly Ghost[]; readonly fresh: ReadonlyMap<string, 'new' | 'return'> } {
  const [ghosts, setGhosts] = useState<readonly Ghost[]>([]);
  const [fresh, setFresh] = useState<ReadonlyMap<string, 'new' | 'return'>>(new Map());
  const last = useRef<{ scope: string; rows: readonly TaskRow[] } | null>(null);
  const left = useRef(new Set<string>());
  const done = useRef(isDone);
  done.current = isDone;
  const keys = rows.map((row) => row.key).join('\n');
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { scope, rows };
    if (!before || before.scope !== scope) {
      setGhosts([]);
      setFresh(new Map());
      left.current.clear();
      return;
    }
    if (reducedMotion()) return;
    const here = new Set(rows.map((row) => row.key));
    const was = new Set(before.rows.map((row) => row.key));
    const went: Ghost[] = [];
    before.rows.forEach((row, index) => {
      if (here.has(row.key)) return;
      const previous = before.rows
        .slice(0, index)
        .reverse()
        .find((other) => here.has(other.key));
      const complete = done.current(row.key);
      if (complete) left.current.add(row.key);
      went.push({
        id: ++ghostSeq,
        task: row,
        subtask: false,
        direction: complete ? 'complete' : 'remove',
        section: 'open',
        after: previous?.key ?? null,
      });
    });
    const arrived = new Map<string, 'new' | 'return'>();
    for (const row of rows)
      if (!was.has(row.key)) {
        arrived.set(row.key, left.current.has(row.key) ? 'return' : 'new');
        left.current.delete(row.key);
      }
    if (went.length > 0) {
      setGhosts((current) => [...current, ...went]);
      const ids = new Set(went.map((ghost) => ghost.id));
      window.setTimeout(
        () => setGhosts((current) => current.filter((ghost) => !ids.has(ghost.id))),
        durationMs('--fl-dur-complete', 360),
      );
    }
    if (arrived.size > 0) {
      setFresh((current) => new Map([...current, ...arrived]));
      window.setTimeout(
        () => setFresh((current) => new Map([...current].filter(([key]) => !arrived.has(key)))),
        durationMs('--fl-dur-complete', 360),
      );
    }
  }, [keys, scope]);
  return { ghosts, fresh };
}
