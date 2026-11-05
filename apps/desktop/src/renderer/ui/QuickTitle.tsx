/** NOTE-08, D-99: a quick note's title row, shared by the main window and mini mode (D-110). */
import { useState, type ReactElement } from 'react';

/**
 * NOTE-08, D-99: a quick note's title row: when it was made (its label), and "Add a title", which
 * on Enter makes it a normal note with that name.
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
  const save = (): void => {
    const next = text.trim();
    if (next !== '' && next !== title) onTitle(next);
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
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
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
