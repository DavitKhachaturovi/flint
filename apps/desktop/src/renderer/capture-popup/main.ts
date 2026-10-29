import {
  blockFor,
  classifyPaste,
  composeCapture,
  fallbackTitle,
  listToken,
  listTokenAt,
  parseCapture,
  suggestLists,
  type CaptureBlock,
  type CaptureParse,
  type ListInfo,
  type Token,
} from '@flint/core/shorthand';
import flintIcon from '../../../../../assets/icon/flint-icon-16.svg';
import {
  epochNow,
  type AttachmentChip,
  type CaptureDraft,
  type PopupNotice,
  type PopupShown,
} from '../../shared/ipc.js';
import { highlightLines } from './highlight.js';
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

const PLACEHOLDER = 'Capture a task…';

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

function draft(): CaptureDraft {
  return { title: input.value, blocks };
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
  return token ? { ...token, text: input.value.slice(token.start, token.end) } : null;
}

/** Re-parses the title and redraws what depends on it (CAP-04: the chips are the truth). */
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
  renderChips(chipsBox, parsed, removeToken, attachments, detach);
  const target = parsed.target;
  const cardAccepted =
    (target.kind === 'new' || target.kind === 'close-match') && target.name === cardAcceptedFor;
  if (!cardAccepted) cardAcceptedFor = null;
  renderChoice(choiceBox, parsed, flippedFrom);
  if (cardAccepted) choiceBox.hidden = true;
  targetLabel.textContent = targetName(parsed);
  // The title a capture gets when the title line is left empty (D-38), shown without escapes.
  input.placeholder = fallbackTitle(blocks).replace(/\\(##|!|@)/g, '$1') || PLACEHOLDER;

  const token = tokenAtCaret();
  if (token && token.text !== menuAcceptedFor) menuAcceptedFor = null;
  const next5 =
    token && menuAcceptedFor === null ? suggestLists(token.typed, lists).slice(0, 5) : [];
  if (next5.map((list) => list.id).join() !== suggestions.map((list) => list.id).join()) {
    selected = -1;
  }
  suggestions = next5;
  renderSuggestions(suggestionsBox, suggestions, selected, chooseList);
}

function changed(): void {
  update();
  saveDraft();
  reportContent();
}

/** Replaces the `##` token at the caret with the list's own spelling (CAP-05). */
function chooseList(list: ListInfo): void {
  const token = tokenAtCaret();
  if (!token) return;
  input.setRangeText(`##${listToken(list.name)}`, token.start, token.end, 'end');
  changed();
}

/** D-40: Enter on the menu takes the highlighted list (the first one if none is). */
function acceptSuggestion(): void {
  const list = suggestions[selected < 0 ? 0 : selected];
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
    input.setRangeText(spelled, token.start, token.end, 'end');
    // The cursor now sits on the token; its menu counts as answered too.
    menuAcceptedFor = spelled;
    changed();
  } else if (target.kind === 'new') {
    cardAcceptedFor = target.name;
    update();
  }
}

/** A chip's × removes its token from the title, with one space around it. */
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

/** The tool buttons type the shorthand into the title (mockup 02): `!h`, `##`, `@`. */
function insertToken(token: string): void {
  const at = input.selectionStart ?? input.value.length;
  const before = at > 0 && !/\s/.test(input.value[at - 1] ?? '') ? ' ' : '';
  input.setRangeText(`${before}${token}`, at, input.selectionEnd ?? at, 'end');
  input.focus();
  changed();
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
  // A title of only shorthand still gets the fallback title (D-38).
  const text = composeCapture(current.title, current.blocks, parsed.title.trim() !== '');
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
  if (event.key === 'Escape') {
    event.preventDefault();
    if (event.shiftKey) discard();
    else close();
  } else if (event.key === 'Enter' && !event.shiftKey) {
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
  apply(shown, shown.replaceDraft === true);
  if (shown.prefill !== undefined) {
    // CAP-07, D-39: the selection joins the selection area (D-38).
    blocks = [...blocks, blockFor(shown.prefill)];
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

input.addEventListener('input', changed);
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
  if (!/[\r\n]/.test(text.trim()) && classifyPaste(text) === 'text') return;
  event.preventDefault();
  addBlock(blockFor(text));
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (event.shiftKey) discard();
    else close();
  } else if (event.key === 'Enter' && event.shiftKey) {
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

// D-42: clicks reach the popup only over the card; around it they go through to the app below.
let interactive = false;
const setInteractive = (next: boolean): void => {
  if (next === interactive) return;
  interactive = next;
  window.flintPopup.setInteractive(next);
};
document.addEventListener('mousemove', (event) => {
  setInteractive(event.target instanceof Element && event.target.closest('.card') !== null);
});
document.addEventListener('mouseleave', () => setInteractive(false));

// The window follows the card (its margin included), so the menu and blocks always fit.
new ResizeObserver(() => {
  window.flintPopup.resize(Math.ceil(document.body.getBoundingClientRect().height));
  for (const field of blocksBox.querySelectorAll('textarea')) fitHeight(field);
}).observe(document.body);
