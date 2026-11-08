import { useEffect, useRef, useState, type ReactElement } from 'react';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import { useNoteEditing, type EditorWindow } from '../editor/note-editing.js';
import type { ShowImage } from './Body.js';

const SAVE_AFTER_MS = 600;

/**
 * A note in the live-preview editor (M5, NOTE-01, D-79): saved 600 ms after typing stops, when the
 * editor loses focus, and when another list is opened. A change from outside Flint shows at once
 * unless there is unsaved typing, which wins (it is saved over it, like any edit).
 *
 * D-109: one window edits a note at a time (`useNoteEditing`): while the other window edits it,
 * it shows here updating live, read-only, with "Editing in mini mode"; a click into it takes the
 * editing over once the other window has saved. Mini mode's Note tab uses it too, with no note yet:
 * the quick note is made on the first keystroke (`create`).
 */
export function NoteEditor(props: {
  /** The note; '' for one not made yet (it is made on the first keystroke, `create`). */
  readonly id: string;
  readonly text: string;
  readonly readOnly: boolean;
  /**
   * Flint added its header to a file that had none (D-23), or the note was made: its ID, and the
   * one this editor had for it before ('' for a note not made yet). D-143: the window keeps this
   * editor for that one step only.
   */
  readonly onId: (id: string, from: string) => void;
  /** MEDIA-01: an image opens the lightbox. */
  readonly onImage: ShowImage;
  /** NOTE-06, D-84: shown in monospace (this machine's choice); null: no Monospace toggle. */
  readonly mono: boolean | null;
  /** NOTE-09, D-141: in Source mode (this machine's choice); null or absent: no toggle. */
  readonly source?: boolean | null;
  /** D-86: just made by Convert to note: the cursor goes to the end of the text, ready to type. */
  readonly focus?: boolean;
  /**
   * D-107: the caret has arrived. The request stands until then, so an editor made again as the
   * view settles (or a render over it) still takes it.
   */
  readonly onFocused?: () => void;
  /** D-109: which window this is (the main window unless said). */
  readonly window?: EditorWindow;
  /** D-109: makes the note on the first keystroke (mini mode's Note tab); its ID, or null. */
  readonly create?: () => Promise<string | null>;
  readonly className?: string;
  readonly placeholder?: string;
  /** D-110: what is typed, as it is typed (mini's Note tab knows when the note is empty). */
  readonly onText?: (value: string) => void;
}): ReactElement {
  const { id, text, readOnly, onId, onImage, mono, focus, onFocused } = props;
  const me = props.window ?? 'main';
  const latest = useRef({ id, value: text, dirty: false });
  const timer = useRef<number | undefined>(undefined);
  const creating = useRef<Promise<string | null> | null>(null);
  // What the editor shows: the note's text, or the other window's live text (also what it handed
  // over, kept until a newer read).
  const [base, setBase] = useState(text);

  useEffect(() => {
    latest.current.id = id;
  }, [id]);
  useEffect(() => {
    setBase(text);
    if (latest.current.dirty) return;
    latest.current.value = text;
  }, [text]);

  /** Saves what is waiting (making the note first if it has none); the text it has. */
  const saveNow = async (): Promise<string> => {
    window.clearTimeout(timer.current);
    if (!latest.current.dirty) return latest.current.value;
    if (!latest.current.id) {
      if (!props.create) return latest.current.value;
      creating.current ??= props.create();
      const made = await creating.current;
      if (!made) return latest.current.value;
      latest.current.id = made;
      onId(made, '');
    }
    const { id: noteId, value: noteText } = latest.current;
    latest.current.dirty = false;
    const outcome = await window.flintMain.saveNote(noteId, noteText);
    if (outcome?.ok && outcome.listId !== noteId) {
      latest.current.id = outcome.listId;
      onId(outcome.listId, noteId);
    }
    return noteText;
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  const save = (): void => void saveRef.current();
  // Opening another list saves what was typed.
  useEffect(() => () => void saveRef.current(), []);

  const editing = useNoteEditing(id || null, me, () => saveRef.current());
  useEffect(() => {
    if (editing.liveText === null) return;
    setBase(editing.liveText);
    if (!latest.current.dirty) latest.current.value = editing.liveText;
  }, [editing.liveText]);
  const locked = editing.elsewhere !== null;
  // A note made on the first keystroke was focused before it had an ID: it claims it once it has.
  // (Only then: claiming again whenever the editing moved would take it straight back.)
  const focused = useRef(false);
  const hadId = useRef(id !== '');
  const claimRef = useRef(editing.claim);
  claimRef.current = editing.claim;
  useEffect(() => {
    if (id === '' || hadId.current) return;
    hadId.current = true;
    if (focused.current) claimRef.current();
  }, [id]);

  return (
    <>
      {editing.elsewhere && (
        <p className="note-elsewhere" role="status">
          {editing.elsewhere}
        </p>
      )}
      <MarkdownEditor
        text={base}
        className={[
          props.className ?? 'note-editor',
          mono ? 'mono' : '',
          locked ? 'locked' : '',
        ].join(' ')}
        {...(mono !== null && {
          monospace: { on: mono, toggle: () => void window.flintMain.noteMono(id, !mono) },
        })}
        {...(props.source != null &&
          id !== '' && {
            source: {
              on: props.source,
              toggle: () => void window.flintMain.noteSource(id, props.source !== true),
            },
          })}
        ariaLabel="Note"
        readOnly={readOnly}
        locked={locked}
        {...(focus && !readOnly ? { autoFocus: true, caretAtEnd: true } : {})}
        {...(readOnly ? {} : { placeholder: props.placeholder ?? 'Write here' })}
        handlers={{
          openLink: (href) => window.flintMain.openLink(href),
          openImage: (images, index) => onImage(images, index),
        }}
        onChange={(value) => {
          props.onText?.(value);
          latest.current.value = value;
          latest.current.dirty = true;
          editing.typed(value);
          window.clearTimeout(timer.current);
          // The first keystroke of a note not made yet makes it at once.
          if (!latest.current.id && props.create) save();
          else timer.current = window.setTimeout(save, SAVE_AFTER_MS);
        }}
        onBlur={() => {
          focused.current = false;
          save();
        }}
        onFocus={() => {
          focused.current = true;
          editing.claim();
          if (focus) onFocused?.();
        }}
      />
    </>
  );
}
