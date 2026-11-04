import { useEffect, useState, type ReactElement } from 'react';
import type { SnapshotFile, SnapshotSummary } from '../../shared/ipc.js';
import { ChevronIcon, ListIcon, NoteIcon } from './icons.js';

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
  readonly onRestore: (path: string | null) => void;
}): ReactElement {
  const { id, version, onRestore } = props;
  const [files, setFiles] = useState<readonly SnapshotFile[] | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    void window.flintMain.snapshotFiles(id).then(setFiles);
  }, [id, version]);
  if (!files) return <div className="snapshot-files" />;
  return (
    <div className="snapshot-files">
      {files.map((file) => (
        <div key={file.path} className={`snapshot-file ${file.state}`}>
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

export function SnapshotsScreen(props: {
  /** Anything that changes when the folder does: the list is read again. */
  readonly version: unknown;
  readonly onRestored: (label: string) => void;
}): ReactElement {
  const { version, onRestored } = props;
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
