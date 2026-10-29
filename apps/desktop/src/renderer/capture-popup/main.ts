import { epochNow, type PopupNotice } from '../../shared/ipc.js';

/**
 * The capture popup (CAP-01). Kept tiny on purpose (CAP-10): the text box, the follow-up notice
 * (D-26) and the bridge calls. Shorthand chips, autocomplete and paste handling join in M3.
 */

const input = document.querySelector<HTMLTextAreaElement>('#capture');
const noticeBox = document.querySelector<HTMLElement>('.notice');
const noticeText = document.querySelector<HTMLElement>('.notice-text');
const noticeAction = document.querySelector<HTMLButtonElement>('.notice-action');
const noticeClose = document.querySelector<HTMLButtonElement>('.notice-close');
if (!input || !noticeBox || !noticeText || !noticeAction || !noticeClose) {
  throw new Error('capture popup markup missing');
}

let notice: PopupNotice | null = null;

function showNotice(next: PopupNotice | null): void {
  notice = next;
  if (!noticeBox || !noticeText || !noticeAction) return;
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
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

let draftTimer: number | undefined;
/** CAP-08: the main process keeps the draft; sent shortly after typing stops, and on close. */
function saveDraft(now = false): void {
  window.clearTimeout(draftTimer);
  const send = (): void => window.flintPopup.saveDraft(input?.value ?? '');
  if (now) send();
  else draftTimer = window.setTimeout(send, 250);
}

function submit(): void {
  if (!input) return;
  window.clearTimeout(draftTimer);
  const keyAt = epochNow();
  const text = input.value;
  void window.flintPopup.submit({ text, keyAt, chooseNewList: false }).then((ack) => {
    // D-27: the box empties once the main process has the capture; the saved draft is cleared
    // only after the write is confirmed.
    if (ack.accepted) {
      input.value = '';
      grow();
      showNotice(null);
    }
  });
}

function undo(): void {
  window.flintPopup.noticeAction('undo');
  showNotice(null);
}

window.flintPopup.onShown(({ hotkeyAt, draft, notice: next }) => {
  if (input.value !== draft) {
    input.value = draft;
    grow();
  }
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

input.addEventListener('input', () => {
  grow();
  saveDraft();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    saveDraft(true);
    window.flintPopup.dismiss();
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
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
