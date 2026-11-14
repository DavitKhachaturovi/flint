/**
 * Google Drive sync in the main window (SYNC-01, D-161, mockup 13): the status button and its
 * popover, the setup question, Choose what syncs, the stop dialog and sync's other questions. The
 * status comes from main (`useSync`); every change goes back as a `SyncAction`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  syncCounts,
  syncedAgo,
  type SyncAction,
  type SyncEverythingPreview,
  type SyncStatusView,
} from '../../shared/sync.js';
import type { ListSummary, SidebarItem } from '../../shared/ipc.js';
import { createPortal } from 'react-dom';
import { CloudIcon, type CloudMark } from './icons.js';

export const SYNC_OFF: SyncStatusView = {
  phase: 'unavailable',
  email: null,
  lastSync: null,
  folderId: null,
  folderPath: null,
  mode: null,
  synced: [],
  syncedGroups: [],
  notices: [],
  problem: null,
  conflicts: [],
  remoteOnly: [],
  remoteGroups: [],
  linked: {},
  device: '',
  connectError: null,
  devices: [],
  newer: [],
};

/** Sync's status for any component (the sidebar's clouds, headers, the editor's conflict cards). */
export const SyncContext = createContext<SyncStatusView>(SYNC_OFF);

export function useSyncStatus(): SyncStatusView {
  return useContext(SyncContext);
}

/** Main's status, kept current. */
export function useSync(): SyncStatusView {
  const [status, setStatus] = useState<SyncStatusView>(SYNC_OFF);
  useEffect(() => {
    void window.flintMain.syncStatus().then(setStatus);
    window.flintMain.onSyncChanged(setStatus);
  }, []);
  return status;
}

export function act(action: SyncAction): Promise<void> {
  return window.flintMain.syncAct(action);
}

export function isConnected(status: SyncStatusView): boolean {
  return ['synced', 'syncing', 'offline', 'attention'].includes(status.phase);
}

/** Whether a list or note syncs on this PC. */
export function listSyncs(status: SyncStatusView, id: string): boolean {
  return isConnected(status) && status.synced.includes(id);
}

export function groupSyncs(status: SyncStatusView, id: string): boolean {
  return isConnected(status) && status.syncedGroups.includes(id);
}

/** The status button's mark: synced, syncing, offline, needs attention; plain before connecting. */
export function cloudMark(status: SyncStatusView): CloudMark {
  switch (status.phase) {
    case 'synced':
      return 'check';
    case 'syncing':
      return 'arrow';
    case 'offline':
      return 'slash';
    case 'attention':
      return 'alert';
    default:
      return 'none';
  }
}

/** A minute's tick, for "2 min ago". */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** "3 lists, 1 note and 1 group" for what syncs on this PC. */
export function syncSummary(
  status: SyncStatusView,
  lists: readonly ListSummary[],
  and = true,
): string {
  const synced = lists.filter((list) => status.synced.includes(list.id));
  return syncCounts(
    synced.filter((list) => list.mode === 'tasks').length,
    synced.filter((list) => list.mode === 'note').length,
    status.syncedGroups.length,
    and,
  );
}

/** Settings' Chosen items line: "Personal (Groceries, Watch list, Trip ideas), Reading." */
export function chosenNames(
  status: SyncStatusView,
  lists: readonly ListSummary[],
  items: readonly SidebarItem[],
): string {
  const name = (id: string): string => lists.find((list) => list.id === id)?.name ?? '';
  const parts: string[] = [];
  const inGroups = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'group' || !status.syncedGroups.includes(item.id)) continue;
    const members = item.lists.filter((id) => status.synced.includes(id));
    members.forEach((id) => inGroups.add(id));
    parts.push(`${item.name}${members.length > 0 ? ` (${members.map(name).join(', ')})` : ''}`);
  }
  for (const list of lists) {
    if (status.synced.includes(list.id) && !inGroups.has(list.id)) parts.push(list.name);
  }
  return parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing yet.';
}

/** The popover's state line. */
function stateLine(status: SyncStatusView): { title: string; detail: string } {
  switch (status.phase) {
    case 'syncing':
      return { title: 'Syncing…', detail: status.email ?? '' };
    case 'offline':
      return { title: 'Offline', detail: "Changes sync when you're back" };
    case 'attention':
      return { title: 'Needs attention', detail: status.problem?.message ?? '' };
    default:
      return { title: 'Synced', detail: '' };
  }
}

/** A floating layer that closes on a click outside or Esc (the popover). */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const down = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [ref, onClose]);
}

/**
 * The sync status button, left of the sort and + buttons: a click opens the popover; before Drive
 * is connected it opens Settings → Sync.
 */
export function SyncButton(props: {
  readonly status: SyncStatusView;
  readonly lists: readonly ListSummary[];
  readonly onSettings: () => void;
  readonly onOpen: (listId: string) => void;
}): ReactElement {
  const { status, lists, onSettings, onOpen } = props;
  const [open, setOpen] = useState<DOMRect | null>(null);
  const label =
    status.phase === 'synced'
      ? 'Synced with Google Drive'
      : status.phase === 'syncing'
        ? 'Syncing with Google Drive'
        : status.phase === 'offline'
          ? 'Offline'
          : status.phase === 'attention'
            ? 'Sync needs attention'
            : 'Sync with Google Drive';
  return (
    <>
      <button
        type="button"
        className={
          open ? `sync-button on phase-${status.phase}` : `sync-button phase-${status.phase}`
        }
        aria-label={label}
        title={label}
        onClick={(event) => {
          if (!isConnected(status)) {
            onSettings();
            return;
          }
          setOpen(open ? null : event.currentTarget.getBoundingClientRect());
        }}
      >
        <span className="sync-cloud" key={status.phase}>
          <CloudIcon size={16} width={1.9} mark={cloudMark(status)} />
        </span>
        {status.phase === 'attention' && <span className="sync-dot" />}
      </button>
      {open &&
        createPortal(
          <SyncPopover
            at={open}
            status={status}
            lists={lists}
            onClose={() => setOpen(null)}
            onSettings={() => {
              setOpen(null);
              onSettings();
            }}
            onOpen={(id) => {
              setOpen(null);
              onOpen(id);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function SyncPopover(props: {
  readonly at: DOMRect;
  readonly status: SyncStatusView;
  readonly lists: readonly ListSummary[];
  readonly onClose: () => void;
  readonly onSettings: () => void;
  readonly onOpen: (listId: string) => void;
}): ReactElement {
  const { at, status, lists, onClose, onSettings, onOpen } = props;
  const card = useRef<HTMLDivElement>(null);
  useDismiss(card, onClose);
  const now = useMinute();
  const line = stateLine(status);
  const detail =
    status.phase === 'synced'
      ? `${syncedAgo(status.lastSync, now)}${status.email ? ` · ${status.email}` : ''}`
      : line.detail;
  const problem = status.problem;
  return (
    <div
      ref={card}
      className="sync-popover"
      role="dialog"
      aria-label="Google Drive sync"
      style={{ left: Math.max(8, at.left - 100), top: at.bottom + 6 }}
    >
      <div className="sync-popover-head">
        <span className="tile strong sync-popover-tile">
          <CloudIcon size={15} mark={cloudMark(status)} />
        </span>
        <div className="sync-popover-state">
          <span className="sync-popover-title">{line.title}</span>
          <span className="sync-popover-detail">{detail}</span>
        </div>
      </div>
      <p className="sync-popover-summary">
        {syncSummary(status, lists)} {syncSummary(status, lists) === 'Nothing' ? 'syncs' : 'sync'}{' '}
        with Google Drive. Everything else stays on this PC.
      </p>
      {(status.conflicts.length > 0 || status.newer.length > 0 || problem) && (
        <div className="sync-popover-more">
          {status.conflicts.map((conflict) => (
            <button
              key={conflict.listId}
              type="button"
              className="sync-popover-row"
              onClick={() => onOpen(conflict.listId)}
            >
              {conflict.count === 1 ? '1 conflict' : `${conflict.count} conflicts`} in{' '}
              {conflict.name}
            </button>
          ))}
          {status.newer.map((item) => (
            <button
              key={item.listId}
              type="button"
              className="sync-popover-row"
              onClick={() => onOpen(item.listId)}
            >
              {item.name} needs a newer Flint
            </button>
          ))}
          {problem && <ProblemRow problem={problem} />}
        </div>
      )}
      <div className="sync-popover-foot">
        <button type="button" className="quiet-button" onClick={onSettings}>
          Sync settings…
        </button>
        <button
          type="button"
          className="primary-button small"
          disabled={status.phase === 'syncing'}
          onClick={() => void act({ kind: 'sync-now' })}
        >
          Sync now
        </button>
      </div>
    </div>
  );
}

/** A problem and the one action that fixes it (D-161 Q8). */
export function ProblemRow(props: {
  readonly problem: NonNullable<SyncStatusView['problem']>;
}): ReactElement {
  const { problem } = props;
  if (problem.kind === 'update') {
    // SYNC-02 (D-166): Drive's folder needs a newer Flint; nothing here changes meanwhile.
    return (
      <div className="sync-problem">
        <span>
          Update Flint to keep syncing.{' '}
          {problem.raisedBy
            ? `The Flint folder in Drive was updated by ${problem.raisedBy}.`
            : 'The Flint folder in Drive was updated by a newer Flint.'}
        </span>
        <button
          type="button"
          className="secondary-button small"
          onClick={() => void act({ kind: 'update-flint' })}
        >
          Update Flint
        </button>
      </div>
    );
  }
  if (problem.kind === 'auth') {
    return (
      <div className="sync-problem">
        <span>Needs attention · sign in again</span>
        <button
          type="button"
          className="secondary-button small"
          onClick={() => void act({ kind: 'connect' })}
        >
          Sign in again
        </button>
      </div>
    );
  }
  if (problem.kind === 'folder-gone') {
    return (
      <div className="sync-problem">
        <span>The Flint folder is in Drive's trash</span>
        <span className="sync-problem-actions">
          <button
            type="button"
            className="secondary-button small"
            onClick={() => void act({ kind: 'restore-in-drive' })}
          >
            Restore it in Drive
          </button>
          <button
            type="button"
            className="quiet-button small"
            onClick={() => void act({ kind: 'new-folder' })}
          >
            Start a new folder
          </button>
        </span>
      </div>
    );
  }
  if (problem.kind === 'quota') {
    const files = problem.files ?? [];
    return (
      <div className="sync-problem">
        <span>
          Google Drive is full
          {files.length > 0 &&
            ` · didn't fit: ${files.map((file) => `${file.name}, ${sizeText(file.size)}`).join('; ')}`}
        </span>
      </div>
    );
  }
  return (
    <div className="sync-problem">
      <span>{problem.message}</span>
    </div>
  );
}

function sizeText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** A dialog over a dim, as the palette's layer is (it closes on Esc or a click outside). */
export function SyncDialog(props: {
  readonly label: string;
  readonly className?: string;
  readonly onClose: () => void;
  readonly children: (close: () => void) => ReactNode;
}): ReactElement {
  const { label, onClose, children } = props;
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => card.current?.focus(), []);
  const close = (): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose();
    else setLeaving(true);
  };
  return (
    <div
      className={leaving ? 'palette-layer sync-layer leaving' : 'palette-layer sync-layer'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        className={`palette sync-dialog ${props.className ?? ''}`}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          // The dialog is modal: its keys are its own.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        {children(close)}
      </div>
    </div>
  );
}

/** First-time setup, right after connecting: What should sync? (D-161, mockup "First-time setup"). */
export function SetupDialog(props: {
  readonly status: SyncStatusView;
  readonly onClose: () => void;
}): ReactElement {
  const { status, onClose } = props;
  const [mode, setMode] = useState<'everything' | 'chosen'>('chosen');
  return (
    <SyncDialog label="What should sync?" className="sync-setup" onClose={onClose}>
      {(close) => (
        <>
          <div className="sync-dialog-head">
            <span className="tile strong sync-popover-tile">
              <CloudIcon size={15} mark="check" />
            </span>
            <div className="sync-popover-state">
              <span className="sync-dialog-title">Connected to Google Drive</span>
              <span className="sync-popover-detail">
                {status.email ?? ''} · folder {status.folderPath ?? 'My Drive › Flint'}
              </span>
            </div>
          </div>
          <span className="sync-question">What should sync?</span>
          <div className="sync-options" role="radiogroup" aria-label="What should sync?">
            {(
              [
                [
                  'everything',
                  'Everything',
                  'All lists, notes and groups, and new ones too. Simplest if this is your own computer.',
                ],
                [
                  'chosen',
                  'Only what I choose',
                  'Nothing syncs until you turn it on for a list, note or group (right-click → Sync with Google Drive). Good for a work PC.',
                ],
              ] as const
            ).map(([value, name, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={mode === value ? 'sync-option on' : 'sync-option'}
                onClick={() => setMode(value)}
              >
                <span className="sync-option-name">
                  <span className={mode === value ? 'radio on' : 'radio'} />
                  {name}
                </span>
                <span className="sync-caption">{text}</span>
              </button>
            ))}
          </div>
          <span className="sync-caption">You can change this any time in Settings → Sync.</span>
          <div className="sync-dialog-foot">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void act({ kind: 'mode', mode });
                close();
              }}
            >
              Continue
            </button>
          </div>
        </>
      )}
    </SyncDialog>
  );
}

interface ChooseRow {
  readonly id: string;
  readonly name: string;
  readonly kind: 'list' | 'group';
  readonly count?: number;
  readonly inGroup?: string;
}

/** Choose what syncs (D-161 Q1, mockup "Choose items"): on this PC and in Drive, grouped as the sidebar. */
export function ChooseDialog(props: {
  readonly status: SyncStatusView;
  readonly lists: readonly ListSummary[];
  readonly items: readonly SidebarItem[];
  readonly onClose: () => void;
}): ReactElement {
  const { status, lists, items, onClose } = props;
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set([...status.synced, ...status.syncedGroups]),
  );
  const local: ChooseRow[] = [];
  const name = (id: string): string => lists.find((list) => list.id === id)?.name ?? id;
  const inbox = lists.find((list) => list.inbox);
  if (inbox) local.push({ id: inbox.id, name: 'Inbox', kind: 'list' });
  for (const item of items) {
    if (item.kind === 'group') {
      local.push({ id: item.id, name: item.name, kind: 'group', count: item.lists.length });
      for (const id of item.lists)
        local.push({ id, name: name(id), kind: 'list', inGroup: item.id });
    } else {
      local.push({ id: item.id, name: name(item.id), kind: 'list' });
    }
  }
  const remote: ChooseRow[] = [];
  const groupsHere = new Set(items.filter((item) => item.kind === 'group').map((item) => item.id));
  for (const group of status.remoteGroups) {
    if (groupsHere.has(group.id)) continue;
    remote.push({ id: group.id, name: group.name, kind: 'group', count: group.lists.length });
  }
  for (const item of status.remoteOnly) {
    if (item.group && !groupsHere.has(item.group)) continue;
    remote.push({ id: item.listId, name: item.name, kind: 'list' });
  }
  const implied = (row: ChooseRow): boolean => row.inGroup !== undefined && ticked.has(row.inGroup);
  const toggle = (id: string): void =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const footer = (() => {
    const chosenLists = lists.filter(
      (list) =>
        ticked.has(list.id) ||
        items.some(
          (item) => item.kind === 'group' && ticked.has(item.id) && item.lists.includes(list.id),
        ),
    );
    const groups = [...ticked].filter(
      (id) => groupsHere.has(id) || status.remoteGroups.some((group) => group.id === id),
    );
    const remoteLists = status.remoteOnly.filter((item) => ticked.has(item.listId)).length;
    return syncCounts(
      chosenLists.filter((list) => list.mode === 'tasks').length + remoteLists,
      chosenLists.filter((list) => list.mode === 'note').length,
      groups.length,
      false,
    );
  })();
  const row = (entry: ChooseRow): ReactElement => {
    const on = ticked.has(entry.id) || implied(entry);
    return (
      <button
        key={`${entry.kind}:${entry.id}`}
        type="button"
        role="checkbox"
        aria-checked={on}
        disabled={implied(entry)}
        className={entry.inGroup ? 'choose-row indented' : 'choose-row'}
        onClick={() => toggle(entry.id)}
      >
        <span
          className={
            on ? (implied(entry) ? 'choose-box on implied' : 'choose-box on') : 'choose-box'
          }
        >
          {on && (
            <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m5 12 5 5 9-10"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        {entry.kind === 'group' ? (
          <span className="choose-group">{entry.name}</span>
        ) : (
          <span>{entry.name}</span>
        )}
        {entry.count !== undefined && <span className="nav-count choose-count">{entry.count}</span>}
      </button>
    );
  };
  return (
    <SyncDialog label="Choose what syncs" className="sync-choose" onClose={onClose}>
      {(close) => (
        <>
          <span className="sync-dialog-title">Choose what syncs</span>
          <span className="sync-caption">
            Ticked items sync with Google Drive on this PC. Items from Drive come to this PC when
            you tick them.
          </span>
          <div className="choose-scroll">
            <span className="section-label choose-label">On this PC</span>
            {local.map(row)}
            {remote.length > 0 && (
              <span className="section-label choose-label">In Drive, not on this PC</span>
            )}
            {remote.map(row)}
          </div>
          <div className="sync-dialog-foot split">
            <span className="sync-caption">{footer}</span>
            <span className="sync-dialog-buttons">
              <button type="button" className="quiet-button" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void act({ kind: 'choose', ids: [...ticked] });
                  close();
                }}
              >
                Save
              </button>
            </span>
          </div>
        </>
      )}
    </SyncDialog>
  );
}

/** Stop syncing "<name>" on this PC? (D-161 Q6, mockup "Stop syncing"). */
export function StopDialog(props: {
  readonly id: string;
  readonly name: string;
  readonly mode: 'tasks' | 'note' | 'group';
  /** A group's lists, for its title. */
  readonly lists?: number;
  readonly onClose: () => void;
}): ReactElement {
  const { id, name, mode, lists = 0, onClose } = props;
  const [everywhere, setEverywhere] = useState(false);
  const what = mode === 'group' ? 'group' : mode === 'note' ? 'note' : 'list';
  const title =
    mode === 'group'
      ? `Stop syncing "${name}" and its ${lists} ${lists === 1 ? 'list' : 'lists'} on this PC?`
      : `Stop syncing "${name}" on this PC?`;
  return (
    <SyncDialog label={title} className="sync-stop" onClose={onClose}>
      {(close) => (
        <>
          <span className="sync-stop-title">{title}</span>
          <span className="sync-stop-text">
            It stays here as a local {what === 'group' ? 'group' : what}. Other devices keep syncing
            it.
          </span>
          <button
            type="button"
            role="checkbox"
            aria-checked={everywhere}
            className="sync-stop-option"
            onClick={() => setEverywhere(!everywhere)}
          >
            <span className={everywhere ? 'choose-box on' : 'choose-box'}>
              {everywhere && (
                <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="m5 12 5 5 9-10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="sync-stop-option-text">
              <span className="sync-stop-option-name">Also remove from Drive</span>
              <span className="sync-caption">
                Stops syncing on every device. Each device keeps its own copy as a local{' '}
                {what === 'group' ? 'list' : what}.
              </span>
            </span>
          </button>
          <div className="sync-dialog-foot">
            <button type="button" className="quiet-button" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void act({ kind: 'stop', id, everywhere });
                close();
              }}
            >
              {everywhere ? 'Stop syncing everywhere' : 'Stop syncing'}
            </button>
          </div>
        </>
      )}
    </SyncDialog>
  );
}

/** A question with two buttons (Disconnect, Chosen → Everything). */
export function SyncQuestion(props: {
  readonly title: string;
  readonly text: string;
  readonly confirm: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const { title, text, confirm, onConfirm, onClose } = props;
  return (
    <SyncDialog label={title} className="sync-stop" onClose={onClose}>
      {(close) => (
        <>
          <span className="sync-stop-title">{title}</span>
          <span className="sync-stop-text">{text}</span>
          <div className="sync-dialog-foot">
            <button type="button" className="quiet-button" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onConfirm();
                close();
              }}
            >
              {confirm}
            </button>
          </div>
        </>
      )}
    </SyncDialog>
  );
}

/** "Sync everything on this PC? …" (D-161 Q9). */
export function everythingText(preview: SyncEverythingPreview): string {
  const start = `${preview.start} ${preview.start === 1 ? 'list or note starts' : 'lists and notes start'} syncing`;
  const from =
    preview.fromDrive > 0
      ? `, and ${preview.fromDrive} from Drive ${preview.fromDrive === 1 ? 'comes' : 'come'} to this PC${
          preview.stoppedHere > 0
            ? ` (including ${preview.stoppedHere} you stopped syncing here)`
            : ''
        }`
      : '';
  return `${start}${from}.`;
}
