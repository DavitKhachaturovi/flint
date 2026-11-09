import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  CLAUDE_PROMPT_LIMIT,
  buildPrompt,
  folderName,
  planHandoff,
  type PromptTask,
} from '../../shared/claude.js';
import type { ClaudeState, GiveToClaudeOutcome, TaskRow } from '../../shared/ipc.js';

/**
 * Give to Claude (TASK-18, D-151): a palette-style card. The list's folder first, then the recent
 * ones, then Choose a folder…; Enter gives the task to the one picked, Shift+Enter also makes it the
 * list's folder, Esc closes. The footer says how long the prompt is (and, too long for a link,
 * that it goes to the clipboard) before anything is given. The prompt isn't edited here: Claude
 * opens with it in its composer, not sent.
 */
export interface GiveToClaudeProps {
  readonly task: TaskRow;
  /** A subtask given on its own: its parent (D-151: a `Part of:` line). */
  readonly parent: TaskRow | null;
  /** The task's list, for its folder; null where a task has none. */
  readonly list: { readonly id: string; readonly name: string } | null;
  readonly onClose: () => void;
  /** After giving: what happened, and to which folder (the toast is the window's). */
  readonly onGiven: (outcome: GiveToClaudeOutcome, folder: string) => void;
}

interface FolderRow {
  readonly kind: 'folder';
  readonly path: string;
  readonly tag: 'list' | 'recent';
  readonly missing: boolean;
}
type Row = FolderRow | { readonly kind: 'choose' };

const count = (value: number): string => value.toLocaleString('en-US');

export function promptTask(task: TaskRow, parent: TaskRow | null): PromptTask {
  return {
    title: task.title || task.label,
    body: task.body,
    subtasks: task.subtasks.map((subtask) => ({
      title: subtask.title || subtask.label,
      done: subtask.done,
      body: subtask.body,
    })),
    ...(parent ? { partOf: parent.title || parent.label } : {}),
  };
}

export function GiveToClaude(props: GiveToClaudeProps): ReactElement {
  const { task, parent, list, onClose, onGiven } = props;
  const [state, setState] = useState<ClaudeState | null>(null);
  const [selected, setSelected] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    let live = true;
    void window.flintMain.claudeState().then((next) => {
      if (live && next) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);
  useLayoutEffect(() => card.current?.focus(), []);

  // By the list's id, not its object: the window makes a new one on every render, and a refresh
  // behind the card must never move the folder picked.
  const listId = list?.id ?? null;
  const rows = useMemo((): Row[] => {
    if (!state) return [];
    const missing = new Set(state.missing.map((path) => path.toLowerCase()));
    const own = listId !== null ? state.folders[listId] : undefined;
    const folders: FolderRow[] = [];
    const add = (path: string, tag: FolderRow['tag']): void => {
      if (folders.some((row) => row.path.toLowerCase() === path.toLowerCase())) return;
      folders.push({ kind: 'folder', path, tag, missing: missing.has(path.toLowerCase()) });
    };
    if (own) add(own, 'list');
    for (const path of state.recent) add(path, 'recent');
    return [...folders, { kind: 'choose' }];
  }, [state, listId]);

  // The first folder that is still there (else Choose a folder…) is picked once the folders load.
  useEffect(() => {
    const first = rows.findIndex((row) => row.kind === 'choose' || !row.missing);
    setSelected(Math.max(0, first));
    // Only when they load (`rows` follows `state`): never again while the card is open.
  }, [state]);

  const prompt = useMemo(
    () => (state ? buildPrompt(promptTask(task, parent), state.flintFolder) : ''),
    [state, task, parent],
  );
  const current = rows[selected];
  const near = rows.find((row): row is FolderRow => row.kind === 'folder' && !row.missing);
  // The link's length depends on the folder too: the one picked, else the nearest one.
  const handoff = planHandoff(
    prompt,
    current?.kind === 'folder' ? current.path : (near?.path ?? 'C:\\'),
  );

  const close = (then?: () => void): void => {
    // Once closing, the card takes nothing more (a second Enter, an Esc losing the toast).
    if (leaving) return;
    pending.current = then ?? null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setLeaving(true);
  };
  const finish = (): void => {
    const then = pending.current;
    pending.current = null;
    onClose();
    then?.();
  };

  /** Gives once: after a give that worked the card only closes. */
  const give = async (folder: string, makeDefault: boolean): Promise<void> => {
    busy.current = true;
    let outcome: GiveToClaudeOutcome | null = null;
    try {
      outcome = await window.flintMain.giveToClaude({ prompt, folder, list: listId, makeDefault });
    } finally {
      if (!outcome) busy.current = false;
    }
    if (outcome) close(() => onGiven(outcome, folder));
  };
  const choose = async (makeDefault: boolean): Promise<void> => {
    busy.current = true;
    let path: string | null;
    try {
      path = await window.flintMain.chooseClaudeFolder(near?.path ?? null);
    } finally {
      busy.current = false;
      card.current?.focus();
    }
    if (path) await give(path, makeDefault);
  };
  const run = (row: Row | undefined, makeDefault: boolean): void => {
    if (!row || !state || busy.current || leaving) return;
    if (row.kind === 'choose') void choose(makeDefault);
    else if (!row.missing) void give(row.path, makeDefault);
  };
  const move = (step: 1 | -1): void => {
    for (let at = selected + step; at >= 0 && at < rows.length; at += step) {
      const row = rows[at];
      if (row && (row.kind === 'choose' || !row.missing)) {
        setSelected(at);
        return;
      }
    }
  };

  return (
    <div
      className={leaving ? 'palette-layer leaving' : 'palette-layer'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) finish();
      }}
    >
      <div
        ref={card}
        className="palette give-to-claude"
        role="dialog"
        aria-label="Give to Claude"
        tabIndex={-1}
        onKeyDown={(event) => {
          // The card is modal: its keys are its own, never the list's behind it.
          event.stopPropagation();
          if (event.key === 'Escape') close();
          else if (event.key === 'ArrowDown') move(1);
          else if (event.key === 'ArrowUp') move(-1);
          else if (event.key === 'Enter') run(current, event.shiftKey);
          else if (event.key.toLowerCase() === 'o' && event.ctrlKey)
            run({ kind: 'choose' }, event.shiftKey);
          else return;
          event.preventDefault();
        }}
      >
        <div className="palette-head">
          <span className="palette-crumb">Give to Claude ›</span>
          <span className="give-title">{task.title || task.label}</span>
        </div>
        <div className="palette-results" role="listbox" aria-label="Folders">
          <div className="palette-label">Open Claude Code in</div>
          {rows.map((row, at) => {
            const on = at === selected;
            const missing = row.kind === 'folder' && row.missing;
            return (
              <div
                key={row.kind === 'folder' ? row.path : 'choose'}
                role="option"
                aria-selected={on}
                aria-disabled={missing || undefined}
                data-index={at}
                className={['palette-item', on ? 'on' : '', missing ? 'missing' : ''].join(' ')}
                onMouseMove={() => {
                  if (!on && !missing) setSelected(at);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => run(row, event.shiftKey)}
              >
                {row.kind === 'folder' ? (
                  <>
                    <span className="palette-text">{folderName(row.path)}</span>
                    <span className="palette-detail give-path" title={row.path}>
                      {row.path}
                    </span>
                    <span className="give-tag">
                      {row.missing
                        ? 'Not found'
                        : row.tag === 'list'
                          ? `${list?.name ?? 'List'}'s folder`
                          : 'Recent'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="palette-text">Choose a folder…</span>
                    <span className="keycap">Ctrl O</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="give-count" aria-live="polite">
          {!state
            ? ' '
            : handoff.via === 'link'
              ? `${count(handoff.characters)} / ${count(CLAUDE_PROMPT_LIMIT)} characters · about ${count(handoff.tokens)} tokens`
              : `Too long for a link (${count(handoff.characters)} characters, about ${count(handoff.tokens)} tokens): Flint copies it, paste it into Claude with Ctrl+V`}
        </div>
        <div className="palette-foot" aria-hidden="true">
          <span>
            <span className="keycap">Enter</span> give
          </span>
          {list && (
            <span>
              <span className="keycap">Shift Enter</span> and make it {list.name}'s folder
            </span>
          )}
          <span>
            <span className="keycap">Esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
