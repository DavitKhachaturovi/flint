/** NOTE-08, D-99: a quick note's title row, shared by the main window and mini mode (D-110). */
import { useRef, useState, type ReactElement } from 'react';

/**
 * NOTE-08, D-99: a quick note's title row: when it was made (its label), and "Add a title", which
 * on Enter makes it a normal note with that name. D-115: Enter, Shift+Enter, Tab and ↓ save it and
 * go on into the note's text (the editor below it); Esc puts it back.
 */
export function QuickTitle(props: {
  /** When it was made. */
  readonly at: number;
  /** D-102: its title, once it has one (it stays a quick note until kept or the next day). */
  readonly title: string;
  readonly onTitle: (title: string) => void;
}): ReactElement {
  const { at, title, onTitle } = props;
  const [text, setText] = useState(title);
  // D-102: saved on Enter and when the field is left (as everything in Flint), when it changed.
  // Sent once: going on into the text leaves the field too (its blur isn't a second save).
  const sent = useRef<string | null>(null);
  const save = (): void => {
    const next = text.trim();
    if (next === '' || next === title || next === sent.current) return;
    sent.current = next;
    onTitle(next);
  };
  const made = new Date(at);
  const two = (value: number): string => String(value).padStart(2, '0');
  const clock = `${two(made.getHours())}:${two(made.getMinutes())}`;
  const day =
    made.toDateString() === new Date().toDateString()
      ? ''
      : `${made.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} `;
  return (
    <div className="quick-title">
      <span className="subtitle">
        Quick note · {day}
        {clock}
      </span>
      <input
        className="quick-title-input"
        value={text}
        placeholder="Add a title"
        aria-label="Title"
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (
            (event.key === 'Enter' || event.key === 'Tab' || event.key === 'ArrowDown') &&
            !event.ctrlKey &&
            !event.altKey &&
            !(event.key === 'Tab' && event.shiftKey)
          ) {
            event.preventDefault();
            save();
            // The note's own editor, under this title (the main window's card, mini's Note tab).
            const editor = event.currentTarget
              .closest('.note-card, .mini-note')
              ?.querySelector<HTMLElement>('.cm-content');
            if (editor) editor.focus();
            else event.currentTarget.blur();
            return;
          }
          if (event.key === 'Escape') {
            setText(title);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
