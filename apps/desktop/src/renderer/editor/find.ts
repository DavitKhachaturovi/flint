import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, type Panel, type ViewUpdate } from '@codemirror/view';

/**
 * Find in notes (NAV-06, D-72, D-84): Ctrl+F opens Flint's find bar on CodeMirror's search, at the
 * top of the note (it stays in view while the page scrolls). Typing searches; Enter and Shift+Enter
 * go to the next and previous match, the bar counts them ("2 of 5"); Esc closes it and leaves the
 * cursor on the last match. Nothing is filtered.
 */

const ICON = {
  up: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"></path></svg>',
  down: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>',
  close:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
} as const;

/** "2 of 5", or "No matches"; at most 999 are counted. */
function countText(view: EditorView): string {
  const query = getSearchQuery(view.state);
  if (!query.valid || query.search === '') return '';
  const head = view.state.selection.main;
  let total = 0;
  let current = 0;
  const cursor = query.getCursor(view.state);
  for (let next = cursor.next(); !next.done && total < 999; next = cursor.next()) {
    total++;
    if (next.value.from === head.from && next.value.to === head.to) current = total;
  }
  if (total === 0) return 'No matches';
  return current > 0 ? `${current} of ${total}` : `${total} ${total === 1 ? 'match' : 'matches'}`;
}

function findBar(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'fl-find';
  const input = document.createElement('input');
  input.className = 'fl-find-input';
  input.placeholder = 'Find in note';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Find in note');
  input.value = getSearchQuery(view.state).search;
  const count = document.createElement('span');
  count.className = 'fl-find-count';
  const button = (label: string, icon: string, run: () => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'fl-find-button';
    element.title = label;
    element.setAttribute('aria-label', label);
    element.innerHTML = icon; // constant markup only
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', run);
    return element;
  };
  const query = (): void => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value })) });
    if (input.value !== '') findNext(view);
    view.dom.ownerDocument.defaultView?.requestAnimationFrame(() => input.focus());
  };
  input.addEventListener('input', query);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel(view);
      view.focus();
    }
  });
  dom.append(
    input,
    count,
    button('Previous match (Shift+Enter)', ICON.up, () => findPrevious(view)),
    button('Next match (Enter)', ICON.down, () => findNext(view)),
    button('Close (Esc)', ICON.close, () => {
      closeSearchPanel(view);
      view.focus();
    }),
  );
  return {
    dom,
    top: true,
    mount: () => {
      input.focus();
      input.select();
      count.textContent = countText(view);
    },
    update: (update: ViewUpdate) => {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.length > 0)
      )
        count.textContent = countText(view);
    },
  };
}

export function findInNote(): Extension {
  return [
    search({ top: true, createPanel: findBar }),
    keymap.of([{ key: 'Mod-f', run: openSearchPanel, preventDefault: true }]),
  ];
}

/** Ctrl+F on a note's page while the editor isn't focused: the find bar of the note there. */
export function openFindIn(root: ParentNode): boolean {
  const content = root.querySelector<HTMLElement>('.note-editor .cm-editor');
  const view = content ? EditorView.findFromDOM(content) : null;
  return view ? openSearchPanel(view) : false;
}
