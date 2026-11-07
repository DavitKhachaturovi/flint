import { isTextField } from '../menu/menu.js';

/**
 * NAV-08, D-128 (Q4, Q6): where a clipboard history item goes, and how. The field is the one that
 * has the keyboard, or had it just before the palette or the picker took it (its pill, its search
 * field); a click on anything else (a row, the page) forgets it. The item goes in as a paste would
 * (a synthetic paste event, D-93: the clipboard itself is never touched), so the field's own paste
 * rules apply and Ctrl+Z undoes it in one step; a field that doesn't handle pastes gets the text
 * typed, with line breaks as spaces in a one-line field.
 */

/** What takes the keyboard on the way to the picker, and doesn't count as leaving the field. */
const ON_THE_WAY = '.palette-layer, .palette-button, .fl-picker, .clip-section, .fl-menu';

let last: HTMLElement | null = null;

/** A field a clipboard item can go into (not the palette's or a picker's search). */
export function textField(target: EventTarget | null): HTMLElement | null {
  if (!isTextField(target) || !target.isConnected || target.closest(ON_THE_WAY)) return null;
  if (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    (target.readOnly || target.disabled)
  )
    return null;
  return target;
}

/** The field the item goes into now: the one with the keyboard, else the one just left for the palette. */
export function currentField(): HTMLElement | null {
  const now = textField(document.activeElement);
  if (now) return now;
  return last?.isConnected ? last : null;
}

/** Follows the keyboard (once, for the window's life). */
export function trackFields(): () => void {
  const onIn = (event: FocusEvent): void => {
    const field = textField(event.target);
    if (field) last = field;
    else if (!(event.target instanceof Element && event.target.closest(ON_THE_WAY))) last = null;
  };
  const onOut = (event: FocusEvent): void => {
    // Focus to nothing while the window keeps it: a click on the page, not a field.
    if (event.relatedTarget === null && textField(event.target))
      window.setTimeout(() => {
        if (document.hasFocus() && !textField(document.activeElement)) {
          const active = document.activeElement;
          if (!(active instanceof Element && active.closest(ON_THE_WAY))) last = null;
        }
      }, 0);
  };
  document.addEventListener('focusin', onIn, true);
  document.addEventListener('focusout', onOut, true);
  return () => {
    document.removeEventListener('focusin', onIn, true);
    document.removeEventListener('focusout', onOut, true);
  };
}

/**
 * Puts `content` into `field` as a paste (one undo step): text, or (D-129) a picture as a pasted
 * image file, which a note or the composer saves to attachments/. False when the field doesn't take
 * a picture.
 */
export function pasteInto(field: HTMLElement, content: string | File): boolean {
  if (document.activeElement !== field) field.focus({ preventScroll: true });
  const data = new DataTransfer();
  if (typeof content === 'string') data.setData('text/plain', content);
  else data.items.add(content);
  const paste = new ClipboardEvent('paste', {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  field.dispatchEvent(paste);
  if (paste.defaultPrevented) return true;
  if (typeof content !== 'string') return false;
  // Nothing took it (a plain field): typed in, as the field's own undo step.
  const typed =
    field instanceof HTMLInputElement ? content.replace(/\s*[\r\n]+\s*/g, ' ') : content;
  document.execCommand('insertText', false, typed);
  return true;
}
