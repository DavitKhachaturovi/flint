import { useState, type ReactElement } from 'react';
import type { ArchivedList, TrashItem, TrashView } from '../../shared/ipc.js';
import { CheckIcon, ListIcon, NoteIcon, TaskIcon } from './icons.js';
import { usePresence } from './Today.js';

/**
 * The Trash view (DATA-02, TASK-06, D-97): what was deleted, by day, newest first, with Restore
 * and Delete now (asked inline), and Empty Trash; a second tab, Archived, has the auto-archived
 * completed tasks by list, each restorable. Rows that go ease out; the tabs crossfade.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD[THH:MM]` as a local date. */
function localDate(stamp: string): Date {
  const [day = '', time = '00:00'] = stamp.split('T');
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0);
}

/** "Today", "Yesterday", "Mon 2 Nov". */
function dayLabel(stamp: string, now: Date): string {
  const when = localDate(stamp);
  const day = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return 'Today';
  if (day === today - 86_400_000) return 'Yesterday';
  const weekday = when.toLocaleDateString('en-GB', { weekday: 'short' });
  return `${weekday} ${when.getDate()} ${MONTHS[when.getMonth()] ?? ''}`;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "3 days ago". */
function ago(stamp: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - localDate(stamp).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function shortDate(stamp: string): string {
  const when = localDate(stamp);
  return `${when.getDate()} ${MONTHS[when.getMonth()] ?? ''}`;
}

/** An action asked inline before it happens ("Delete forever?" Delete · Cancel). */
function Confirm(props: {
  readonly question: string;
  readonly yes: string;
  readonly onYes: () => void;
  readonly onNo: () => void;
}): ReactElement {
  return (
    <span className="trash-confirm" role="group" aria-label={props.question}>
      <span className="trash-confirm-text">{props.question}</span>
      <button type="button" className="trash-action danger" onClick={props.onYes}>
        {props.yes}
      </button>
      <button type="button" className="trash-action" onClick={props.onNo}>
        Cancel
      </button>
    </span>
  );
}

function DeletedRows(props: {
  readonly items: readonly TrashItem[];
  readonly now: Date;
  readonly onRestore: (id: string) => void;
  readonly onDelete: (id: string) => void;
}): ReactElement {
  const { items, now, onRestore, onDelete } = props;
  const [asking, setAsking] = useState<string | null>(null);
  const { entries, gone } = usePresence(items, (item) => item.id);
  return (
    <div className="trash-rows">
      {entries.map(({ item, key, leaving }) => (
        <div
          key={key}
          className={leaving ? 'trash-row leaving' : 'trash-row'}
          inert={leaving}
          onAnimationEnd={(event) => {
            if (leaving && event.target === event.currentTarget) gone(key);
          }}
        >
          <span className="tile">
            {item.kind === 'task' ? (
              <TaskIcon />
            ) : item.kind === 'note' ? (
              <NoteIcon />
            ) : (
              <ListIcon />
            )}
          </span>
          <span className="trash-title">{item.title}</span>
          <span className="trash-meta">
            {item.kind === 'task'
              ? `from ${item.from ?? 'a list'}`
              : item.kind === 'note'
                ? 'Note'
                : 'List'}{' '}
            · deleted {ago(item.deleted, now)}
          </span>
          {asking === item.id ? (
            <Confirm
              question="Delete forever?"
              yes="Delete"
              onYes={() => {
                setAsking(null);
                onDelete(item.id);
              }}
              onNo={() => setAsking(null)}
            />
          ) : (
            <span className="trash-actions">
              <button type="button" className="trash-action" onClick={() => onRestore(item.id)}>
                Restore
              </button>
              <button type="button" className="trash-action" onClick={() => setAsking(item.id)}>
                Delete now
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ArchivedRows(props: {
  readonly list: ArchivedList;
  readonly onRestore: (listId: string, key: string) => void;
}): ReactElement {
  const { list, onRestore } = props;
  const { entries, gone } = usePresence(list.tasks, (task) => task.key);
  return (
    <div className="trash-rows">
      {entries.map(({ item, key, leaving }) => (
        <div
          key={key}
          className={leaving ? 'trash-row leaving' : 'trash-row'}
          inert={leaving}
          onAnimationEnd={(event) => {
            if (leaving && event.target === event.currentTarget) gone(key);
          }}
        >
          <span className="tile">
            <CheckIcon />
          </span>
          <span className="trash-title done">{item.title}</span>
          <span className="trash-meta">
            {item.completed ? `completed ${shortDate(item.completed)}` : 'completed'}
          </span>
          <span className="trash-actions">
            <button
              type="button"
              className="trash-action"
              onClick={() => onRestore(list.listId, item.key)}
            >
              Restore
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

export function TrashScreen(props: {
  readonly view: TrashView | null;
  readonly onRestore: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onEmpty: () => void;
  readonly onRestoreArchived: (listId: string, key: string) => void;
}): ReactElement {
  const { view, onRestore, onDelete, onEmpty, onRestoreArchived } = props;
  const [tab, setTab] = useState<'deleted' | 'archived'>('deleted');
  const [emptying, setEmptying] = useState(false);
  const now = new Date();
  const deleted = view?.deleted ?? [];
  const archived = view?.archived ?? [];
  const archivedCount = archived.reduce((sum, list) => sum + list.tasks.length, 0);
  const days: { label: string; items: TrashItem[] }[] = [];
  for (const item of deleted) {
    const label = dayLabel(item.deleted, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(item);
    else days.push({ label, items: [item] });
  }
  return (
    <>
      <header className="list-header trash-header">
        <h1>Trash</h1>
        <span className="subtitle">
          Deleted tasks, lists and notes are kept for 30 days, then removed for good.
        </span>
      </header>
      <div className="trash-bar">
        <div className="trash-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'deleted'}
            className={tab === 'deleted' ? 'trash-tab on' : 'trash-tab'}
            onClick={() => setTab('deleted')}
          >
            Deleted · {deleted.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'archived'}
            className={tab === 'archived' ? 'trash-tab on' : 'trash-tab'}
            onClick={() => setTab('archived')}
          >
            Archived · {archivedCount}
          </button>
        </div>
        {tab === 'deleted' &&
          deleted.length > 0 &&
          (emptying ? (
            <Confirm
              question={`Delete ${deleted.length === 1 ? 'this item' : `all ${deleted.length} items`} forever?`}
              yes="Empty Trash"
              onYes={() => {
                setEmptying(false);
                onEmpty();
              }}
              onNo={() => setEmptying(false)}
            />
          ) : (
            <button type="button" className="trash-action" onClick={() => setEmptying(true)}>
              Empty Trash
            </button>
          ))}
      </div>
      <div className="trash-panel" key={tab}>
        {tab === 'deleted' ? (
          days.length === 0 ? (
            <p className="empty trash-empty">Trash is empty.</p>
          ) : (
            days.map((day) => (
              <section key={day.label} className="card trash-group" aria-label={day.label}>
                <div className="panel-label trash-group-label">{day.label}</div>
                <DeletedRows
                  items={day.items}
                  now={now}
                  onRestore={onRestore}
                  onDelete={onDelete}
                />
              </section>
            ))
          )
        ) : archived.length === 0 ? (
          <p className="empty trash-empty">
            Nothing archived. With auto-archive on, completed tasks move here after 14 days.
          </p>
        ) : (
          archived.map((list) => (
            <section key={list.listId} className="card trash-group" aria-label={list.listName}>
              <div className="panel-label trash-group-label">
                {list.listName} · {list.tasks.length}
              </div>
              <ArchivedRows list={list} onRestore={onRestoreArchived} />
            </section>
          ))
        )}
      </div>
    </>
  );
}
