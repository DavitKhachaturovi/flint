/**
 * D-89: a copy button's icon and its feedback: on copying, the copy icon morphs into a checkmark
 * for a moment and back (editor.css; instant under reduce-motion). Code cards in bodies, notes and
 * the panel use it.
 */
export const COPY_ICON =
  '<span class="fl-copy-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2.5"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg></span>' +
  '<span class="fl-copy-done"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg></span>';

const timers = new WeakMap<HTMLElement, number>();

/** Copies `text` and plays the checkmark on `button` (again from the start on a second copy). */
export function copyWithFeedback(button: HTMLElement, text: string): void {
  void navigator.clipboard.writeText(text).then(() => {
    window.clearTimeout(timers.get(button));
    button.classList.add('copied');
    button.title = 'Copied';
    timers.set(
      button,
      window.setTimeout(() => {
        button.classList.remove('copied');
        button.title = 'Copy';
      }, 1200),
    );
  });
}
