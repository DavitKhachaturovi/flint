import { useRef, type ReactElement } from 'react';
import type { TaskRow } from '../../shared/ipc.js';
import { Glide } from '../ui/Glide.js';
import { ghostRows, useRowGhosts } from '../ui/ghosts.js';
import { Row, type Point, type RowHandlers } from '../ui/Row.js';
import { watchDrag } from '../ui/drag.js';
import { rowDragUnits } from '../ui/row-drag.js';

const NONE: ReadonlySet<string> = new Set();
const NO_JOINS: ReadonlyMap<string, { readonly up: boolean; readonly down: boolean }> = new Map();
const nothing = (): void => undefined;

/**
 * D-109, D-110: a mini tab's rows: the main window's task rows in their compact size, with its
 * gliding selection, completion animation (the row plays out where it was) and its locked, springy
 * drag. A click selects, a double-click opens the task in the main window; the checkbox completes;
 * right-click: Complete, Pin/Unpin, Open in Flint. Only `draggable` rows move (Today: the pinned
 * ones; its reminders keep their time order).
 */
export function MiniList(props: {
  readonly rows: readonly TaskRow[];
  /** The tab: switching starts afresh (no ghosts from the other tab). */
  readonly scope: string;
  readonly selected: string | null;
  readonly draggable: (key: string) => boolean;
  readonly isDone: (key: string) => boolean;
  readonly onSelect: (key: string) => void;
  readonly onToggle: (key: string) => void;
  readonly onPin: (task: TaskRow, pinned: boolean) => void;
  readonly onMute: (key: string, muted: boolean) => void;
  readonly onMenu: (task: TaskRow, at: Point) => void;
  readonly onOpen: (task: TaskRow) => void;
  /** A drop: the task before or after another one. */
  readonly onPlace: (
    key: string,
    where: { readonly at: 'before' | 'after'; readonly key: string },
  ) => Promise<boolean>;
}): ReactElement {
  const { rows, scope, selected, draggable, isDone, onPlace } = props;
  const card = useRef<HTMLDivElement>(null);
  const { ghosts, fresh } = useRowGhosts(rows, scope, isDone);
  const handlers: RowHandlers = {
    selected,
    editing: null,
    onSelect: (key) => props.onSelect(key),
    marked: NONE,
    markJoins: NO_JOINS,
    onToggle: props.onToggle,
    onEdit: nothing,
    onLeaveTask: nothing,
    onTab: nothing,
    onMenu: props.onMenu,
    onMute: props.onMute,
    onPin: props.onPin,
    onReminder: nothing,
    expanded: NONE,
    onBody: nothing,
    onImages: nothing,
    onHome: nothing,
  };

  // TASK-01, D-54: the main window's drag, among the rows that may move.
  const startDrag = (event: React.MouseEvent): void => {
    const element = card.current;
    if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || !element) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea')) return;
    const row = target.closest<HTMLElement>('.row[data-key]');
    if (!row || row.matches('.done, .leaving') || !draggable(row.dataset['key'] ?? '')) return;
    const units = rowDragUnits(element, row);
    if (!units) return;
    const peers = units.peers.filter((peer) => draggable(peer.key));
    const others = peers.filter((peer) => peer !== units.unit);
    watchDrag(event.nativeEvent, {
      unit: units.unit,
      peers,
      scroller: element.closest<HTMLElement>('.mini-body'),
      onDrop: async (index) => {
        const next = others[index];
        const last = others.at(-1);
        const where = next
          ? ({ at: 'before', key: next.key } as const)
          : last
            ? ({ at: 'after', key: last.key } as const)
            : null;
        if (!where) return false;
        return onPlace(units.unit.key, where);
      },
    });
  };

  const items: ReactElement[] = [...ghostRows(ghosts, 'open', null, handlers, 'compact')];
  for (const task of rows) {
    items.push(
      <Row
        key={task.key}
        task={task}
        variant="compact"
        fresh={fresh.get(task.key)}
        onActivate={props.onOpen}
        {...handlers}
      />,
      ...ghostRows(ghosts, 'open', task.key, handlers, 'compact'),
    );
  }
  return (
    <div className="mini-rows" ref={card} role="list" onMouseDown={startDrag}>
      <Glide
        card={card}
        target={rows.some((row) => row.key === selected) ? selected : null}
        version={`${scope}:${rows.map((row) => row.key).join(',')}:${ghosts.length}`}
      />
      {items}
    </div>
  );
}
