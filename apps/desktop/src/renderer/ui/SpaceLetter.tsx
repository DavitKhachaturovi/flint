/**
 * The space's letter (SPACE-03, D-189 Q4; docs/09 §8): on a row from a space other than Personal,
 * outside the sidebar (Today's chips, reminder cards, the `##` menu, mini's picker). Hover (250 ms)
 * shows the space's name; with `onSwitch` (the main window) it also says "Click to switch to …",
 * and a click presses the letter in and switches the sidebar there (the rest of the chip still
 * opens the list, D-93). In its own module so mini mode and the capture popup can use it.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

/** A space's letter: the first letter of its name, upper case. */
export function spaceLetter(name: string): string {
  const first = [...name.trim()][0] ?? '?';
  return first.toLocaleUpperCase();
}

export function SpaceLetter(props: {
  readonly space: { readonly id: string; readonly name: string };
  readonly onSwitch?: ((id: string) => void) | undefined;
}): ReactElement {
  const { space, onSwitch } = props;
  const [tip, setTip] = useState<DOMRect | null>(null);
  const [pressed, setPressed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const self = useRef<HTMLSpanElement>(null);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setTip(null);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <>
      <span
        ref={self}
        className={`mm${onSwitch ? ' switch' : ''}${pressed ? ' press' : ''}`}
        data-space={space.id}
        aria-label={onSwitch ? `${space.name}: click to switch to it` : space.name}
        role={onSwitch ? 'button' : undefined}
        onMouseEnter={() => {
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            if (self.current) setTip(self.current.getBoundingClientRect());
          }, 250);
        }}
        onMouseLeave={hide}
        onMouseDown={(event) => {
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
        {spaceLetter(space.name)}
      </span>
      {tip &&
        createPortal(
          <span
            className="space-tip"
            role="tooltip"
            style={{ left: tip.left + tip.width / 2, top: tip.top - 8 }}
          >
            <span>{space.name}</span>
            {onSwitch && <span className="k">Click to switch to {space.name}</span>}
          </span>,
          document.body,
        )}
    </>
  );
}
