import { useCallback, useRef, useState } from 'react';
import { escapeInert, shiftRanges, type TextRange } from '@flint/core/shorthand';

/**
 * A text field whose shorthand comes only from what the user types (D-45, CAP-03), as in the
 * capture popup: pasted text, and a task's existing title while it is edited, are inert, so their
 * `!`, `##` and `@` stay text. Typing inside an inert stretch keeps it inert.
 */
export interface InertText {
  readonly value: string;
  /** The `onChange` value of the input. */
  readonly change: (next: string) => void;
  /** Call from `onPaste`: the next change is pasted text. */
  readonly paste: () => void;
  /** Flint's own insertion (a toolbar token): live even inside an inert stretch. */
  readonly insertLive: (text: string) => void;
  /** What goes to the main process: inert markers escaped. */
  readonly escaped: () => string;
  readonly reset: (value: string, inert: boolean) => void;
}

/** The stretch of `after` that replaced something in `before` (one contiguous edit). */
function insertedSpan(before: string, after: string): TextRange {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return { start: prefix, end: after.length - suffix };
}

export function useInertText(initial: string, inert: boolean): InertText {
  const [value, setValue] = useState(initial);
  const ranges = useRef<TextRange[]>(
    inert && initial !== '' ? [{ start: 0, end: initial.length }] : [],
  );
  const current = useRef(initial);
  const pasting = useRef(false);

  const apply = useCallback((next: string, live: boolean): void => {
    const before = current.current;
    let shifted = shiftRanges(ranges.current, before, next, live);
    if (pasting.current) {
      const span = insertedSpan(before, next);
      if (span.end > span.start) shifted = [...shifted, span];
      pasting.current = false;
    }
    ranges.current = shifted;
    current.current = next;
    setValue(next);
  }, []);

  return {
    value,
    change: useCallback((next: string) => apply(next, false), [apply]),
    paste: useCallback(() => {
      pasting.current = true;
    }, []),
    insertLive: useCallback(
      (text: string) => {
        const before = current.current;
        const gap = before === '' || before.endsWith(' ') ? '' : ' ';
        apply(`${before}${gap}${text}`, true);
      },
      [apply],
    ),
    escaped: useCallback(() => escapeInert(current.current, ranges.current).text, []),
    reset: useCallback((next: string, nextInert: boolean) => {
      ranges.current = nextInert && next !== '' ? [{ start: 0, end: next.length }] : [];
      current.current = next;
      pasting.current = false;
      setValue(next);
    }, []),
  };
}
