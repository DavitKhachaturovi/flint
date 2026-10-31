import { backspacePair, followEdit, typePair, type PairState } from '../shared/auto-pair.js';

/**
 * Auto-closing brackets and quotes for one text field (UI-09, D-57); the rules are in
 * shared/auto-pair.ts. The new text goes in through the field's native value setter and an `input`
 * event, so React's onChange and the capture popup's own input handling (shorthand, inert text)
 * see it like typing. Returns a function that detaches it.
 */
export function enableAutoPair(field: HTMLInputElement | HTMLTextAreaElement): () => void {
  let auto: number[] = [];
  let last = field.value;
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const writeValue = (value: string): void => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  };

  const apply = (state: PairState): void => {
    auto = [...state.auto];
    last = state.value;
    writeValue(state.value);
    field.setSelectionRange(state.start, state.end);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.setSelectionRange(state.start, state.end);
  };
  const onKey = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || field.readOnly)
      return;
    const state: PairState = {
      value: field.value,
      start: field.selectionStart ?? field.value.length,
      end: field.selectionEnd ?? field.value.length,
      auto,
    };
    const next =
      event.key === 'Backspace'
        ? backspacePair(state)
        : event.key.length === 1
          ? typePair(state, event.key)
          : null;
    if (!next) return;
    event.preventDefault();
    apply(next);
  };
  // Any other edit (typing, paste, undo) moves the remembered closers along.
  const onInput = (): void => {
    if (field.value === last) return;
    auto = followEdit(auto, last, field.value);
    last = field.value;
  };
  field.addEventListener('keydown', onKey);
  field.addEventListener('input', onInput);
  return () => {
    field.removeEventListener('keydown', onKey);
    field.removeEventListener('input', onInput);
  };
}
