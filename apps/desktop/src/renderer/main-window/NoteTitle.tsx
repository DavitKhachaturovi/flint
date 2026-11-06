import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ListActionOutcome } from '../../shared/ipc.js';

/**
 * NOTE-01, LIST-01, D-111: a note's title on its page, renamed where it is: a click (the note is
 * already the open one, so this is the sidebar's slow second click) turns it into a field in the
 * title's own type. As in the sidebar (D-99, D-107): Enter saves, and a problem (a name Windows
 * can't use, one already taken) shows under it while the field stays; leaving saves too, and a
 * problem then closes it with a message; Esc cancels. The field eases in.
 */
export function NoteTitle(props: {
  readonly name: string;
  readonly readOnly: boolean;
  readonly onRename: (name: string) => Promise<ListActionOutcome | null>;
  readonly onProblem: (problem: string) => void;
}): ReactElement {
  const { name, readOnly, onRename, onProblem } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (!editing) setText(name);
  }, [name, editing]);
  useEffect(() => {
    if (!editing) return;
    field.current?.focus();
    field.current?.select();
  }, [editing]);

  const close = (): void => {
    setEditing(false);
    setProblem(null);
  };
  const save = async (left: boolean): Promise<void> => {
    if (busy.current) return;
    const next = text.trim();
    if (next === '' || next === name) return close();
    busy.current = true;
    try {
      const outcome = await onRename(next);
      if (!outcome) return;
      if (outcome.ok) return close();
      if (left) {
        close();
        onProblem(outcome.problem);
      } else setProblem(outcome.problem);
    } finally {
      busy.current = false;
    }
  };

  if (!editing)
    return (
      <h1
        className={readOnly ? 'note-title' : 'note-title renames'}
        title={readOnly ? undefined : 'Rename'}
        onClick={() => {
          if (readOnly || window.getSelection()?.toString()) return;
          setEditing(true);
        }}
      >
        {name}
      </h1>
    );
  return (
    <div className="note-title-field">
      <input
        ref={field}
        className="note-title-input"
        value={text}
        aria-label="Note name"
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        onBlur={() => void save(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void save(false);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      />
      {problem && <p className="note-title-problem">{problem}</p>}
    </div>
  );
}
