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
import { outline as outlineOf, type Outline, type OutlineBlock } from '../panel/outline.js';
import { BodyBlock, type ShowImage } from './Body.js';
import {
  BellIcon,
  CheckIcon,
  CloseIcon,
  HashIcon,
  ImageIcon,
  OpenPageIcon,
  PlusIcon,
  ReminderBellIcon,
} from './icons.js';

/**
 * The context panel on wide screens (NAV-07, D-83, mockup 11): beside the 820 px column, on the
 * task list's card surface, its height fitting its content. Three states: a selected task's
 * details; "Up next" when nothing is selected; the outline of a note (or of a task's page) with
 * what is in it. Its height eases when its content changes and the content crossfades when the
 * state or the selection changes; nothing waits for it (D-75).
 */

export type PanelState =
  | {
      readonly kind: 'task';
      readonly task: TaskRow;
      readonly listName: string;
      readonly readOnly: boolean;
    }
  | { readonly kind: 'upnext' }
  | { readonly kind: 'note'; readonly text: string; readonly edited?: string | undefined }
  | { readonly kind: 'page'; readonly task: TaskRow };

export interface PanelHandlers {
  readonly onHide: () => void;
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
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      box.animate([{ height: `${before}px` }, { height: `${next}px` }], {
        duration: parseFloat(getComputedStyle(box).getPropertyValue('--fl-dur-state')) || 260,
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
  return (
    <aside className="context-panel card" ref={card} aria-label="Context">
      <div className="panel-inner" ref={inner}>
        <div className="panel-state" key={stateKey}>
          {state.kind === 'task' && <TaskDetails state={state} handlers={handlers} />}
          {state.kind === 'upnext' && <UpNext items={upNext} handlers={handlers} />}
          {state.kind === 'note' && (
            <NoteOutline
              text={state.text}
              edited={state.edited}
              current={current}
              handlers={handlers}
            />
          )}
          {state.kind === 'page' && (
            <PageOutline task={state.task} current={current} upNext={upNext} handlers={handlers} />
          )}
        </div>
      </div>
    </aside>
  );
}

function PanelHead(props: {
  readonly label: string;
  readonly meta?: string;
  readonly handlers: PanelHandlers;
  readonly openPage?: () => void;
}): ReactElement {
  const { label, meta, handlers, openPage } = props;
  return (
    <header className="panel-head">
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
      <PanelHead label="Task" handlers={handlers} openPage={() => handlers.onOpenPage(task.key)} />
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
      {(task.created || task.edited) && (
        <footer className="panel-foot">
          {[task.created && `Created ${task.created}`, task.edited && `edited ${task.edited}`]
            .filter(Boolean)
            .join(' · ')}
        </footer>
      )}
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
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
] as const;

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
      {items.length === 0 && <p className="panel-empty">No reminders today or tomorrow.</p>}
      {GROUPS.map(([group, label]) => {
        const rows = items.filter((item) => item.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className="panel-section">
            <span className="panel-label">{label}</span>
            {rows.map((item) => (
              <button
                key={`${item.listId}/${item.key}`}
                type="button"
                className={`panel-item ${group}`}
                onClick={() => handlers.onGo(item)}
              >
                <span className="panel-item-when">
                  {group === 'overdue' && (
                    <span className="reminder overdue">
                      <span className="reminder-bell">
                        <ReminderBellIcon />
                        <span className="overdue-dot" aria-hidden="true" />
                      </span>
                    </span>
                  )}
                  {item.when}
                </span>
                <span className="panel-item-title">{item.title}</span>
                <span className="panel-item-list">{item.listName}</span>
              </button>
            ))}
          </section>
        );
      })}
      <footer className="panel-foot">
        Select a task to see its details here · Ctrl+\ hides the panel
      </footer>
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
  return (
    <nav className="outline" aria-label="Outline">
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
  readonly current: number;
  readonly handlers: PanelHandlers;
}): ReactElement {
  const { text, edited, current, handlers } = props;
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
        {edited && (
          <div className="panel-fact">
            <span>Edited</span>
            <span className="panel-fact-value">{edited}</span>
          </div>
        )}
      </section>
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
    </>
  );
}
