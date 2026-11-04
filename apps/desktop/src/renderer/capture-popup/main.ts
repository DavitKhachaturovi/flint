import { setBuiltInLinksOff, setLinkPatterns } from '../../shared/link-patterns.js';
import {
  blockFor,
  classifyPaste,
  composeCapture,
  escapeInert,
  isCodeBlock,
  listToken,
  listTokenAt,
  parseCapture,
  shiftRanges,
  suggestLists,
  type CaptureBlock,
  type CaptureParse,
  type ListInfo,
  type TextRange,
  type Token,
  type TokenKind,
} from '@flint/core/shorthand';
import flintIcon from '../../../../../assets/icon/flint-icon-16.svg';
import {
  epochNow,
  type AttachmentChip,
  type CaptureDraft,
  type PopupNotice,
  type PopupShown,
} from '../../shared/ipc.js';
import { enableAutoPair } from '../auto-pair.js';
import {
  openListPicker,
  openPriorityPicker,
  openTimePicker,
  type PickerHost,
} from '../pickers/pickers.js';
import { listShorthand, PRIORITY_TOKENS, timeShorthand } from '../../shared/tokens.js';
import { isTextField, openMenu, textFieldMenu } from '../menu/menu.js';
import { highlightLines } from '../highlight/highlight.js';
import {
  fitHeight,
  renderBlocks,
  renderChips,
  renderChoice,
  renderSuggestions,
  targetName,
} from './view.js';

/**
 * The capture popup (CAP-01). Kept tiny on purpose (CAP-10). D-38: a single-line title, the only
 * place shorthand is read (live chips CAP-04, `##` menu and new-list card CAP-05), and below it the
 * selection area for pasted and selected content (CAP-06, CAP-07) and notes (Shift+Enter).
 */

function required<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`capture popup markup missing ${selector}`);
  return found;
}

const input = required<HTMLInputElement>('#capture');
// UI-09: auto-closing brackets and quotes in the title line.
enableAutoPair(input);
const chipsBox = required<HTMLElement>('.chips');
const suggestionsBox = required<HTMLElement>('#suggestions');
const choiceBox = required<HTMLElement>('.choice');
const blocksBox = required<HTMLElement>('.blocks');
const targetLabel = required<HTMLElement>('.target-name');
const noticeBox = required<HTMLElement>('.notice');
const noticeText = required<HTMLElement>('.notice-text');
const noticeAction = required<HTMLButtonElement>('.notice-action');
const noticeClose = required<HTMLButtonElement>('.notice-close');
const previousBox = required<HTMLElement>('.previous');
required<HTMLImageElement>('.target-icon').src = flintIcon;

let lists: readonly ListInfo[] = [];
/** The selection area (D-38). */
let blocks: CaptureBlock[] = [];
const expanded = new Set<number>();
/** Pasted images on this capture (CAP-06); the main process keeps them with the draft. */
let attachments: readonly AttachmentChip[] = [];
/** An image still on its way to the main process; Enter waits for it. */
let attaching: Promise<unknown> = Promise.resolve();
let notice: PopupNotice | null = null;
/** The `##` name the user pressed Tab on: create it instead of the close match (D-25). */
let chooseNewFor: string | null = null;
/** D-40: the first Enter accepts the menu or the card; these remember what was accepted. */
let menuAcceptedFor: string | null = null;
let cardAcceptedFor: string | null = null;
let suggestions: ListInfo[] = [];
let selected = -1;
let parsed: CaptureParse = parseCapture('', { now: new Date(), lists });
/**
 * D-45: stretches of the title that came from a selection or a paste. They are plain text: their
 * `!`, `##` and `@` are never shorthand, also after editing inside them. Only typed text is live.
 */
let inert: TextRange[] = [];
/** The title as it was at the last edit, to move the inert ranges along with each change. */
let lastTitle = '';
/** Maps a position in the parsed (escaped) title back to the title as shown. */
let toShown = (index: number): number => index;

function draft(): CaptureDraft {
  return { title: input.value, blocks, ...(inert.length > 0 ? { inert } : {}) };
}

/** The title as the parser reads it: inert stretches escaped (D-45). */
function parsedTitle(): string {
  return escapeInert(input.value, inert).text;
}

/** Follows an edit of the title. `live`: Flint inserted the text (a token, a list's spelling). */
function syncTitle(live: boolean): void {
  if (input.value === lastTitle) return;
  inert = shiftRanges(inert, lastTitle, input.value, live);
  lastTitle = input.value;
}

/** Sets text into the title from a selection or a paste, as plain text (D-45). */
function insertInert(text: string, start: number, end: number): void {
  input.setRangeText(text, start, end, 'end');
  syncTitle(true);
  if (text !== '') inert = [...inert, { start, end: start + text.length }];
}

function hasContent(): boolean {
  return (
    input.value.trim() !== '' ||
    blocks.some((block) => block.text.trim() !== '') ||
    attachments.length > 0
  );
}

let reportedContent: boolean | null = null;
/** D-41: the main process keeps a popup with content open on click-away. */
function reportContent(): void {
  const now = hasContent();
  if (now !== reportedContent) window.flintPopup.setContent(now);
  reportedContent = now;
}

/** The `##` token the caret is in (CAP-05), with its text. */
function tokenAtCaret(): { start: number; end: number; typed: string; text: string } | null {
  const token = listTokenAt(input.value, input.selectionStart ?? input.value.length);
  // A `##` from a selection or paste is plain text (D-45): no menu for it.
  if (!token || inert.some((range) => token.start >= range.start && token.start < range.end))
    return null;
  return { ...token, text: input.value.slice(token.start, token.end) };
}

/** Re-parses the title and redraws what depends on it (CAP-04: the chips are the truth). */
function update(): void {
  const now = new Date();
  const escaped = escapeInert(input.value, inert);
  toShown = escaped.toOriginal;
  let next = parseCapture(escaped.text, { now, lists });
  let flippedFrom: ListInfo | null = null;
  if (chooseNewFor && next.target.kind === 'close-match' && next.target.name === chooseNewFor) {
    flippedFrom = next.target.list;
    next = parseCapture(escaped.text, { now, lists, chooseNewList: true });
  } else {
    chooseNewFor = null;
  }
  parsed = next;
  renderChips(chipsBox, parsed, removeToken, attachments, detach);
  const target = parsed.target;
  const cardAccepted =
    (target.kind === 'new' || target.kind === 'close-match') && target.name === cardAcceptedFor;
  if (!cardAccepted) cardAcceptedFor = null;
  renderChoice(choiceBox, parsed, flippedFrom);
  if (cardAccepted) choiceBox.hidden = true;
  targetLabel.textContent = targetName(parsed);

  const token = tokenAtCaret();
  if (token && token.text !== menuAcceptedFor) menuAcceptedFor = null;
  // D-89: every matching list; the menu scrolls past five.
  const found = token && menuAcceptedFor === null ? suggestLists(token.typed, lists) : [];
  if (found.map((list) => list.id).join() !== suggestions.map((list) => list.id).join()) {
    selected = -1;
  }
  suggestions = found;
  renderSuggestions(suggestionsBox, suggestions, selected, (list) => {
    acceptSuggestion(list);
    input.focus();
  });
}

/** `live`: the title edit was Flint's own (a token, a list's spelling), never inert (D-45). */
function changed(live = false): void {
  syncTitle(live);
  update();
  saveDraft();
  reportContent();
}

/** Replaces the `##` token at the caret with the list's own spelling (CAP-05). */
function chooseList(list: ListInfo): void {
  const token = tokenAtCaret();
  if (!token) return;
  input.setRangeText(`##${listToken(list.name)}`, token.start, token.end, 'end');
  changed(true);
}

/**
 * D-40: Enter on the menu takes the highlighted list (the first one if none is); a click takes the
 * clicked one. Either way the menu closes.
 */
function acceptSuggestion(clicked?: ListInfo): void {
  const list = clicked ?? suggestions[selected < 0 ? 0 : selected];
  if (!list) return;
  chooseList(list);
  menuAcceptedFor = tokenAtCaret()?.text ?? null;
  update();
}

/** D-40: Enter on the card takes the selected option; the next Enter saves. */
function acceptChoice(): void {
  const target = parsed.target;
  const token = parsed.tokens.find((item) => item.kind === 'list' && item.role === 'winner');
  if (target.kind === 'close-match' && token) {
    const spelled = `##${listToken(target.list.name)}`;
    input.setRangeText(spelled, toShown(token.start), toShown(token.end), 'end');
    // The cursor now sits on the token; its menu counts as answered too.
    menuAcceptedFor = spelled;
    changed(true);
  } else if (target.kind === 'new') {
    cardAcceptedFor = target.name;
    update();
  }
}

/** A chip's × removes its token from the title, with one space around it. */
function removeToken(token: Token): void {
  const text = input.value;
  let start = toShown(token.start);
  let end = toShown(token.end);
  if (text[end] === ' ') end++;
  else if (start > 0 && text[start - 1] === ' ') start--;
  input.setRangeText('', start, end, 'end');
  changed(true);
  input.focus();
}

/** The tool buttons type the shorthand into the title (mockup 02): `!h`, `##`, `@`. */
function insertToken(token: string): void {
  const at = input.selectionStart ?? input.value.length;
  const before = at > 0 && !/\s/.test(input.value[at - 1] ?? '') ? ' ' : '';
  input.setRangeText(`${before}${token}`, at, input.selectionEnd ?? at, 'end');
  input.focus();
  changed(true);
}

function detach(attachment: AttachmentChip): void {
  window.flintPopup.detach(attachment.id);
  attachments = attachments.filter((item) => item.id !== attachment.id);
  changed();
  input.focus();
}

function renderSelection(): void {
  renderBlocks(
    blocksBox,
    blocks,
    expanded,
    {
      remove: (index) => {
        blocks = blocks.filter((_, at) => at !== index);
        expanded.clear();
        renderSelection();
        changed();
        input.focus();
      },
      toggle: (index) => {
        if (expanded.has(index)) expanded.delete(index);
        else expanded.add(index);
        renderSelection();
      },
      edit: (index, text) => {
        blocks = blocks.map((block, at) => (at === index ? { ...block, text } : block));
        changed();
      },
      key: blockKey,
    },
    highlightLines,
  );
}

function addBlock(block: CaptureBlock): void {
  if (block.text.trim() === '' && block.kind !== 'note') return;
  blocks = [...blocks, block];
  renderSelection();
  changed();
}

/**
 * Pasted or selected text (D-45: the selection itself is the task). Plain text with nothing typed
 * fills the task line with its first line, as plain text (its `!`, `##`, `@` are never shorthand);
 * the rest becomes body; shorthand typed so far stays after it. Once something is typed, and for
 * code, it goes to the selection area as body.
 */
function addContent(text: string): void {
  const block = blockFor(text);
  if (block.text === '') return;
  if (!isCodeBlock(block.kind) && parsed.title.trim() === '') {
    const [line = '', ...more] = block.text.split(/\r\n|\r|\n/);
    const first = line.trim();
    syncTitle(false);
    insertInert(input.value.trim() === '' ? first : `${first} `, 0, 0);
    input.setSelectionRange(input.value.length, input.value.length);
    const rest = more.join('\n').trim();
    if (rest !== '') blocks = [...blocks, { kind: 'text', text: rest }];
    renderSelection();
    changed();
    return;
  }
  addBlock(block);
}

/** Shift+Enter (D-38): a note in the selection area; the cursor moves there. */
function focusNote(): void {
  if (blocks.at(-1)?.kind !== 'note') addBlock({ kind: 'note', text: '' });
  const fields = blocksBox.querySelectorAll<HTMLTextAreaElement>('textarea');
  const field = fields[fields.length - 1];
  field?.focus();
  field?.setSelectionRange(field.value.length, field.value.length);
}

function showNotice(next: PopupNotice | null, hint?: string): void {
  notice = next;
  noticeBox.hidden = next === null && hint === undefined;
  noticeAction.hidden = next === null;
  if (next === null && hint !== undefined) {
    noticeText.textContent = hint;
  } else if (next?.kind === 'created-list') {
    noticeText.textContent = `Created list ${next.name}`;
    noticeAction.textContent = 'Undo';
  } else if (next?.kind === 'save-failed') {
    noticeText.textContent = "Couldn't save your last capture";
    noticeAction.textContent = 'Retry';
  }
}

/** Takes what the main process sends: the draft, its images and the previous-draft line. */
function apply(state: Omit<PopupShown, 'hotkeyAt'>, replace: boolean): void {
  lists = state.lists;
  attachments = state.attachments;
  const draftHas =
    state.draft.title.trim() !== '' || state.draft.blocks.some((block) => block.text !== '');
  // The saved draft only fills an empty popup (after a restart, a failed save, D-27) unless told
  // to replace it: what is in the popup is newer than the copy the main process keeps.
  if (replace || (input.value === '' && blocks.length === 0 && draftHas)) {
    input.value = state.draft.title;
    inert = [...(state.draft.inert ?? [])];
    lastTitle = input.value;
    blocks = [...state.draft.blocks];
    expanded.clear();
  }
  previousBox.hidden = !state.previousDraft;
}

let draftTimer: number | undefined;
/** CAP-08: the main process keeps the draft; sent shortly after typing stops, and on close. */
function saveDraft(now = false): void {
  window.clearTimeout(draftTimer);
  const send = (): void => window.flintPopup.saveDraft(draft());
  if (now) send();
  else draftTimer = window.setTimeout(send, 250);
}

function clear(): void {
  input.value = '';
  inert = [];
  lastTitle = '';
  blocks = [];
  expanded.clear();
  attachments = [];
  chooseNewFor = null;
  menuAcceptedFor = null;
  cardAcceptedFor = null;
  renderSelection();
  update();
  reportContent();
}

function submit(): void {
  window.clearTimeout(draftTimer);
  const keyAt = epochNow();
  const current = draft();
  // The title as the parser must read it: selected and pasted text escaped (D-45).
  const text = composeCapture(parsedTitle(), current.blocks);
  const chooseNewList = chooseNewFor !== null && parsed.target.kind === 'new';
  void attaching
    .then(() => window.flintPopup.submit({ text, keyAt, chooseNewList, draft: current }))
    .then((ack) => {
      // D-27: the popup empties once the main process has the capture; the saved draft is
      // cleared only after the write is confirmed.
      if (ack.accepted) {
        clear();
        showNotice(null);
      }
    });
}

function close(): void {
  saveDraft(true);
  window.flintPopup.dismiss();
}

/** Shift+Esc (D-39): the draft is dropped and the popup closes. */
function discard(): void {
  window.clearTimeout(draftTimer);
  clear();
  window.flintPopup.discard();
}

function undo(): void {
  window.flintPopup.noticeAction('undo');
  showNotice(null);
}

/** Keys in a text or note block (D-38). */
function blockKey(event: KeyboardEvent, index: number, field: HTMLTextAreaElement): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    // Proposed: Enter saves from a note too; Shift+Enter is a new line there.
    event.preventDefault();
    submit();
  } else if (
    (event.key === 'Tab' && event.shiftKey) ||
    (event.key === 'ArrowUp' && field.selectionStart === 0 && field.selectionEnd === 0)
  ) {
    event.preventDefault();
    input.focus();
  } else if (event.key === 'Backspace' && field.value === '' && blocks[index]?.kind === 'note') {
    // An empty note goes away with Backspace, back to the title.
    event.preventDefault();
    blocks = blocks.filter((_, at) => at !== index);
    renderSelection();
    changed();
    input.focus();
  }
}

window.flintPopup.onShown((shown) => {
  // D-105: the link chips know the user's patterns and the built-ins left on.
  setLinkPatterns(shown.linkPatterns);
  setBuiltInLinksOff(shown.builtInLinksOff);
  apply(shown, shown.replaceDraft === true);
  if (shown.prefill !== undefined) {
    // CAP-07, D-39, D-45: the selection is the task, or its body once something is typed.
    addContent(shown.prefill);
    saveDraft(true);
  }
  renderSelection();
  update();
  showNotice(shown.notice, shown.hint);
  reportContent();
  input.focus();
  const { hotkeyAt } = shown;
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

// Typing: inside a selected or pasted stretch it stays plain text, elsewhere it is live (D-45).
input.addEventListener('input', () => changed());
// The caret moving in or out of a `##` token opens or closes the menu.
document.addEventListener('selectionchange', () => {
  if (document.activeElement === input) update();
});

// CAP-06, D-38: a pasted image becomes an attachment; multi-line text, code, JSON and stack traces
// go to the selection area; one plain line is typed into the title as usual.
input.addEventListener('paste', (event) => {
  const data = event.clipboardData;
  if (!data) return;
  const image = [...data.items].find(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  const file = image?.getAsFile();
  if (file) {
    event.preventDefault();
    attaching = file
      .arrayBuffer()
      .then((bytes) => window.flintPopup.attach(new Uint8Array(bytes), file.type))
      .then((chip) => {
        if (chip) {
          attachments = [...attachments, chip];
          changed();
        }
      });
    return;
  }
  const text = data.getData('text/plain');
  event.preventDefault();
  if (!/[\r\n]/.test(text.trim()) && classifyPaste(text) === 'text') {
    // One plain line goes in at the cursor, as plain text: pasted, not typed (D-45).
    syncTitle(false);
    const start = input.selectionStart ?? input.value.length;
    insertInert(text.replace(/[\r\n]+/g, ' '), start, input.selectionEnd ?? start);
    changed();
    return;
  }
  addContent(text);
});

// Esc closes and keeps the draft, Shift+Esc discards it, wherever the focus is in the popup (also
// after clicking the card's background). Only while the popup has the focus: Esc is never a
// global hotkey, so it keeps working in other apps while the popup stays open (D-46).
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (event.shiftKey) discard();
  else close();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault();
    focusNote();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    // D-40: with the menu or the card showing, Enter first accepts it; the next Enter saves.
    if (!suggestionsBox.hidden && suggestions.length > 0) acceptSuggestion();
    else if (!choiceBox.hidden) acceptChoice();
    else submit();
  } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
    // Proposed (03 §3): ↑/↓ choose another suggested list.
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    selected = (selected + step + suggestions.length) % suggestions.length;
    const list = suggestions[selected];
    if (list) chooseList(list);
  } else if (event.key === 'ArrowDown' && blocks.length > 0) {
    // Down from the title goes to the first editable block.
    const field = blocksBox.querySelector<HTMLTextAreaElement>('textarea');
    if (field) {
      event.preventDefault();
      field.focus();
    }
  } else if (event.key === 'Tab' && !event.shiftKey) {
    const target = parsed.target;
    if (target.kind === 'close-match') {
      event.preventDefault();
      chooseNewFor = target.name;
      cardAcceptedFor = null;
      update();
    } else if (target.kind === 'new' && chooseNewFor) {
      event.preventDefault();
      chooseNewFor = null;
      cardAcceptedFor = null;
      update();
    }
  } else if (
    event.key === 'z' &&
    event.ctrlKey &&
    input.value === '' &&
    notice?.kind === 'created-list'
  ) {
    // Proposed (03 §3): with an empty title, Ctrl+Z undoes `Created list <name>`.
    event.preventDefault();
    undo();
  }
});

// Losing focus doesn't always close the popup any more (D-41); the draft is saved either way.
window.addEventListener('blur', () => saveDraft(true));

/**
 * CAP-11, D-57: a picker's choice becomes the shorthand typing would give. The token of that kind
 * already in the title is replaced (never left behind as text, D-25); null removes it.
 */
function replaceToken(kind: TokenKind, token: string | null): void {
  for (let guard = 0; guard < 10; guard++) {
    const found = parsed.tokens.find((item) => item.kind === kind);
    if (!found) break;
    removeToken(found);
  }
  if (token) {
    input.setSelectionRange(input.value.length, input.value.length);
    insertToken(token);
  }
  input.focus();
}

/**
 * A menu or picker that doesn't fit gets room (D-64): the page grows below the card, on top of the
 * shadow margin (D-42), and the window follows the page (the observer at the end).
 */
const room = {
  grow: (height: number): void => {
    document.body.style.paddingBottom = '';
    const margin = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    document.body.style.paddingBottom = `${margin + height}px`;
  },
  release: (): void => {
    document.body.style.paddingBottom = '';
  },
};

/** Pickers open under their button and give the keyboard back to the title. */
const pickerHost = (button: HTMLElement): PickerHost => ({
  anchor: button.getBoundingClientRect(),
  returnFocus: input,
  room,
  trigger: button,
});

// The flag, # and bell open the pickers (CAP-11, D-57); they used to type `!h`, `##` and `@`.
for (const tool of document.querySelectorAll<HTMLButtonElement>('.tool[data-picker]')) {
  tool.addEventListener('mousedown', (event) => event.preventDefault());
  tool.addEventListener('click', () => {
    const host = pickerHost(tool);
    const kind = tool.dataset.picker;
    if (kind === 'priority')
      openPriorityPicker(host, parsed.priority, (priority) =>
        replaceToken('priority', priority ? PRIORITY_TOKENS[priority] : null),
      );
    else if (kind === 'list')
      openListPicker(host, lists, { placeholder: 'Capture into list…' }, (pick) =>
        replaceToken(
          'list',
          'newList' in pick
            ? listShorthand(pick.newList)
            : // Inbox is where a capture goes anyway: no token needed.
              pick.list.id === 'inbox'
              ? null
              : listShorthand(pick.list.name),
        ),
      );
    else if (kind === 'time')
      openTimePicker(host, new Date(), parsed.reminder, (at) =>
        replaceToken('reminder', timeShorthand(at)),
      );
  });
}

required<HTMLButtonElement>('.send').addEventListener('click', submit);

noticeAction.addEventListener('click', () => {
  if (notice?.kind === 'created-list') undo();
  // Retry: the failed capture is back in the popup; saving it again is just Enter.
  else if (notice?.kind === 'save-failed') submit();
  input.focus();
});

noticeClose.addEventListener('click', () => {
  window.flintPopup.noticeAction('dismiss');
  showNotice(null);
  input.focus();
});

required<HTMLButtonElement>('.previous-restore').addEventListener('click', () => {
  // The current draft goes back to the main process first: it becomes the previous draft.
  saveDraft(true);
  void window.flintPopup.previous('restore').then((state) => {
    if (!state) return;
    apply(state, true);
    renderSelection();
    update();
    reportContent();
    input.focus();
  });
});

required<HTMLButtonElement>('.previous-close').addEventListener('click', () => {
  void window.flintPopup.previous('dismiss');
  previousBox.hidden = true;
  input.focus();
});

required<HTMLButtonElement>('.card-close').addEventListener('click', close);

// D-47, D-68: only the grip at the top of the card drags the popup, so text never moves it.
required<HTMLElement>('.card-grip').addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  // Keeps the cursor in the title, too.
  event.preventDefault();
  window.flintPopup.dragStart();
});

// D-42: clicks reach the popup only over the card; around it they go through to the app below.
let interactive = false;
const setInteractive = (next: boolean): void => {
  if (next === interactive) return;
  interactive = next;
  window.flintPopup.setInteractive(next);
};
document.addEventListener('mousemove', (event) => {
  setInteractive(
    event.target instanceof Element && event.target.closest('.card, .fl-menu, .fl-picker') !== null,
  );
});
document.addEventListener('mouseleave', () => setInteractive(false));

// UI-08, D-64: text fields keep Cut / Copy / Paste / Select all, as an in-page menu like everywhere
// in Flint. When the window is too short for it, the page grows while the menu is open (the window
// follows the page, below), so the menu never has to be native.
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!isTextField(event.target)) return;
  const field = event.target;
  openMenu(
    textFieldMenu(field, (command) => window.flintPopup.edit(command)),
    { x: event.clientX, y: event.clientY },
    { room },
  );
});

// The window follows the card (its margin included), so the menu and blocks always fit.
new ResizeObserver(() => {
  window.flintPopup.resize(Math.ceil(document.body.getBoundingClientRect().height));
  for (const field of blocksBox.querySelectorAll('textarea')) fitHeight(field);
  // The border box: the room for a menu or picker is padding, which the content box doesn't see.
}).observe(document.body, { box: 'border-box' });
