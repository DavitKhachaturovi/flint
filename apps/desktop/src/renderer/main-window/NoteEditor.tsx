import { useEffect, useRef, type ReactElement } from 'react';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import type { ShowImage } from './Body.js';

const SAVE_AFTER_MS = 600;

/**
 * A note in the live-preview editor (M5, NOTE-01, D-79): saved 600 ms after typing stops, when the
 * editor loses focus, and when another list is opened. A change from outside Flint shows at once
 * unless there is unsaved typing, which wins (it is saved over it, like any edit).
 */
export function NoteEditor(props: {
  readonly id: string;
  readonly text: string;
  readonly readOnly: boolean;
  /** Flint added its header to a file that had none (D-23): the note's ID changed. */
  readonly onId: (id: string) => void;
  /** MEDIA-01: an image opens the lightbox. */
  readonly onImage: ShowImage;
}): ReactElement {
  const { id, text, readOnly, onId, onImage } = props;
  const latest = useRef({ id, value: text, dirty: false });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    latest.current.id = id;
  }, [id]);
  useEffect(() => {
    if (latest.current.dirty) return;
    latest.current.value = text;
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
    <MarkdownEditor
      text={text}
      className="note-editor"
      ariaLabel="Note"
      readOnly={readOnly}
      {...(readOnly ? {} : { placeholder: 'Write here' })}
      handlers={{
        openLink: (href) => window.flintMain.openLink(href),
        openImage: (images, index) => onImage(images, index),
      }}
      onChange={(value) => {
        latest.current.value = value;
        latest.current.dirty = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => saveRef.current(), SAVE_AFTER_MS);
      }}
      onBlur={() => save()}
    />
  );
}
