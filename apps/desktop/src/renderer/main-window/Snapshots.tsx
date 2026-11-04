import { useEffect, useState, type ReactElement } from 'react';
import type { SnapshotDiff, SnapshotFile, SnapshotSummary } from '../../shared/ipc.js';
import { BackIcon, CheckIcon, ChevronIcon, CloseIcon, ListIcon, NoteIcon } from './icons.js';

/**
 * The Snapshots view (DATA-04, D-97): the copies Flint keeps of the Flint folder, by day, newest
 * first. A snapshot opens to its lists and notes, each saying how it compares with now; one is
 * restored on its own, or everything is (asked inline). A restore takes a fresh snapshot first and
 * is one undo step. Reached from the tray's Restore from a snapshot… and from Trash.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(at: string, now: Date): string {
  const [year, month, date] = at.slice(0, 10).split('-').map(Number);
  const when = new Date(year ?? 0, (month ?? 1) - 1, date ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (when.getTime() === today) return 'Today';
  if (when.getTime() === today - 86_400_000) return 'Yesterday';
  return `${when.toLocaleDateString('en-GB', { weekday: 'short' })} ${when.getDate()} ${MONTHS[when.getMonth()] ?? ''}`;
}

const STATES = { changed: 'Changed since', deleted: 'Deleted since', same: 'Same as now' } as const;

function SnapshotFiles(props: {
  readonly id: string;
  readonly version: unknown;
  readonly open: string | null;
  readonly onOpen: (path: string) => void;
  readonly onRestore: (path: string | null) => void;
}): ReactElement {
  const { id, version, open, onOpen, onRestore } = props;
  const [files, setFiles] = useState<readonly SnapshotFile[] | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    void window.flintMain.snapshotFiles(id).then(setFiles);
  }, [id, version]);
  if (!files) return <div className="snapshot-files" />;
  return (
    <div className="snapshot-files">
      {files.map((file) => (
        <div
          key={file.path}
          className={[
            'snapshot-file',
            file.state,
            file.state !== 'same' ? 'opens' : '',
            open === file.path ? 'sel' : '',
          ].join(' ')}
          // D-99: a changed or deleted one opens its comparison with now.
          onClick={(event) => {
            if (file.state !== 'same' && !(event.target as Element).closest('button'))
              onOpen(file.path);
          }}
        >
          <span className="tile">{file.kind === 'note' ? <NoteIcon /> : <ListIcon />}</span>
          <span className="trash-title">{file.name}</span>
          <span className="snapshot-state">{STATES[file.state]}</span>
          {file.state !== 'same' && (
            <button type="button" className="trash-action" onClick={() => onRestore(file.path)}>
              Restore
            </button>
          )}
        </div>
      ))}
      <div className="snapshot-all">
        {asking ? (
          <span className="trash-confirm" role="group" aria-label="Restore everything?">
            <span className="trash-confirm-text">
              Replace the whole Flint folder with this snapshot? How it is now is kept as a snapshot
              first.
            </span>
            <button
              type="button"
              className="trash-action danger"
              onClick={() => {
                setAsking(false);
                onRestore(null);
              }}
            >
              Restore everything
            </button>
            <button type="button" className="trash-action" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="trash-action" onClick={() => setAsking(true)}>
            Restore everything…
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * D-99: a list or note in a snapshot against now. A task list by task: added since, deleted since,
 * changed (and what), each chosen with its checkbox, "Restore N tasks" and "Restore whole list";
 * a note line by line, "Restore this note" or "Keep current"; one deleted since as it was, with
 * Restore. Every restore takes a fresh snapshot first and is one undo step.
 */
export function SnapshotDiffView(props: {
  readonly diff: SnapshotDiff;
  /** When the snapshot was taken, `15:41` or `Mon 2 Nov 15:41`. */
  readonly when: string;
  readonly page?: boolean;
  readonly onRestoreTasks: (keys: readonly string[]) => void;
  readonly onRestoreAll: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const { diff, when, page = false, onRestoreTasks, onRestoreAll, onClose } = props;
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const head = (
    <div className="panel-head">
      {page && (
        <button
          type="button"
          className="panel-button"
          aria-label="Back to Snapshots"
          title="Back to Snapshots (Esc)"
          onClick={onClose}
        >
          <BackIcon />
        </button>
      )}
      <span className="panel-label">
        {diff.kind === 'deleted' ? 'Deleted since' : 'Changes since'} {when}
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
  );
  const STATE = { added: 'Added since', deleted: 'Deleted since', changed: 'Changed' } as const;
  return (
    <div className={page ? 'snapshot-diff page' : 'snapshot-diff'}>
      {head}
      <h2 className="trash-preview-title">{diff.name}</h2>
      {diff.kind === 'list' && (
        <>
          {diff.tasks.length === 0 ? (
            <p className="panel-empty">Its tasks are as they were.</p>
          ) : (
            <ul className="diff-tasks">
              {diff.tasks.map((task) => (
                <li key={task.key} className={`diff-task ${task.state}`}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={chosen.has(task.key)}
                    aria-label={`Restore ${task.title}`}
                    className={chosen.has(task.key) ? 'diff-check on' : 'diff-check'}
                    onClick={() => toggle(task.key)}
                  >
                    {chosen.has(task.key) && <CheckIcon size={10} />}
                  </button>
                  <span className="diff-task-text">
                    <span className="diff-task-title">{task.title}</span>
                    <span className="diff-task-state">
                      {STATE[task.state]}
                      {task.changes.length > 0 && `: ${task.changes.join(', ')}`}
                      {task.state === 'added' && ' (restoring removes it)'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="diff-actions">
            <button type="button" className="trash-action" onClick={onRestoreAll}>
              Restore whole list
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={chosen.size === 0}
              onClick={() => onRestoreTasks([...chosen])}
            >
              {chosen.size === 0
                ? 'Restore chosen tasks'
                : `Restore ${chosen.size === 1 ? '1 task' : `${chosen.size} tasks`}`}
            </button>
          </div>
        </>
      )}
      {diff.kind === 'note' && (
        <>
          <div className="diff-lines" role="list">
            {diff.lines.map((line, index) => (
              <div key={index} role="listitem" className={`diff-line ${line.kind}`}>
                <span className="diff-mark" aria-hidden="true">
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
                </span>
                <span className="diff-text">{line.text || ' '}</span>
              </div>
            ))}
          </div>
          <div className="diff-actions">
            <button type="button" className="trash-action" onClick={onClose}>
              Keep current
            </button>
            <button type="button" className="primary-button" onClick={onRestoreAll}>
              Restore this note
            </button>
          </div>
        </>
      )}
      {diff.kind === 'deleted' && (
        <>
          {diff.mode === 'note' ? (
            <div className="diff-lines">
              {diff.text.split(/\r?\n/).map((line, index) => (
                <div key={index} className="diff-line same">
                  <span className="diff-mark" aria-hidden="true" />
                  <span className="diff-text">{line || ' '}</span>
                </div>
              ))}
            </div>
          ) : (
            <ul className="trash-preview-tasks">
              {diff.tasks.map((task, index) => (
                <li
                  key={index}
                  className={[task.done ? 'done' : '', task.sub ? 'sub' : ''].join(' ')}
                >
                  <span className="trash-preview-check">
                    {task.done && <CheckIcon size={10} />}
                  </span>
                  {task.title}
                </li>
              ))}
            </ul>
          )}
          <div className="diff-actions">
            <button type="button" className="primary-button" onClick={onRestoreAll}>
              Restore
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function SnapshotsScreen(props: {
  /** Anything that changes when the folder does: the list is read again. */
  readonly version: unknown;
  readonly onRestored: (label: string) => void;
  /** D-99: the comparison opened (a page here on narrow windows; else the side panel). */
  readonly openFile: { readonly id: string; readonly path: string } | null;
  readonly page: ReactElement | null;
  readonly onOpenFile: (id: string, path: string, when: string) => void;
}): ReactElement {
  const { version, onRestored, openFile, page, onOpenFile } = props;
  const [snapshots, setSnapshots] = useState<readonly SnapshotSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Opened once, its files stay rendered, so its fold can ease closed too.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    void window.flintMain.snapshots().then(setSnapshots);
  }, [version]);
  const now = new Date();
  const days: { label: string; items: SnapshotSummary[] }[] = [];
  for (const snapshot of snapshots ?? []) {
    const label = dayLabel(snapshot.at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(snapshot);
    else days.push({ label, items: [snapshot] });
  }
  if (page) return page;
  const restore = (id: string, path: string | null): void => {
    void window.flintMain.restoreSnapshot(id, path).then((label) => {
      if (label) onRestored(label);
    });
  };
  return (
    <>
      <header className="list-header trash-header">
        <h1>Snapshots</h1>
        <span className="subtitle">
          A copy of your Flint folder, every hour something changes (kept 48 hours), then once a day
          (kept 30 days). They stay on this computer.
        </span>
      </header>
      <div className="trash-panel">
        {snapshots && days.length === 0 && (
          <p className="empty trash-empty">
            No snapshots yet. The first is taken soon after something changes.
          </p>
        )}
        {days.map((day) => (
          <section key={day.label} className="card trash-group" aria-label={day.label}>
            <div className="panel-label trash-group-label">{day.label}</div>
            <div className="trash-rows">
              {day.items.map((snapshot) => (
                <div key={snapshot.id} className="snapshot">
                  <button
                    type="button"
                    className={open === snapshot.id ? 'snapshot-head open' : 'snapshot-head'}
                    aria-expanded={open === snapshot.id}
                    onClick={() => {
                      setOpened((current) => new Set([...current, snapshot.id]));
                      setOpen(open === snapshot.id ? null : snapshot.id);
                    }}
                  >
                    <span className={open === snapshot.id ? 'chev open' : 'chev'}>
                      <ChevronIcon size={10} />
                    </span>
                    <span className="snapshot-time">{snapshot.at.slice(11, 16)}</span>
                    <span className="trash-meta">
                      {snapshot.differs === 0
                        ? 'same as now'
                        : `${snapshot.differs} ${snapshot.differs === 1 ? 'list differs' : 'lists differ'} from now`}
                    </span>
                  </button>
                  <div
                    className={open === snapshot.id ? 'today-fold open' : 'today-fold'}
                    inert={open !== snapshot.id}
                  >
                    <div className="today-fold-inner">
                      {opened.has(snapshot.id) && (
                        <SnapshotFiles
                          id={snapshot.id}
                          version={version}
                          open={openFile?.id === snapshot.id ? openFile.path : null}
                          onOpen={(path) =>
                            onOpenFile(
                              snapshot.id,
                              path,
                              `${day.label} ${snapshot.at.slice(11, 16)}`,
                            )
                          }
                          onRestore={(path) => restore(snapshot.id, path)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
