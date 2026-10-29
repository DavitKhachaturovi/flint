import {
  listToken,
  listTokenAt,
  parseCapture,
  suggestLists,
  type CaptureParse,
  type ListInfo,
  type Token,
} from '@flint/core/shorthand';
import flintIcon from '../../../../../assets/icon/flint-icon-16.svg';
import { epochNow, type PopupNotice } from '../../shared/ipc.js';
import { renderChips, renderChoice, renderSuggestions, targetName } from './view.js';

/**
 * The capture popup (CAP-01). Kept tiny on purpose (CAP-10): the text box with live shorthand
 * chips (CAP-04), `##` autocomplete and the new-list card (CAP-05), the follow-up notice (D-26),
 * and the bridge calls. Paste handling joins in M3.
 */

function required<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`capture popup markup missing ${selector}`);
  return found;
}

const input = required<HTMLTextAreaElement>('#capture');
const chipsBox = required<HTMLElement>('.chips');
const suggestionsBox = required<HTMLElement>('#suggestions');
const choiceBox = required<HTMLElement>('.choice');
const targetLabel = required<HTMLElement>('.target-name');
const noticeBox = required<HTMLElement>('.notice');
const noticeText = required<HTMLElement>('.notice-text');
const noticeAction = required<HTMLButtonElement>('.notice-action');
const noticeClose = required<HTMLButtonElement>('.notice-close');
required<HTMLImageElement>('.target-icon').src = flintIcon;

let lists: readonly ListInfo[] = [];
let notice: PopupNotice | null = null;
/** The `##` name the user pressed Tab on: create it instead of the close match (D-25). */
let chooseNewFor: string | null = null;
let suggestions: ListInfo[] = [];
let selected = -1;
let parsed: CaptureParse = parseCapture('', { now: new Date(), lists });

function firstLineCaret(): { line: string; caret: number } | null {
  const caret = input.selectionStart;
  const lineEnd = input.value.search(/\r\n|\r|\n/);
  const line = lineEnd < 0 ? input.value : input.value.slice(0, lineEnd);
  return caret <= line.length ? { line, caret } : null;
}

/** Re-parses and redraws everything that depends on the text (CAP-04: the chips are the truth). */
function update(): void {
  const now = new Date();
  let next = parseCapture(input.value, { now, lists });
  let flippedFrom: ListInfo | null = null;
  if (chooseNewFor && next.target.kind === 'close-match' && next.target.name === chooseNewFor) {
    flippedFrom = next.target.list;
    next = parseCapture(input.value, { now, lists, chooseNewList: true });
  } else {
    chooseNewFor = null;
  }
  parsed = next;
  renderChips(chipsBox, parsed, removeToken);
  renderChoice(choiceBox, parsed, flippedFrom);
  targetLabel.textContent = targetName(parsed);

  const position = firstLineCaret();
  const token = position ? listTokenAt(position.line, position.caret) : null;
  const next5 = token ? suggestLists(token.typed, lists).slice(0, 5) : [];
  if (next5.map((list) => list.id).join() !== suggestions.map((list) => list.id).join()) {
    selected = -1;
  }
  suggestions = next5;
  renderSuggestions(suggestionsBox, suggestions, selected, chooseList);
}

/** Replaces the `##` token at the caret with the list's own spelling (CAP-05). */
function chooseList(list: ListInfo): void {
  const position = firstLineCaret();
  const token = position ? listTokenAt(position.line, position.caret) : null;
  if (!token) return;
  const replacement = `##${listToken(list.name)}`;
  input.setRangeText(replacement, token.start, token.end, 'end');
  changed();
}

/** A chip's × removes its token from the text, with one space around it. */
function removeToken(token: Token): void {
  const text = input.value;
  let start = token.start;
  let end = token.end;
  if (text[end] === ' ') end++;
  else if (start > 0 && text[start - 1] === ' ') start--;
  input.setRangeText('', start, end, 'end');
  changed();
  input.focus();
}

/** The tool buttons type the shorthand for you (mockup 02): `!h`, `##`, `@`. */
function insertToken(token: string): void {
  const at = input.selectionStart;
  const before = at > 0 && !/\s/.test(input.value[at - 1] ?? '') ? ' ' : '';
  input.setRangeText(`${before}${token}`, at, input.selectionEnd, 'end');
  changed();
  input.focus();
}

function changed(): void {
  grow();
  update();
  saveDraft();
}

function showNotice(next: PopupNotice | null): void {
  notice = next;
  noticeBox.hidden = next === null;
  if (next?.kind === 'created-list') {
    noticeText.textContent = `Created list ${next.name}`;
    noticeAction.textContent = 'Undo';
  } else if (next?.kind === 'save-failed') {
    noticeText.textContent = "Couldn't save your last capture";
    noticeAction.textContent = 'Retry';
  }
}

/** The box grows with Shift+Enter lines and pasted text, up to its CSS max-height. */
function grow(): void {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

let draftTimer: number | undefined;
/** CAP-08: the main process keeps the draft; sent shortly after typing stops, and on close. */
function saveDraft(now = false): void {
  window.clearTimeout(draftTimer);
  const send = (): void => window.flintPopup.saveDraft(input.value);
  if (now) send();
  else draftTimer = window.setTimeout(send, 250);
}

function submit(): void {
  window.clearTimeout(draftTimer);
  const keyAt = epochNow();
  const text = input.value;
  const chooseNewList = chooseNewFor !== null && parsed.target.kind === 'new';
  void window.flintPopup.submit({ text, keyAt, chooseNewList }).then((ack) => {
    // D-27: the box empties once the main process has the capture; the saved draft is cleared
    // only after the write is confirmed.
    if (ack.accepted) {
      input.value = '';
      chooseNewFor = null;
      grow();
      update();
      showNotice(null);
    }
  });
}

function undo(): void {
  window.flintPopup.noticeAction('undo');
  showNotice(null);
}

window.flintPopup.onShown(({ hotkeyAt, draft, notice: next, lists: current }) => {
  lists = current;
  // The saved draft only fills an empty box (after a restart, or a failed save, D-27): what is in
  // the box is newer than the copy the main process keeps, which trails typing by a moment.
  if (input.value === '' && draft !== '') {
    input.value = draft;
    grow();
  }
  update();
  showNotice(next);
  input.focus();
  const focusedAt = epochNow();
  // Two animation frames: the first frame with the focused input has been produced (R-1).
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      window.flintPopup.reportFocused({
        hotkeyAt,
        focusedAt,
        frameAt: epochNow(),
        documentFocused: document.hasFocus(),
        inputFocused: document.activeElement === input,
      });
    }),
  );
});

input.addEventListener('input', changed);
// The caret moving in or out of a `##` token opens or closes the menu.
document.addEventListener('selectionchange', () => {
  if (document.activeElement === input) update();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    saveDraft(true);
    window.flintPopup.dismiss();
  } else if (event.key === 'Enter' && !event.shiftKey) {
    // Enter is the only key that saves (D-25), also with the menu or the card open.
    event.preventDefault();
    submit();
  } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
    // Proposed (03 §3): ↑/↓ choose another suggested list.
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    selected = (selected + step + suggestions.length) % suggestions.length;
    const list = suggestions[selected];
    if (list) chooseList(list);
  } else if (event.key === 'Tab' && !event.shiftKey) {
    const target = parsed.target;
    if (target.kind === 'close-match') {
      event.preventDefault();
      chooseNewFor = target.name;
      update();
    } else if (target.kind === 'new' && chooseNewFor) {
      event.preventDefault();
      chooseNewFor = null;
      update();
    }
  } else if (
    event.key === 'z' &&
    event.ctrlKey &&
    input.value === '' &&
    notice?.kind === 'created-list'
  ) {
    // Proposed (03 §3): with an empty box, Ctrl+Z undoes `Created list <name>`.
    event.preventDefault();
    undo();
  }
});

// The popup hides when it loses focus; the draft must be saved by then (CAP-08).
window.addEventListener('blur', () => saveDraft(true));

for (const tool of document.querySelectorAll<HTMLButtonElement>('.tool[data-insert]')) {
  tool.addEventListener('mousedown', (event) => event.preventDefault());
  tool.addEventListener('click', () => {
    const token = tool.dataset.insert;
    if (token && token !== 'attach') insertToken(token);
  });
}

required<HTMLButtonElement>('.send').addEventListener('click', submit);

noticeAction.addEventListener('click', () => {
  if (notice?.kind === 'created-list') undo();
  // Retry: the failed capture is back in the box; saving it again is just Enter.
  else if (notice?.kind === 'save-failed') submit();
  input.focus();
});

noticeClose.addEventListener('click', () => {
  window.flintPopup.noticeAction('dismiss');
  showNotice(null);
  input.focus();
});

// The window follows the card, so no invisible part of it blocks clicks (CAP-05 menu, pastes).
new ResizeObserver(() => {
  window.flintPopup.resize(Math.ceil(document.body.getBoundingClientRect().height) + 24);
}).observe(document.body);
