import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { TaskRow, UpNextItem } from '../../shared/ipc.js';
import { titleHtml } from '../../shared/inline-markdown.js';
import { activeLinkPatterns } from '../../shared/link-patterns.js';
import { openAttachment } from '../media/media.js';
import { panelExtras, type Attachment, type Reference } from '../panel/extras.js';
import { outline as outlineOf, type Outline, type OutlineBlock } from '../panel/outline.js';
import { BodyBlock, type ShowImage } from './Body.js';
import {
  BackIcon,
  BellIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  HashIcon,
  ImageIcon,
  OpenPageIcon,
  PinIcon,
  PlusIcon,
  ReminderBellIcon,
} from './icons.js';

/**
 * The context panel on wide screens (NAV-07, D-83, mockup 11): beside the 820 px column, on the
 * task list's card surface, its height fitting its content. Three states: a selected task's
 * details; "Up next" when nothing is selected; the outline of a note (or of a task's page) with
 * what is in it. It slides in when it appears, its height eases when its content changes, the old
 * content fades out over the new one fading in, and the outline's marker slides to the current
 * section (D-83, D-85); nothing waits for it (D-75). Extra sections (Recently captured, References,
 * Attachments) are one quiet line each until opened, below the core content (D-85).
 */

export type PanelState =
  | {
      readonly kind: 'task';
      readonly task: TaskRow;
      readonly listName: string;
      readonly readOnly: boolean;
    }
  | { readonly kind: 'upnext' }
  | {
      readonly kind: 'note';
      readonly text: string;
      readonly edited?: string | undefined;
      readonly created?: string | undefined;
    }
  | { readonly kind: 'page'; readonly task: TaskRow };

export interface PanelHandlers {
  readonly onHide: () => void;
  /** D-85: back to what the panel showed before a link in it was followed; null when there's none. */
  readonly onBack: (() => void) | null;
  /** D-85: the panel's right-click menu (Hide panel). */
  readonly onMenu: (at: { x: number; y: number }) => void;
  readonly onOpenPage: (key: string) => void;
  readonly onToggle: (key: string) => void;
  readonly onTitle: (key: string, text: string) => void;
  readonly onPriority: (task: TaskRow, anchor: DOMRect) => void;
  readonly onList: (task: TaskRow, anchor: DOMRect) => void;
  readonly onReminder: (task: TaskRow, anchor: DOMRect) => void;
  readonly onBody: (key: string, body: string) => void;
  readonly onRemovePart: (key: string, body: string, kind: 'code' | 'image') => void;
  readonly onAddSubtask: (task: TaskRow) => void;
  readonly onImage: ShowImage;
  /** Up next: an item's task, in its list. */
  readonly onGo: (item: UpNextItem) => void;
  /** Outline: scrolls the note or the page to a heading or block (its offset in the text). */
  readonly onJump: (kind: 'heading' | 'block', index: number, from: number) => void;
}

const PRIORITY_NAMES = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export function ContextPanel(props: {
  readonly state: PanelState;
  readonly upNext: readonly UpNextItem[];
  /** Outline: the heading the reader is at (by scroll position), marked. */
  readonly current: number;
  /** D-85: the header's back arrow shows (a task reached from a link in the panel). */
  readonly back: boolean;
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { state, upNext, current, handlers } = props;
  const card = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  // The card's height eases to its content's (D-83); a change of state crossfades.
  const lastHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const content = inner.current;
    const box = card.current;
    if (!content || !box) return;
    const observer = new ResizeObserver(() => {
      const next = box.offsetHeight;
      const before = lastHeight.current;
      lastHeight.current = next;
      if (before === null || Math.abs(before - next) < 1) return;
      if (reducedMotion()) return;
      box.animate([{ height: `${before}px` }, { height: `${next}px` }], {
        duration: durationOf(box, 260),
        easing: 'cubic-bezier(.2, .9, .3, 1)',
      });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const stateKey =
    state.kind === 'task'
      ? `task:${state.task.key}`
      : state.kind === 'page'
        ? `page:${state.task.key}`
        : state.kind;
  const content = (
    <>
      {state.kind === 'task' && <TaskDetails state={state} back={props.back} handlers={handlers} />}
      {state.kind === 'upnext' && <UpNext items={upNext} handlers={handlers} />}
      {state.kind === 'note' && (
        <NoteOutline
          text={state.text}
          edited={state.edited}
          created={state.created}
          current={current}
          handlers={handlers}
        />
      )}
      {state.kind === 'page' && (
        <PageOutline task={state.task} current={current} upNext={upNext} handlers={handlers} />
      )}
    </>
  );
  // D-85: the previous state stays a moment, fading out above the new one (a real crossfade).
  const shown = useRef<{ key: string; node: ReactNode }>({ key: stateKey, node: content });
  const [ghost, setGhost] = useState<{ key: string; node: ReactNode } | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { key: stateKey, node: content };
    if (before.key !== stateKey && !reducedMotion()) setGhost(before);
  });
  // Gone once it has faded, whatever renders meanwhile.
  useEffect(() => {
    if (!ghost) return;
    const timer = window.setTimeout(() => setGhost(null), durationOf(card.current, 260));
    return () => window.clearTimeout(timer);
  }, [ghost]);
  return (
    <aside
      className="context-panel card"
      ref={card}
      aria-label="Context"
      onContextMenu={(event) => {
        if ((event.target as Element).closest('a, input, textarea, [contenteditable]')) return;
        event.preventDefault();
        handlers.onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="panel-inner" ref={inner}>
        <div className="panel-state" key={stateKey}>
          {content}
        </div>
        {ghost && ghost.key !== stateKey && (
          <div
            className="panel-state panel-ghost"
            key={`ghost:${ghost.key}`}
            aria-hidden="true"
            inert
          >
            {ghost.node}
          </div>
        )}
      </div>
    </aside>
  );
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `--fl-dur-state` in ms, read from the element's style. */
function durationOf(element: Element | null, fallback: number): number {
  if (!element) return fallback;
  return parseFloat(getComputedStyle(element).getPropertyValue('--fl-dur-state')) || fallback;
}

function PanelHead(props: {
  readonly label: string;
  readonly meta?: string;
  readonly handlers: PanelHandlers;
  readonly openPage?: () => void;
  /** D-85: a back arrow to what the panel showed before (a task reached from a panel link). */
  readonly back?: boolean;
}): ReactElement {
  const { label, meta, handlers, openPage, back } = props;
  const onBack = handlers.onBack;
  return (
    <header className="panel-head">
      {back && onBack && (
        <button
          type="button"
          className="panel-button panel-back"
          title="Back (Alt+←)"
          onClick={onBack}
        >
          <BackIcon size={13} />
        </button>
      )}
      <span className="panel-label">{label}</span>
      {meta && <span className="panel-meta">{meta}</span>}
      <span className="panel-actions">
        {openPage && (
          <button
            type="button"
            className="panel-button"
            title="Open as page (Shift+Enter)"
            onClick={openPage}
          >
            <OpenPageIcon />
          </button>
        )}
        <button
          type="button"
          className="panel-button"
          title="Hide the panel (Ctrl+\)"
          onClick={handlers.onHide}
        >
          <CloseIcon size={13} />
        </button>
      </span>
    </header>
  );
}

function TaskDetails(props: {
  readonly state: Extract<PanelState, { kind: 'task' }>;
  readonly back: boolean;
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { state, handlers } = props;
  const { task, listName, readOnly } = state;
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const editable = !readOnly && !task.done;
  useEffect(() => {
    setEditingTitle(false);
    setEditingBody(false);
  }, [task.key]);
  const done = task.subtasks.filter((sub) => sub.done).length;
  return (
    <>
      <PanelHead
        label="Task"
        back={props.back}
        handlers={handlers}
        openPage={() => handlers.onOpenPage(task.key)}
      />
      <div className="panel-title-row">
        <button
          type="button"
          className={task.done ? 'check on' : 'check'}
          aria-label={task.done ? 'Reopen task' : 'Complete task'}
          onClick={() => handlers.onToggle(task.key)}
        >
          {task.done && <CheckIcon />}
        </button>
        {editingTitle ? (
          <PanelTitleField
            initial={task.title}
            onLeave={(text) => {
              setEditingTitle(false);
              if (text.trim() !== '' && text !== task.title) handlers.onTitle(task.key, text);
            }}
          />
        ) : (
          <h2
            className="panel-title"
            onClick={(event) => {
              const link = (event.target as HTMLElement).closest('a');
              if (link) {
                event.preventDefault();
                window.flintMain.openLink(link.href);
              } else if (editable) setEditingTitle(true);
            }}
          >
            {task.title === '' ? (
              task.label
            ) : (
              <span dangerouslySetInnerHTML={{ __html: titleHtml(task.title) }} />
            )}
          </h2>
        )}
      </div>
      <div className="panel-chips">
        <button
          type="button"
          className="chip panel-chip"
          disabled={!editable}
          data-picker-trigger
          onClick={(event) =>
            handlers.onPriority(task, event.currentTarget.getBoundingClientRect())
          }
        >
          <span className={`chip-stripe p-${task.priority ?? 'none'}`} />
          {task.priority ? PRIORITY_NAMES[task.priority] : 'No priority'}
        </button>
        <button
          type="button"
          className="chip panel-chip"
          disabled={!editable}
          data-picker-trigger
          onClick={(event) => handlers.onList(task, event.currentTarget.getBoundingClientRect())}
        >
          <HashIcon size={12} />
          {listName}
        </button>
        <button
          type="button"
          className={`chip panel-chip reminder ${task.reminderState ?? ''}`}
          disabled={!editable}
          data-picker-trigger
          onClick={(event) =>
            handlers.onReminder(task, event.currentTarget.getBoundingClientRect())
          }
        >
          <BellIcon />
          {task.reminder ?? 'Reminder'}
        </button>
      </div>
      <section className="panel-section">
        <span className="panel-label">Notes</span>
        {editingBody || task.body.trim() !== '' ? (
          <BodyBlock
            body={task.body}
            inline={false}
            editing={editingBody}
            editable={editable}
            placeholder="Notes, code, links…"
            onImage={handlers.onImage}
            onEdit={() => setEditingBody(true)}
            onDone={(body) => {
              setEditingBody(false);
              if (body !== task.body) handlers.onBody(task.key, body);
            }}
            onRemovePart={(body, kind) => handlers.onRemovePart(task.key, body, kind)}
            onRelink={(body) => handlers.onBody(task.key, body)}
          />
        ) : (
          editable && (
            <button type="button" className="panel-add" onClick={() => setEditingBody(true)}>
              Add notes, code or links
            </button>
          )
        )}
      </section>
      <section className="panel-section">
        <span className="panel-label">
          Subtasks{task.subtasks.length > 0 ? ` · ${done} of ${task.subtasks.length}` : ''}
        </span>
        {task.subtasks.map((sub) => (
          <div key={sub.key} className={sub.done ? 'panel-subtask done' : 'panel-subtask'}>
            <button
              type="button"
              className={sub.done ? 'check on' : 'check'}
              aria-label={sub.done ? 'Reopen subtask' : 'Complete subtask'}
              onClick={() => handlers.onToggle(sub.key)}
            >
              {sub.done && <CheckIcon />}
            </button>
            <span className="panel-subtask-title">{sub.title === '' ? sub.label : sub.title}</span>
          </div>
        ))}
        {editable && (
          <button type="button" className="panel-add" onClick={() => handlers.onAddSubtask(task)}>
            <PlusIcon size={12} />
            Add subtask
          </button>
        )}
      </section>
      <Stamps created={task.created} edited={task.edited} />
      <Extras text={taskText(task)} />
    </>
  );
}

/** A task's title, body and subtasks, for its References and Attachments. */
function taskText(task: TaskRow): string {
  return [task.title, task.body, ...task.subtasks.flatMap((sub) => [sub.title, sub.body])].join(
    '\n\n',
  );
}

/** "Created 2 Nov · edited 11 min ago" (D-83, D-85). */
function Stamps(props: {
  readonly created?: string | undefined;
  readonly edited?: string | undefined;
}): ReactElement | null {
  const { created, edited } = props;
  if (!created && !edited) return null;
  return (
    <footer className="panel-foot">
      {[created && `Created ${created}`, edited && `${created ? 'edited' : 'Edited'} ${edited}`]
        .filter(Boolean)
        .join(' · ')}
    </footer>
  );
}

const OPEN_SECTIONS = 'flint.panel.open';

/** D-85: which extra sections are open, on this machine (the window's local storage). */
function openSections(): Set<string> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(OPEN_SECTIONS) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * D-85: an extra section: one quiet line with its count ("References · 3") until opened; opened or
 * closed is remembered per section; nothing at all when empty.
 */
function Extra(props: {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly children: ReactNode;
}): ReactElement | null {
  const { id, label, count, children } = props;
  const [open, setOpen] = useState(() => openSections().has(id));
  if (count === 0) return null;
  const flip = (): void => {
    const next = !open;
    setOpen(next);
    const sections = openSections();
    if (next) sections.add(id);
    else sections.delete(id);
    try {
      window.localStorage.setItem(OPEN_SECTIONS, JSON.stringify([...sections]));
    } catch {
      // Not remembered; the section still opens.
    }
  };
  return (
    <section className={open ? 'panel-extra open' : 'panel-extra'}>
      <button type="button" className="panel-extra-head" aria-expanded={open} onClick={flip}>
        <span className="chev">
          <ChevronIcon size={10} />
        </span>
        <span className="panel-label">{label}</span>
        <span className="panel-extra-count">{count}</span>
      </button>
      <div className="panel-extra-rows" inert={!open}>
        <div className="panel-extra-inner">{children}</div>
      </div>
    </section>
  );
}

/** D-85: References and Attachments of a task or a note. */
function Extras(props: { readonly text: string }): ReactElement {
  const { references, attachments } = useMemo(
    () => panelExtras(props.text, activeLinkPatterns()),
    [props.text],
  );
  return (
    <>
      <Extra id="references" label="References" count={references.length}>
        {references.map((reference) => (
          <ReferenceRow key={reference.href} reference={reference} />
        ))}
      </Extra>
      <Extra id="attachments" label="Attachments" count={attachments.length}>
        <AttachmentRows attachments={attachments} />
      </Extra>
    </>
  );
}

function ReferenceRow(props: { readonly reference: Reference }): ReactElement {
  const { reference } = props;
  return (
    <button
      type="button"
      className="panel-item reference"
      title={reference.href}
      onClick={() => window.flintMain.openLink(reference.href)}
    >
      <span className="panel-item-title">{reference.text}</span>
    </button>
  );
}

function AttachmentRows(props: { readonly attachments: readonly Attachment[] }): ReactElement {
  const { attachments } = props;
  // MEDIA-03: a file that isn't where its link points is flagged.
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    void Promise.all(
      attachments.map(async (each) =>
        (await window.flintMain.attachmentExists(each.link)) ? null : each.link,
      ),
    ).then((gone) => {
      if (live) setMissing(new Set(gone.filter((link): link is string => link !== null)));
    });
    return () => {
      live = false;
    };
  }, [attachments]);
  return (
    <>
      {attachments.map((each) => (
        <button
          key={each.link}
          type="button"
          className={
            missing.has(each.link) ? 'panel-item attachment missing' : 'panel-item attachment'
          }
          title={each.link}
          onClick={(event) => void openAttachment(event.currentTarget, each.link)}
        >
          <span className="outline-tile">
            {each.kind === 'file' ? <OpenPageIcon size={11} /> : <ImageIcon size={11} />}
          </span>
          <span className="panel-item-title">{each.name}</span>
          {missing.has(each.link) ? (
            <span className="panel-item-badge">Not found</span>
          ) : (
            each.linked && <span className="panel-item-badge">Linked</span>
          )}
        </button>
      ))}
    </>
  );
}

/** The title edited in the panel: Enter or leaving saves, Esc keeps the old one. */
function PanelTitleField(props: {
  readonly initial: string;
  readonly onLeave: (text: string) => void;
}): ReactElement {
  const { initial, onLeave } = props;
  const [value, setValue] = useState(initial);
  const left = useRef(false);
  const leave = (text: string): void => {
    if (left.current) return;
    left.current = true;
    onLeave(text);
  };
  return (
    <textarea
      className="panel-title-input"
      aria-label="Title"
      autoFocus
      rows={1}
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value.replace(/\r?\n/g, ' '))}
      onBlur={() => leave(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          leave(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          leave(initial);
        }
      }}
    />
  );
}

const GROUPS = [
  ['pinned', 'Pinned'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['overdue', 'Overdue'],
] as const;

function UpNextRow(props: {
  readonly item: UpNextItem;
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { item, handlers } = props;
  return (
    <button
      type="button"
      className={`panel-item ${item.group}${item.done ? ' done' : ''}`}
      onClick={() => handlers.onGo(item)}
    >
      <span className="panel-item-when">
        {item.group === 'overdue' && (
          <span className="reminder overdue">
            <span className="reminder-bell">
              <ReminderBellIcon />
              <span className="overdue-dot" aria-hidden="true" />
            </span>
          </span>
        )}
        {item.group === 'pinned' && <PinIcon size={11} />}
        {item.when}
      </span>
      <span className="panel-item-title">{item.title}</span>
      <span className="panel-item-list">{item.listName}</span>
    </button>
  );
}

function UpNext(props: {
  readonly items: readonly UpNextItem[];
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { items, handlers } = props;
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return (
    <>
      <PanelHead label="Up next" meta={today} handlers={handlers} />
      {!items.some((item) => item.group !== 'captured') && (
        <p className="panel-empty">No pins or reminders today or tomorrow.</p>
      )}
      {GROUPS.map(([group, label]) => {
        const rows = items.filter((item) => item.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className={`panel-section ${group}`}>
            <span className="panel-label">{label}</span>
            {rows.map((item) => (
              <UpNextRow key={`${item.listId}/${item.key}`} item={item} handlers={handlers} />
            ))}
          </section>
        );
      })}
      <footer className="panel-foot">Select a task to see its details here</footer>
      <Extra
        id="captured"
        label="Recently captured"
        count={items.filter((item) => item.group === 'captured').length}
      >
        {items
          .filter((item) => item.group === 'captured')
          .map((item) => (
            <UpNextRow key={`${item.listId}/${item.key}`} item={item} handlers={handlers} />
          ))}
      </Extra>
    </>
  );
}

function OutlineList(props: {
  readonly outline: Outline;
  readonly current: number;
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { outline, current, handlers } = props;
  let blockIndex = 0;
  const block = (item: OutlineBlock, depth: number): ReactNode => {
    const index = blockIndex++;
    return (
      <button
        key={`block-${index}`}
        type="button"
        className="outline-block"
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => handlers.onJump('block', index, item.from)}
      >
        <span className="outline-tile">
          {item.kind === 'code' ? '{ }' : <ImageIcon size={11} />}
        </span>
        <span className="outline-title">{item.title}</span>
        <span className="outline-tag">{item.tag}</span>
      </button>
    );
  };
  const minLevel = Math.min(...outline.headings.map((heading) => heading.level), 6);
  const list = useRef<HTMLElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const nav = list.current;
    const bar = marker.current;
    const entry = nav?.querySelector<HTMLElement>('.outline-heading.current');
    if (!nav || !bar || !entry) return;
    bar.style.transform = `translateY(${entry.offsetTop + 8}px)`;
    bar.style.height = `${Math.max(8, entry.offsetHeight - 16)}px`;
    // The panel scrolls to keep the current entry in view (never the page around it).
    const panel = nav.closest<HTMLElement>('.context-panel');
    if (!panel) return;
    const box = entry.getBoundingClientRect();
    const view = panel.getBoundingClientRect();
    if (box.top < view.top + 8) panel.scrollTop -= view.top + 8 - box.top;
    else if (box.bottom > view.bottom - 8) panel.scrollTop += box.bottom - (view.bottom - 8);
  }, [current, outline]);
  return (
    <nav className="outline" aria-label="Outline" ref={list}>
      {outline.headings.length > 0 && (
        <span className="outline-marker" ref={marker} aria-hidden="true" />
      )}
      {outline.blocks.map((item) => block(item, 0))}
      {outline.headings.map((heading, index) => {
        const depth = heading.level - minLevel;
        return (
          <div key={`heading-${index}`} className="outline-group">
            <button
              type="button"
              className={index === current ? 'outline-heading current' : 'outline-heading'}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => handlers.onJump('heading', index, heading.from)}
            >
              {heading.text}
            </button>
            {heading.blocks.map((item) => block(item, depth + 1))}
          </div>
        );
      })}
    </nav>
  );
}

const summary = (outline: Outline): string => {
  const sections = outline.headings.length;
  const blocks =
    outline.blocks.length +
    outline.headings.reduce((sum, heading) => sum + heading.blocks.length, 0);
  return [
    sections > 0 && `${sections} ${sections === 1 ? 'section' : 'sections'}`,
    blocks > 0 && `${blocks} ${blocks === 1 ? 'block' : 'blocks'}`,
  ]
    .filter(Boolean)
    .join(' · ');
};

function NoteOutline(props: {
  readonly text: string;
  readonly edited?: string | undefined;
  readonly created?: string | undefined;
  readonly current: number;
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { text, edited, created, current, handlers } = props;
  const outline = useMemo(() => outlineOf(text), [text]);
  return (
    <>
      <PanelHead label="Outline" meta={summary(outline)} handlers={handlers} />
      {outline.empty ? (
        <p className="panel-empty">Headings, code blocks and pictures show here.</p>
      ) : (
        <OutlineList outline={outline} current={current} handlers={handlers} />
      )}
      <section className="panel-section panel-facts">
        <span className="panel-label">In this note</span>
        {outline.checklist.total > 0 && (
          <div className="panel-fact">
            <span>Checklist</span>
            <span className="panel-fact-value">
              {outline.checklist.done} of {outline.checklist.total} done
            </span>
          </div>
        )}
      </section>
      <Stamps created={created} edited={edited} />
      <Extras text={text} />
    </>
  );
}

function PageOutline(props: {
  readonly task: TaskRow;
  readonly current: number;
  readonly upNext: readonly UpNextItem[];
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { task, current, upNext, handlers } = props;
  const outline = useMemo(() => outlineOf(task.body), [task.body]);
  // D-83: a body with nothing to outline: Up next instead.
  if (outline.empty) return <UpNext items={upNext} handlers={handlers} />;
  const done = task.subtasks.filter((sub) => sub.done).length;
  return (
    <>
      <PanelHead label="Outline" meta={summary(outline)} handlers={handlers} />
      <OutlineList outline={outline} current={current} handlers={handlers} />
      <section className="panel-section panel-facts">
        <span className="panel-label">In this task</span>
        {task.subtasks.length > 0 && (
          <div className="panel-fact">
            <span>Subtasks</span>
            <span className="panel-fact-value">
              {done} of {task.subtasks.length} done
            </span>
          </div>
        )}
        {task.reminder && (
          <div className="panel-fact">
            <span>Reminder</span>
            <span className="panel-fact-value">{task.reminder}</span>
          </div>
        )}
        {task.created && (
          <div className="panel-fact">
            <span>Created</span>
            <span className="panel-fact-value">{task.created}</span>
          </div>
        )}
        {task.edited && (
          <div className="panel-fact">
            <span>Edited</span>
            <span className="panel-fact-value">{task.edited}</span>
          </div>
        )}
      </section>
      <Extras text={taskText(task)} />
    </>
  );
}
