import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { TaskRow } from '../../shared/ipc.js';
import { titlePlain } from '../../shared/inline-markdown.js';
import { ChevronIcon, CloseIcon } from './icons.js';

/**
 * Find in a task list (NAV-06, D-72, D-88): Ctrl+F opens the find bar, in the note's style, at the
 * top right of the list. Titles and notes are searched, the Completed section included; nothing is
 * filtered. Matches are highlighted (the CSS Custom Highlight API, so no row is drawn again); Enter
 * and Shift+Enter go to the next and previous one, opening a folded body or Completed section to
 * show it; Esc closes the bar and keeps the selection on the last match.
 */

export interface FindMatch {
  readonly row: TaskRow;
  /** Where the text was found: its title, or only its notes. */
  readonly where: 'title' | 'body';
}

/** The tasks whose title or notes contain the text (any case), in the order shown. */
export function findMatches(rows: readonly TaskRow[], text: string): FindMatch[] {
  const query = text.trim().toLowerCase();
  if (query === '') return [];
  return rows.flatMap((row): FindMatch[] => {
    const title = (row.title === '' ? row.label : titlePlain(row.title)).toLowerCase();
    if (title.includes(query)) return [{ row, where: 'title' }];
    return row.body.toLowerCase().includes(query) ? [{ row, where: 'body' }] : [];
  });
}

const ALL = 'flint-find';
const CURRENT = 'flint-find-current';

/** Highlights every visible occurrence in the list's titles and notes (and the current row's). */
function paint(root: HTMLElement | null, text: string, current: string | null): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
  const query = text.trim().toLowerCase();
  if (!root || query === '') return;
  const all: Range[] = [];
  const mine: Range[] = [];
  for (const holder of root.querySelectorAll<HTMLElement>(
    '.card.tasks .title, .card.completed .title, .card.tasks .body-view, .card.completed .body-view',
  )) {
    const key = holder.closest<HTMLElement>('[data-key]')?.dataset['key'] ?? null;
    const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent?.toLowerCase() ?? '';
      for (let at = value.indexOf(query); at >= 0; at = value.indexOf(query, at + query.length)) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + query.length);
        (key !== null && key === current ? mine : all).push(range);
      }
    }
  }
  CSS.highlights.set(ALL, new Highlight(...all));
  CSS.highlights.set(CURRENT, new Highlight(...mine));
}

export function ListFind(props: {
  /** The tasks in the order shown: open ones with their subtasks, then completed ones. */
  readonly rows: readonly TaskRow[];
  /** The list's scrolling area, where the highlights are drawn. */
  readonly root: HTMLElement | null;
  /** Something that changes whenever the list is drawn again (for the highlights). */
  readonly version: unknown;
  readonly onJump: (match: FindMatch) => void;
  readonly onClose: () => void;
}): ReactElement {
  const { rows, root, version, onJump, onClose } = props;
  const [text, setText] = useState('');
  const [at, setAt] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findMatches(rows, text), [rows, text]);
  const current = matches[at]?.row.key ?? null;
  useEffect(() => {
    input.current?.focus();
    return () => paint(null, '', null);
  }, []);
  // After every draw of the list, so new rows (and opened bodies) are highlighted too.
  useLayoutEffect(() => paint(root, text, current), [root, text, current, version, rows]);
  const go = (step: 1 | -1): void => {
    if (matches.length === 0) return;
    const next =
      at < 0 ? (step > 0 ? 0 : matches.length - 1) : (at + step + matches.length) % matches.length;
    setAt(next);
    const match = matches[next];
    if (match) onJump(match);
  };
  const count =
    text.trim() === ''
      ? ''
      : matches.length === 0
        ? 'No matches'
        : at >= 0
          ? `${at + 1} of ${matches.length}`
          : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
  return (
    <div className="fl-find list-find" role="search">
      <input
        ref={input}
        className="fl-find-input"
        placeholder="Find in list"
        aria-label="Find in list"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setAt(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            go(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="fl-find-count">{count}</span>
      <button
        type="button"
        className="fl-find-button up"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => go(-1)}
      >
        <ChevronIcon size={13} />
      </button>
      <button
        type="button"
        className="fl-find-button down"
        title="Next match (Enter)"
        aria-label="Next match"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => go(1)}
      >
        <ChevronIcon size={13} />
      </button>
      <button
        type="button"
        className="fl-find-button"
        title="Close (Esc)"
        aria-label="Close"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
