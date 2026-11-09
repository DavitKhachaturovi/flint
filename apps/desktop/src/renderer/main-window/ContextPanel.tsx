import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useScrollsWhenTaller } from '../ui/scrolls.js';
import { usePresence } from '../ui/presence.js';
import type { TaskRow, UpNextItem } from '../../shared/ipc.js';
import { titleHtml } from '../../shared/inline-markdown.js';
import { mediaUrl } from '../../shared/body-markdown.js';
import { activeLinkPatterns } from '../../shared/link-patterns.js';
import { announce, fileMenuItems, imageMenuItems, openAttachment } from '../media/media.js';
import { openMenu } from '../menu/menu.js';
import { panelExtras, type Attachment, type Reference } from '../panel/extras.js';
import { outline as outlineOf, type Outline, type OutlineBlock } from '../panel/outline.js';
import { BodyBlock, LiveNotes, type ShowImage } from './Body.js';
import {
  BackIcon,
  BellIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  HashIcon,
  ImageIcon,
  OpenPageIcon,
  GiveToClaudeIcon,
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

/** D-86: what "In this note" / "In this task" can jump through. */
export type FactKind = 'open' | 'code' | 'images' | 'links';

export interface PanelHandlers {
  readonly onHide: () => void;
  /** TODAY-01, D-86: the Pin chip pins or unpins; a pin in Up next unpins its task. */
  readonly onPin: (task: TaskRow, pinned: boolean) => void;
  readonly onUnpin: (item: UpNextItem) => void;
  /** D-86: a subtask typed in the panel. */
  readonly onNewSubtask: (task: TaskRow, text: string) => void;
  /** D-86: a fact's click: the next of its items (their offsets in a note's text). */
  readonly onFact: (kind: FactKind, positions: readonly number[]) => void;
  /** D-85: back to what the panel showed before a link in it was followed; null when there's none. */
  readonly onBack: (() => void) | null;
  /** D-85: the panel's right-click menu (Hide panel). */
  readonly onMenu: (at: { x: number; y: number }) => void;
  readonly onOpenPage: (key: string) => void;
  /** TASK-18, D-151: Give to Claude's card for a task. */
  readonly onGiveToClaude: (key: string) => void;
  readonly onToggle: (key: string) => void;
  readonly onTitle: (key: string, text: string) => void;
  readonly onPriority: (task: TaskRow, anchor: DOMRect) => void;
  readonly onList: (task: TaskRow, anchor: DOMRect) => void;
  readonly onReminder: (task: TaskRow, anchor: DOMRect) => void;
  readonly onBody: (key: string, body: string) => void;
  readonly onRemovePart: (key: string, body: string, kind: 'code' | 'image') => void;
  readonly onAddSubtask: (task: TaskRow) => void;
  readonly onImage: ShowImage;
  /** D-87: a subtask's right-click menu, as in the list (the panel keeps showing its task). */
  readonly onTaskMenu: (task: TaskRow, at: { x: number; y: number }) => void;
  /** D-89: a subtask's click: it is selected, so the panel shows it (with the back arrow). */
  readonly onSubtask: (task: TaskRow) => void;
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
  /** NAV-08, D-128: docked at the panel's foot in every state (the Clipboard section). */
  readonly foot?: ReactNode;
}): ReactElement {
  const { state, upNext, current, handlers, foot } = props;
  const card = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useScrollsWhenTaller(card);
  const stateKey =
    state.kind === 'task'
      ? `task:${state.task.key}`
      : state.kind === 'page'
        ? `page:${state.task.key}`
        : state.kind;
  // D-83, D-86: the card's height eases to its content's when the state changes, and only then
  // (a section opening, a note being typed resize it as they go). No scrollbar while it moves.
  const restingHeight = useRef<number | null>(null);
  /** D-89: when the state last changed: content arriving just after (Up next) eases in too. */
  const changedAt = useRef(0);
  useLayoutEffect(() => {
    const content = inner.current;
    const box = card.current;
    if (!content || !box) return;
    const observer = new ResizeObserver(() => {
      if (box.getAnimations().some((animation) => animation.id === 'panel-height')) return;
      const before = restingHeight.current;
      const next = box.offsetHeight;
      restingHeight.current = next;
      if (
        before === null ||
        Math.abs(before - next) < 1 ||
        performance.now() - changedAt.current > 600 ||
        reducedMotion()
      )
        return;
      const animation = box.animate(
        [
          { height: `${before}px`, overflow: 'hidden' },
          { height: `${next}px`, overflow: 'hidden' },
        ],
        { duration: durationOf(box, 260), easing: 'cubic-bezier(.2, .9, .3, 1)' },
      );
      animation.id = 'panel-height';
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const lastKey = useRef(stateKey);
  useLayoutEffect(() => {
    const box = card.current;
    if (!box || lastKey.current === stateKey) return;
    lastKey.current = stateKey;
    changedAt.current = performance.now();
    const running = box.getAnimations().filter((animation) => animation.id === 'panel-height');
    const before = running.length > 0 ? box.getBoundingClientRect().height : restingHeight.current;
    for (const animation of running) animation.cancel();
    const next = box.offsetHeight;
    restingHeight.current = next;
    if (before === null || Math.abs(before - next) < 1 || reducedMotion()) return;
    const animation = box.animate(
      [
        { height: `${before}px`, overflow: 'hidden' },
        { height: `${next}px`, overflow: 'hidden' },
      ],
      { duration: durationOf(box, 260), easing: 'cubic-bezier(.2, .9, .3, 1)' },
    );
    animation.id = 'panel-height';
  });
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
  // Gone once it has faded (its animation's end), whatever renders meanwhile; the timer is only a
  // fallback for a fade that never ends (a hidden window doesn't animate).
  useEffect(() => {
    if (!ghost) return;
    const timer = window.setTimeout(() => setGhost(null), 2 * durationOf(card.current, 260));
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
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setGhost(null);
            }}
          >
            {ghost.node}
          </div>
        )}
      </div>
      {foot}
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
  readonly giveToClaude?: () => void;
  /** D-85: a back arrow to what the panel showed before (a task reached from a panel link). */
  readonly back?: boolean;
}): ReactElement {
  const { label, meta, handlers, openPage, giveToClaude, back } = props;
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
        {giveToClaude && (
          <button
            type="button"
            className="panel-button"
            title="Give to Claude (G)"
            onClick={giveToClaude}
          >
            <GiveToClaudeIcon />
          </button>
        )}
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
  const [addingSubtask, setAddingSubtask] = useState<'open' | 'leaving' | false>(false);
  const editable = !readOnly && !task.done;
  useEffect(() => {
    setEditingTitle(false);
    setAddingSubtask(false);
  }, [task.key]);
  const done = task.subtasks.filter((sub) => sub.done).length;
  return (
    <>
      <PanelHead
        label="Task"
        back={props.back}
        handlers={handlers}
        openPage={() => handlers.onOpenPage(task.key)}
        giveToClaude={() => handlers.onGiveToClaude(task.key)}
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
        {/* TODAY-01, D-86: pins or unpins. */}
        <button
          type="button"
          className={task.pinned ? 'chip panel-chip pin on' : 'chip panel-chip pin'}
          disabled={readOnly}
          aria-pressed={task.pinned === true}
          title={task.pinned ? 'Unpin (P)' : 'Pin (P)'}
          onClick={() => handlers.onPin(task, !task.pinned)}
        >
          <PinIcon />
          {task.pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>
      <section className="panel-section">
        <span className="panel-label">Notes</span>
        {editable ? (
          // D-86: the notes are always the M5 editor here, edited in place.
          <PanelNotes task={task} handlers={handlers} />
        ) : (
          task.body.trim() !== '' && (
            <BodyBlock
              body={task.body}
              inline={false}
              editing={false}
              editable={false}
              onImage={handlers.onImage}
              onEdit={() => undefined}
              onDone={() => undefined}
            />
          )
        )}
      </section>
      <section className="panel-section">
        <span className="panel-label">
          Subtasks{task.subtasks.length > 0 ? ` · ${done} of ${task.subtasks.length}` : ''}
        </span>
        <PanelSubtasks key={task.key} subtasks={task.subtasks} handlers={handlers} />
        {editable && (
          <>
            {addingSubtask !== false && (
              // D-86: typed here; Enter adds it and keeps the field for the next one. D-112:
              // left empty, it plays the list's remove animation.
              <PanelSubtaskField
                leaving={addingSubtask === 'leaving'}
                onAdd={(text) => handlers.onNewSubtask(task, text)}
                onLeave={(empty) => setAddingSubtask(empty && !reducedMotion() ? 'leaving' : false)}
                onGone={() => setAddingSubtask(false)}
              />
            )}
            {addingSubtask !== 'open' && (
              <button type="button" className="panel-add" onClick={() => setAddingSubtask('open')}>
                <PlusIcon size={12} />
                Add subtask
              </button>
            )}
          </>
        )}
      </section>
      <Stamps created={task.created} edited={task.edited} />
      <Extras text={taskText(task)} onImage={handlers.onImage} />
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
function Extras(props: { readonly text: string; readonly onImage: ShowImage }): ReactElement {
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
        <AttachmentRows attachments={attachments} onImage={props.onImage} />
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
      // D-89: open it, or copy its address.
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openMenu(
          [
            { label: 'Open link', action: () => window.flintMain.openLink(reference.href) },
            {
              label: 'Copy link',
              action: () =>
                void navigator.clipboard
                  .writeText(reference.href)
                  .then(() => announce('Copied link')),
            },
          ],
          { x: event.clientX, y: event.clientY },
        );
      }}
    >
      <span className="panel-item-title">{reference.text}</span>
    </button>
  );
}

function AttachmentRows(props: {
  readonly attachments: readonly Attachment[];
  readonly onImage: ShowImage;
}): ReactElement {
  const { attachments, onImage } = props;
  // D-86: a picture opens in the lightbox, with the other pictures; other files in their app.
  const pictures = attachments.filter((each) => each.kind === 'image');
  const open = (each: Attachment, holder: HTMLElement): void => {
    const urls = pictures.map((picture) => mediaUrl(picture.link) ?? '');
    if (each.kind === 'image' && !missing.has(each.link)) onImage(urls, pictures.indexOf(each));
    else void openAttachment(holder, each.link);
  };
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
          onClick={(event) => open(each, event.currentTarget)}
          // D-89: the picture's or file's menu, as in the notes.
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const holder = event.currentTarget;
            openMenu(
              each.kind === 'image' && !missing.has(each.link)
                ? imageMenuItems(each.link, () => open(each, holder))
                : fileMenuItems(each.link, holder),
              { x: event.clientX, y: event.clientY },
            );
          }}
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

/** D-86, D-87: a task's notes in the panel, always the M5 editor (Body.tsx's LiveNotes). */
function PanelNotes(props: {
  readonly task: TaskRow;
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { task, handlers } = props;
  return (
    <div className="panel-notes">
      <LiveNotes
        id={task.key}
        body={task.body}
        className="body-editor panel-editor"
        onSave={(text) => handlers.onBody(task.key, text)}
        onImage={handlers.onImage}
      />
    </div>
  );
}

/**
 * D-87: a subtask in the panel, like its row in the list: the priority stripe, the pin and the
 * reminder's bell and time, and the list's right-click menu.
 */
function PanelSubtask(props: {
  readonly sub: TaskRow;
  readonly handlers: PanelHandlers;
  /** D-112: easing in (new), or playing out (gone). */
  readonly motion?: 'enter' | 'leaving' | null;
  readonly onGone?: () => void;
}): ReactElement {
  const { sub, handlers, motion = null, onGone } = props;
  return (
    <div
      className={['panel-subtask', sub.done ? 'done' : '', motion ?? ''].filter(Boolean).join(' ')}
      inert={motion === 'leaving'}
      onAnimationEnd={(event) => {
        if (motion === 'leaving' && event.target === event.currentTarget) onGone?.();
      }}
      // D-89: a click opens the subtask's details (it is selected in the list); back returns.
      onClick={(event) => {
        if ((event.target as Element).closest('button')) return;
        handlers.onSubtask(sub);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        handlers.onTaskMenu(sub, { x: event.clientX, y: event.clientY });
      }}
    >
      {!sub.done && <div className={`stripe p-${sub.priority ?? 'none'}`} />}
      <button
        type="button"
        className={sub.done ? 'check on' : 'check'}
        aria-label={sub.done ? 'Reopen subtask' : 'Complete subtask'}
        onClick={() => handlers.onToggle(sub.key)}
      >
        {sub.done && <CheckIcon />}
      </button>
      <span className="panel-subtask-title">{sub.title === '' ? sub.label : sub.title}</span>
      <span className="ind">
        {sub.pinned && (
          <button
            type="button"
            className="pin-ind"
            title="Unpin (P)"
            onClick={() => handlers.onPin(sub, false)}
          >
            <PinIcon />
          </button>
        )}
        {sub.reminder && !sub.done && (
          <span className={`reminder ${sub.reminderState ?? 'on'}`}>
            <span className="reminder-bell">
              <ReminderBellIcon />
              <span className="overdue-dot" aria-hidden="true" />
            </span>
            <span className="reminder-when">{sub.reminder}</span>
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * D-112: a task's subtasks in the panel, with the list's motion: a new one eases in, one that goes
 * (deleted, moved) plays the remove animation where it was. Keyed by the task, so another task's
 * subtasks just appear.
 */
function PanelSubtasks(props: {
  readonly subtasks: readonly TaskRow[];
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { subtasks, handlers } = props;
  const { entries, gone } = usePresence(subtasks, (sub) => sub.key);
  // The ones that arrived after the panel showed this task ease in.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current === null) seen.current = new Set(subtasks.map((sub) => sub.key));
  else for (const sub of subtasks) if (!seen.current.has(sub.key)) fresh.add(sub.key);
  useEffect(() => {
    for (const sub of subtasks) seen.current?.add(sub.key);
  });
  return (
    <>
      {entries.map(({ item: sub, key, leaving }) => (
        <PanelSubtask
          key={key}
          sub={sub}
          handlers={handlers}
          motion={leaving ? 'leaving' : fresh.has(key) ? 'enter' : null}
          onGone={() => gone(key)}
        />
      ))}
    </>
  );
}

/** D-86: a new subtask's title, typed in the panel. */
function PanelSubtaskField(props: {
  readonly onAdd: (text: string) => void;
  /** Left: `empty` when nothing was typed (it then plays out, D-112). */
  readonly onLeave: (empty: boolean) => void;
  readonly leaving: boolean;
  readonly onGone: () => void;
}): ReactElement {
  const { onAdd, onLeave, leaving, onGone } = props;
  const [value, setValue] = useState('');
  const added = useRef(false);
  return (
    <div
      className={leaving ? 'panel-subtask adding leaving' : 'panel-subtask adding'}
      inert={leaving}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onGone();
      }}
    >
      <span className="check" aria-hidden="true" />
      <input
        className="title-input panel-subtask-input"
        aria-label="New subtask"
        placeholder="Subtask"
        autoFocus
        value={value}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (leaving) return;
          const typed = value.trim() !== '';
          if (typed) onAdd(value);
          onLeave(!typed && !added.current);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (value.trim() !== '') {
              onAdd(value);
              added.current = true;
            }
            setValue('');
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setValue('');
            onLeave(true);
          }
        }}
      />
    </div>
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
      <span className="panel-item-title">{item.title}</span>
      <span className="panel-item-when">
        {item.group === 'pinned' && (
          // D-86: the pin unpins.
          <span
            className="panel-pin"
            role="button"
            title="Unpin"
            onClick={(event) => {
              event.stopPropagation();
              handlers.onUnpin(item);
            }}
          >
            <PinIcon size={12} />
          </span>
        )}
        {(item.group === 'today' || item.group === 'tomorrow') && <BellIcon />}
        {item.group === 'overdue' && (
          <span className="reminder overdue">
            <span className="reminder-bell">
              <ReminderBellIcon />
              <span className="overdue-dot" aria-hidden="true" />
            </span>
          </span>
        )}
        {item.when}
      </span>
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
        <Facts outline={outline} handlers={handlers} />
      </section>
      <Stamps created={created} edited={edited} />
      <Extras text={text} onImage={handlers.onImage} />
    </>
  );
}

/**
 * D-86: what is in a note or a task's page, each fact a button: open checklist items, code blocks,
 * images and links with their counts; a click jumps to the first, the next click to the next.
 */
function Facts(props: {
  readonly outline: Outline;
  readonly handlers: PanelHandlers;
  /** A task's page: its open subtasks are its checklist. */
  readonly open?: number;
}): ReactElement {
  const { outline, handlers } = props;
  const { facts } = outline;
  const rows: [FactKind, string, number, readonly number[]][] = [
    ['open', 'Open checklist items', props.open ?? facts.open.length, facts.open],
    ['code', 'Code blocks', facts.code.length, facts.code],
    ['images', 'Images', facts.images.length, facts.images],
    ['links', 'Links', facts.links.length, facts.links],
  ];
  return (
    <>
      {rows
        .filter(([, , count]) => count > 0)
        .map(([kind, label, count, positions]) => (
          <button
            key={kind}
            type="button"
            className="panel-fact"
            onClick={() => handlers.onFact(kind, positions)}
          >
            <span>{label}</span>
            <span className="panel-fact-value">{count}</span>
          </button>
        ))}
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
        <Facts
          outline={outline}
          handlers={handlers}
          open={task.subtasks.filter((sub) => !sub.done).length}
        />
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
      <Extras text={taskText(task)} onImage={handlers.onImage} />
    </>
  );
}
