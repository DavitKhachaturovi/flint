import { useEffect, useRef, useState, type ReactElement } from 'react';

const SAVE_AFTER_MS = 600;

/**
 * A note as plain monospace text until the note editor (M5, D-64): saved 600 ms after typing stops,
 * when the field loses focus, and when another list is opened. A change from outside Flint shows
 * at once unless there is unsaved typing, which wins (it is saved over it, like any edit).
 */
export function NoteEditor(props: {
  readonly id: string;
  readonly text: string;
  readonly readOnly: boolean;
  /** Flint added its header to a file that had none (D-23): the note's ID changed. */
  readonly onId: (id: string) => void;
}): ReactElement {
  const { id, text, readOnly, onId } = props;
  const [value, setValue] = useState(text);
  const latest = useRef({ id, value: text, dirty: false });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    latest.current.id = id;
  }, [id]);
  useEffect(() => {
    if (latest.current.dirty) return;
    latest.current.value = text;
    setValue(text);
  }, [text]);

  const save = (): void => {
    window.clearTimeout(timer.current);
    const { id: noteId, value: noteText, dirty } = latest.current;
    if (!dirty) return;
    latest.current.dirty = false;
    void window.flintMain.saveNote(noteId, noteText).then((outcome) => {
      if (outcome?.ok && outcome.listId !== noteId) onId(outcome.listId);
    });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  // Opening another list saves what was typed.
  useEffect(() => () => saveRef.current(), []);

  return (
    <textarea
      className="note-editor"
      aria-label="Note"
      placeholder={readOnly ? '' : 'Write here'}
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event) => {
        setValue(event.target.value);
        latest.current.value = event.target.value;
        latest.current.dirty = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => saveRef.current(), SAVE_AFTER_MS);
      }}
      onBlur={() => save()}
    />
  );
}
