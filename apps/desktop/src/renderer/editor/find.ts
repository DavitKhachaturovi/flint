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
  let unplace = (): void => undefined;
  return {
    dom,
    top: true,
    mount: () => {
      input.focus();
      input.select();
      count.textContent = countText(view);
      unplace = placeOnPage(view, dom);
    },
    destroy: () => {
      unplace();
      leave(dom);
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

/**
 * D-91: on a note's (or a task's) page the bar sits as the task list's does: level with the title
 * row at the top, then level with the context panel's top (or 16 px) while the page scrolls. It
 * takes no room in the note (`.fl-find-page`). Elsewhere (a body, the panel) it stays in the editor.
 */
function placeOnPage(view: EditorView, bar: HTMLElement): () => void {
  const page = view.dom.closest<HTMLElement>('.content.note-page, .content.task-page');
  const root = page?.closest<HTMLElement>('.scroller');
  const holder = bar.parentElement;
  if (!page || !root || !holder) return () => undefined;
  holder.classList.add('fl-find-page');
  const place = (): void => {
    const title = page.querySelector<HTMLElement>('h1');
    const panel = root.querySelector<HTMLElement>('.context-panel:not(.panel-ghost)');
    const area = root.getBoundingClientRect();
    const stuck = area.top + (panel ? parseFloat(getComputedStyle(panel).top) || 16 : 16);
    const box = title?.getBoundingClientRect();
    const level = box ? box.top + (box.height - bar.offsetHeight) / 2 : stuck;
    bar.style.translate = `0 ${Math.max(stuck, level) - holder.getBoundingClientRect().top}px`;
  };
  place();
  root.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);
  return () => {
    root.removeEventListener('scroll', place);
    window.removeEventListener('resize', place);
  };
}

/** D-89, D-91: the bar fades away where it was (CodeMirror removes it at once). */
function leave(bar: HTMLElement): void {
  if (!bar.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = bar.getBoundingClientRect();
  const ghost = bar.cloneNode(true) as HTMLElement;
  ghost.classList.add('fl-find-ghost');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    margin: '0',
    translate: 'none',
  });
  ghost.inert = true;
  document.body.append(ghost);
  ghost.addEventListener('animationend', () => ghost.remove());
  window.setTimeout(() => ghost.remove(), 600);
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
