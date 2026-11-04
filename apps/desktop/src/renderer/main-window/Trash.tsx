import { useEffect, useLayoutEffect, useState, type ReactElement } from 'react';
import type { ArchivedList, TrashItem, TrashPreview, TrashView } from '../../shared/ipc.js';
import { BodyBlock } from './Body.js';
import { BackIcon, CheckIcon, CloseIcon, ListIcon, NoteIcon, TaskIcon } from './icons.js';
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

/** D-99: how long "Restore to edit" stays after a try to edit. */
const LOCKED_MS = 4000;

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
  readonly open: string | null;
  readonly onOpen: (id: string) => void;
  readonly onRestore: (id: string) => void;
  readonly onDelete: (id: string) => void;
}): ReactElement {
  const { items, now, open, onOpen, onRestore, onDelete } = props;
  const [asking, setAsking] = useState<string | null>(null);
  const { entries, gone } = usePresence(items, (item) => item.id);
  return (
    <div className="trash-rows">
      {entries.map(({ item, key, leaving }) => (
        <div
          key={key}
          className={[
            'trash-row',
            'opens',
            leaving ? 'leaving' : '',
            open === key ? 'sel' : '',
          ].join(' ')}
          inert={leaving}
          onAnimationEnd={(event) => {
            if (leaving && event.target === event.currentTarget) gone(key);
          }}
          // D-98: a click opens it read-only (not on its buttons).
          onClick={(event) => {
            if (!(event.target as Element).closest('button')) onOpen(item.id);
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

/**
 * D-98: a deleted task, list or note, read-only: its title, its tasks (or a task's subtasks) and its
 * text. Trying to change it (a click on its title or text, a double-click) says "Restore to edit",
 * with Restore, which restores it and opens it where it now is, ready to edit.
 */
export function TrashPreviewView(props: {
  readonly preview: TrashPreview;
  readonly onRestore: () => void;
  readonly onClose: () => void;
  /** As a page (narrow windows): a back arrow instead of the panel's ×. */
  readonly page?: boolean;
}): ReactElement {
  const { preview, onRestore, onClose, page = false } = props;
  // D-99: "Restore to edit" shows for a few seconds after each try, then fades away.
  const [asked, setAsked] = useState(0);
  const [fading, setFading] = useState(false);
  const ask = (): void => {
    setFading(false);
    setAsked((count) => count + 1);
  };
  useEffect(() => {
    if (asked === 0) return;
    const timer = window.setTimeout(() => setFading(true), LOCKED_MS);
    return () => window.clearTimeout(timer);
  }, [asked]);
  const now = new Date();
  const kind = preview.kind === 'task' ? 'Task' : preview.kind === 'note' ? 'Note' : 'List';
  return (
    <div className={page ? 'trash-preview page' : 'trash-preview'}>
      <div className="panel-head">
        {page && (
          <button
            type="button"
            className="panel-button"
            aria-label="Back to Trash"
            title="Back to Trash (Esc)"
            onClick={onClose}
          >
            <BackIcon />
          </button>
        )}
        <span className="panel-label">Deleted {kind.toLowerCase()}</span>
        <span className="panel-meta">
          {preview.from ? `from ${preview.from} · ` : ''}deleted {ago(preview.deleted, now)}
        </span>
        {!page && (
          <span className="panel-actions">
            <button
              type="button"
              className="panel-button"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </span>
        )}
      </div>
      <div className="trash-preview-content" onMouseDown={ask} onDoubleClick={ask}>
        <h2 className="trash-preview-title">{preview.title}</h2>
        {preview.tasks.length > 0 && (
          <ul className="trash-preview-tasks">
            {preview.tasks.map((task, index) => (
              <li
                key={index}
                className={[task.done ? 'done' : '', task.sub ? 'sub' : ''].join(' ')}
              >
                <span className="trash-preview-check">{task.done && <CheckIcon size={10} />}</span>
                {task.title}
              </li>
            ))}
          </ul>
        )}
        {preview.body.trim() !== '' && (
          <BodyBlock
            body={preview.body}
            inline={false}
            editing={false}
            editable={false}
            onEdit={ask}
            onDone={() => undefined}
          />
        )}
      </div>
      {asked > 0 && (
        <div
          key={asked}
          className={fading ? 'trash-locked leaving' : 'trash-locked'}
          role="status"
          onAnimationEnd={(event) => {
            if (fading && event.target === event.currentTarget) setAsked(0);
          }}
        >
          <span>Restore to edit</span>
          <button type="button" className="primary-button" onClick={onRestore}>
            Restore
          </button>
        </div>
      )}
    </div>
  );
}

export function TrashScreen(props: {
  readonly view: TrashView | null;
  /** D-98: the item opened read-only, and whether it shows here as a page (narrow windows). */
  readonly open: TrashPreview | null;
  readonly asPage: boolean;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
  readonly onRestoreToEdit: (id: string) => void;
  readonly onRestore: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onEmpty: () => void;
  readonly onRestoreArchived: (listId: string, key: string) => void;
  /** D-97: "Looking for an older version? Snapshots". */
  readonly onSnapshots: () => void;
  /** D-99: Export Flint folder…, here until Settings → Data (M8). */
  readonly onExport: () => void;
}): ReactElement {
  const { view, open, asPage, onOpen, onClose, onRestoreToEdit, onSnapshots, onExport } = props;
  const { onRestore, onDelete, onEmpty, onRestoreArchived } = props;
  // D-98: Esc closes the opened item (listening before it is painted, so no Esc is missed).
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
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
  if (open && asPage)
    return (
      <TrashPreviewView
        key={open.id}
        preview={open}
        page
        onRestore={() => onRestoreToEdit(open.id)}
        onClose={onClose}
      />
    );
  return (
    <>
      <header className="list-header trash-header">
        <h1>Trash</h1>
        <span className="subtitle">
          Deleted tasks, lists and notes are kept for 30 days, then removed for good. Looking for an
          older version?{' '}
          <button type="button" className="subtitle-link" onClick={onSnapshots}>
            Snapshots
          </button>
          {/* D-99: until Settings → Data (M8). */}
          {' · '}
          <button type="button" className="subtitle-link" onClick={onExport}>
            Export Flint folder…
          </button>
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
                  open={open?.id ?? null}
                  onOpen={onOpen}
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
