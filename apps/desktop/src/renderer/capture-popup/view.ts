import { knownLinks } from '../../shared/link-patterns.js';
import type { CaptureBlock, CaptureParse, ListInfo, Token, TokenKind } from '@flint/core/shorthand';
import type { AttachmentChip } from '../../shared/ipc.js';
import { enableAutoPair } from '../auto-pair.js';

/**
 * What the popup shows for the parsed text (CAP-04, CAP-05, D-25, D-29): chips, the `##` menu, the
 * new-list card and the target. User text and list names are only ever set as text.
 */

const ICONS = {
  hash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"></path></svg>',
  bell: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path></svg>',
  x: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>',
  link: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7h2"></path><path d="M15 7h2a5 5 0 1 1 0 10h-2"></path><path d="M8 12h8"></path></svg>',
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
  attachments: readonly AttachmentChip[],
  detach: (attachment: AttachmentChip) => void,
): void {
  const chips: HTMLElement[] = [];
  const winner = (kind: TokenKind): Token | undefined =>
    parsed.tokens.find((token) => token.kind === kind && token.role === 'winner');
  const chip = (lead: HTMLElement | null, label: string, onRemove?: () => void): void => {
    const node = element('span', 'chip');
    if (lead) node.append(lead);
    node.append(label);
    if (onRemove) {
      const button = element('button', 'x');
      button.type = 'button';
      button.setAttribute('aria-label', `Remove ${label}`);
      button.innerHTML = ICONS.x;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', onRemove);
      node.append(button);
    }
    chips.push(node);
  };
  const removing = (token: Token | undefined): (() => void) | undefined =>
    token ? () => remove(token) : undefined;

  if (parsed.priority) {
    const stripe = element('span', 'stripe');
    const [color, width] = PRIORITY_STRIPE[parsed.priority];
    stripe.style.setProperty('--color', `var(${color})`);
    stripe.style.setProperty('--width', `var(${width})`);
    chip(
      stripe,
      counted(parsed, 'priority', PRIORITY_LABEL[parsed.priority]),
      removing(winner('priority')),
    );
  }
  if (parsed.target.kind !== 'inbox') {
    chip(icon(ICONS.hash), counted(parsed, 'list', targetName(parsed)), removing(winner('list')));
  }
  if (parsed.reminderLabel) {
    chip(
      icon(ICONS.bell),
      counted(parsed, 'reminder', parsed.reminderLabel),
      removing(winner('reminder')),
    );
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
  // D-105: the links the text will show (a pasted URL as its short form), while it is typed.
  for (const link of knownLinks(parsed.title)) {
    chip(icon(ICONS.link), link.label);
    chips.at(-1)?.setAttribute('title', link.href);
    chips.at(-1)?.classList.add('link-chip');
  }
  for (const attachment of attachments) {
    const thumb = element('img', 'thumb');
    thumb.src = attachment.thumbnail;
    thumb.alt = '';
    chip(thumb, attachment.name, () => detach(attachment));
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
  // D-89: the highlighted list stays in view past the five visible rows.
  rows[selected]?.scrollIntoView({ block: 'nearest' });
}

const KIND_LABEL = { json: 'JSON', 'stack-trace': 'Stack trace', code: 'Code' } as const;
/** Lines a collapsed code block shows (D-38: a compact preview, expandable). */
const PREVIEW_LINES = 4;
const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';

export interface BlockHandlers {
  readonly remove: (index: number) => void;
  readonly toggle: (index: number) => void;
  readonly edit: (index: number, text: string) => void;
  readonly key: (event: KeyboardEvent, index: number, field: HTMLTextAreaElement) => void;
}

/** The selection area (D-38): code as a compact, highlighted preview; text and notes editable. */
export function renderBlocks(
  box: HTMLElement,
  blocks: readonly CaptureBlock[],
  expanded: ReadonlySet<number>,
  handlers: BlockHandlers,
  highlight: (kind: CaptureBlock['kind'], lines: readonly string[]) => HTMLElement[],
): void {
  const removeButton = (index: number, label: string): HTMLButtonElement => {
    const button = element('button', 'x');
    button.type = 'button';
    button.setAttribute('aria-label', `Remove ${label}`);
    button.innerHTML = ICONS.x;
    button.addEventListener('click', () => handlers.remove(index));
    return button;
  };
  const sections = blocks.map((block, index) => {
    if (block.kind === 'text' || block.kind === 'note') {
      const section = element('section', `block ${block.kind}`);
      const field = element('textarea', 'block-text');
      // UI-09: auto-closing brackets and quotes in notes and editable selections too.
      enableAutoPair(field);
      field.rows = 1;
      field.spellcheck = false;
      field.value = block.text;
      field.setAttribute('aria-label', block.kind === 'note' ? 'Note' : 'Selected text');
      if (block.kind === 'note') field.placeholder = 'Add a note…';
      field.addEventListener('input', () => {
        handlers.edit(index, field.value);
        fitHeight(field);
      });
      field.addEventListener('keydown', (event) => handlers.key(event, index, field));
      section.append(field, removeButton(index, block.kind === 'note' ? 'note' : 'text'));
      return section;
    }
    const lines = block.text.split(/\r\n|\r|\n/);
    const open = expanded.has(index);
    const section = element('section', 'block code');
    const head = element('header', 'block-head');
    const label = `${KIND_LABEL[block.kind]} · ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`;
    head.append(element('span', 'block-label', label));
    if (lines.length > PREVIEW_LINES) {
      const toggle = element('button', open ? 'block-toggle open' : 'block-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Show less' : 'Show all');
      toggle.innerHTML = CHEVRON;
      toggle.addEventListener('mousedown', (event) => event.preventDefault());
      toggle.addEventListener('click', () => handlers.toggle(index));
      head.append(toggle);
    }
    head.append(removeButton(index, label));
    const code = element('pre', open ? 'block-code open' : 'block-code');
    code.append(...highlight(block.kind, open ? lines : lines.slice(0, PREVIEW_LINES)));
    section.append(head, code);
    return section;
  });
  box.replaceChildren(...sections);
  box.hidden = sections.length === 0;
  for (const field of box.querySelectorAll('textarea')) fitHeight(field);
}

export function fitHeight(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}
