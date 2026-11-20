/**
 * The space's letter (SPACE-03, D-189 Q4; docs/09 §8) on a row from a space other than Personal,
 * outside the sidebar (Today's chips, reminder cards, Up next, Trash, the `##` menu, mini's
 * picker), and the tooltip it shares with Today's list chip (D-190 Q21): one style, always one
 * short line, after 250 ms of hover ("Open Groceries", "Switch to Home"). With `onSwitch` (the
 * main window) a click presses the letter in and switches the sidebar to that space; the rest of
 * the chip still opens the list (D-93). In its own module so mini mode and the popup can use it.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import { spaceLetter } from './space-letter.js';

export { spaceLetter };

/**
 * D-190 Q21: the tooltip of the clickable list chip and of the letter: shown 250 ms after the
 * pointer arrives, centred 8 px above the element, one line. `show(element)` / `hide()`.
 */
export function useHoverTip(label: string): {
  readonly show: (element: Element) => void;
  readonly hide: () => void;
  readonly tip: ReactElement | null;
} {
  const [at, setAt] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setAt(null);
  }, []);
  const show = useCallback((element: Element) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAt(element.getBoundingClientRect()), 250);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const tip = at
    ? createPortal(
        <span
          className="space-tip"
          role="tooltip"
          style={{ left: at.left + at.width / 2, top: at.top - 8 }}
        >
          {label}
        </span>,
        document.body,
      )
    : null;
  return { show, hide, tip };
}

export function SpaceLetter(props: {
  readonly space: { readonly id: string; readonly name: string };
  readonly onSwitch?: ((id: string) => void) | undefined;
}): ReactElement {
  const { space, onSwitch } = props;
  const [pressed, setPressed] = useState(false);
  const { show, hide, tip } = useHoverTip(onSwitch ? `Switch to ${space.name}` : space.name);
  return (
    <>
      <span
        className={`mm${onSwitch ? ' switch' : ''}${pressed ? ' press' : ''}`}
        data-space={space.id}
        aria-label={onSwitch ? `Switch to ${space.name}` : space.name}
        role={onSwitch ? 'button' : undefined}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={hide}
        onMouseDown={(event) => {
          if (onSwitch) event.stopPropagation();
        }}
        // A press on the letter starts no drag of what holds it (a Timeline event, a row).
        onPointerDown={(event) => {
          if (onSwitch) event.stopPropagation();
        }}
        onClick={(event) => {
          if (!onSwitch) return;
          // The rest of the chip opens the list (D-93); the letter switches the sidebar.
          event.stopPropagation();
          hide();
          setPressed(false);
          requestAnimationFrame(() => setPressed(true));
          onSwitch(space.id);
        }}
        onAnimationEnd={() => setPressed(false)}
      >
        {/* Spaces preview 3: drawn as SVG text, so the capital keeps its place in the square
            wherever the row puts it (HTML text snapped apart from the square, up to 1 px high). */}
        <svg className="cap-svg" aria-hidden="true">
          <text x="50%" y="50%">
            {spaceLetter(space.name)}
          </text>
        </svg>
      </span>
      {tip}
    </>
  );
}
