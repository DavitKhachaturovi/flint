import { epochNow } from '../../shared/ipc.js';

/**
 * The capture popup (CAP-01). Kept tiny on purpose (CAP-10): an input, and the bridge calls.
 * Shorthand chips, autocomplete and paste handling join in M3.
 */

const input = document.querySelector<HTMLInputElement>('#capture');
if (!input) throw new Error('capture input missing');

window.flintPopup.onShown(({ hotkeyAt }) => {
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

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    // The draft stays in the input (CAP-08; persisted across restarts in M3).
    window.flintPopup.dismiss();
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const keyAt = epochNow();
    const text = input.value;
    void window.flintPopup.submit({ text, keyAt }).then((ack) => {
      // D-27: the draft is cleared only once the main process has the capture.
      if (ack.accepted) input.value = '';
    });
  }
});
