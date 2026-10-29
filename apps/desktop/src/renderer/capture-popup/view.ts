import type { CaptureParse, ListInfo, Token, TokenKind } from '@flint/core/shorthand';

/**
 * What the popup shows for the parsed text (CAP-04, CAP-05, D-25, D-29): chips, the `##` menu, the
 * new-list card and the target. User text and list names are only ever set as text.
 */

const ICONS = {
  hash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"></path></svg>',
  bell: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path></svg>',
  x: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>',
} as const;

const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const PRIORITY_STRIPE = {
  high: ['--fl-pri-high-color', '--fl-pri-high-width'],
  medium: ['--fl-pri-med-color', '--fl-pri-med-width'],
  low: ['--fl-pri-low-color', '--fl-pri-low-width'],
} as const;
const PLURAL: Record<TokenKind, string> = {
  priority: 'priorities',
  list: 'lists',
  reminder: 'times',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(svg: string): HTMLElement {
  const span = element('span', 'icon');
  span.innerHTML = svg; // constant markup only
  return span;
}

/** `2 lists → Unicorn` when an earlier valid token of the same kind stays as text (D-25). */
function counted(parsed: CaptureParse, kind: TokenKind, label: string): string {
  const count = parsed.counts[kind];
  return count > 1 ? `${count} ${PLURAL[kind]} → ${label}` : label;
}

export function targetName(parsed: CaptureParse): string {
  const target = parsed.target;
  if (target.kind === 'existing' || target.kind === 'close-match') return target.list.name;
  if (target.kind === 'new') return `New list "${target.name}"`;
  return 'Inbox';
}

export function renderChips(
  box: HTMLElement,
  parsed: CaptureParse,
  remove: (token: Token) => void,
): void {
  const chips: HTMLElement[] = [];
  const winner = (kind: TokenKind): Token | undefined =>
    parsed.tokens.find((token) => token.kind === kind && token.role === 'winner');
  const chip = (lead: HTMLElement | null, label: string, token?: Token): void => {
    const node = element('span', 'chip');
    if (lead) node.append(lead);
    node.append(label);
    if (token) {
      const button = element('button', 'x');
      button.type = 'button';
      button.setAttribute('aria-label', `Remove ${label}`);
      button.innerHTML = ICONS.x;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => remove(token));
      node.append(button);
    }
    chips.push(node);
  };

  if (parsed.priority) {
    const stripe = element('span', 'stripe');
    const [color, width] = PRIORITY_STRIPE[parsed.priority];
    stripe.style.setProperty('--color', `var(${color})`);
    stripe.style.setProperty('--width', `var(${width})`);
    chip(stripe, counted(parsed, 'priority', PRIORITY_LABEL[parsed.priority]), winner('priority'));
  }
  if (parsed.target.kind !== 'inbox') {
    chip(icon(ICONS.hash), counted(parsed, 'list', targetName(parsed)), winner('list'));
  }
  if (parsed.reminderLabel) {
    chip(icon(ICONS.bell), counted(parsed, 'reminder', parsed.reminderLabel), winner('reminder'));
  }
  for (const ignored of parsed.ignoredLists) {
    const note =
      ignored.kind === 'note'
        ? `${ignored.list.name} is a note → Inbox`
        : ignored.kind === 'invalid-name'
          ? `"${ignored.name}" can't be a list name → Inbox`
          : null;
    if (note) {
      const node = element('span', 'chip note', note);
      chips.push(node);
    }
  }
  box.replaceChildren(...chips);
}

/** D-25: Enter is the only key that saves; Tab flips between the close match and a new list. */
export function renderChoice(
  box: HTMLElement,
  parsed: CaptureParse,
  /** The close match the user flipped away from with Tab, if any. */
  flippedFrom: ListInfo | null,
): void {
  const option = (label: string, key: string, selected: boolean): HTMLElement => {
    const node = element('span', selected ? 'option selected' : 'option', label);
    node.append(element('span', 'key', key));
    return node;
  };
  const target = parsed.target;
  if (target.kind === 'new' && flippedFrom) {
    // The card visibly flips (D-29): the new list is selected, Tab goes back to the match.
    box.replaceChildren(
      option(`New list "${target.name}"`, 'Enter', true),
      option(flippedFrom.name, 'Tab', false),
    );
  } else if (target.kind === 'close-match') {
    box.replaceChildren(
      option(target.list.name, 'Enter', true),
      option(`New list "${target.name}"`, 'Tab', false),
    );
  } else if (target.kind === 'new') {
    box.replaceChildren(option(`New list "${target.name}"`, 'Enter', true));
  } else {
    box.replaceChildren();
  }
  box.hidden = box.childElementCount === 0;
}

export function renderSuggestions(
  box: HTMLElement,
  lists: readonly ListInfo[],
  selected: number,
  choose: (list: ListInfo) => void,
): void {
  const rows = lists.map((list, index) => {
    const row = element('li', 'suggestion');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === selected));
    const tile = element('span', 'tile');
    tile.innerHTML = ICONS.hash;
    row.append(tile, element('span', 'name', list.name));
    row.addEventListener('mousedown', (event) => event.preventDefault());
    row.addEventListener('click', () => choose(list));
    return row;
  });
  box.replaceChildren(...rows);
  box.hidden = rows.length === 0;
}
