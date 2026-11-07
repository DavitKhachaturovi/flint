import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ListSummary, ListView } from '../../shared/ipc.js';
import { openMenu, type MenuEntry } from '../menu/menu.js';
import { openNotePicker } from '../pickers/pickers.js';
import { NoteEditor } from '../main-window/NoteEditor.js';
import { QuickTitle } from '../ui/QuickTitle.js';

/**
 * D-109, Q5: the Note tab: one quick note as a sticky note, with the main window's quick-note title
 * (`QuickTitle`: "Quick note · 15:30" over "Add a title") and editor, compact. With no quick note,
 * an empty editor: the note is made on the first keystroke, or when a title is given (D-110: the
 * title can be typed first). The ⋯ menu: the other quick notes, New quick note (not while this
 * one is empty: it would only be removed), Keep as a note, Open in Flint.
 */
export function NoteTab(props: {
  /** The note shown; '' for one not made yet. */
  readonly noteId: string;
  readonly view: ListView | null;
  readonly quick: ListSummary | null;
  readonly quickNotes: readonly ListSummary[];
  /** D-122: every note (quick notes and notes), for Open a note…. */
  readonly notes: readonly ListSummary[];
  readonly kept: boolean;
  /** The note was made here (first keystroke, or a title). */
  readonly onMade: (id: string) => void;
  readonly onSwitch: (id: string) => void;
  readonly onKeep: () => void;
  readonly onToast: (text: string, undo: boolean) => void;
}): ReactElement {
  const { noteId, view, quick, quickNotes, notes, kept, onMade, onSwitch, onKeep, onToast } = props;
  /** D-122: a note opened with Open a note… (not a quick note): its name is its title. */
  const permanent = quick !== null && quick.mode === 'note' && !quick.quick;
  // The editor stays the same one when its note is made on the first keystroke (a new one only
  // for another note), so nothing typed meanwhile is lost.
  const made = useRef(new Set<string>());
  const [editorKey, setEditorKey] = useState(0);
  const shownId = useRef(noteId);
  useEffect(() => {
    if (noteId !== shownId.current && !(noteId && made.current.has(noteId)))
      setEditorKey((key) => key + 1);
    shownId.current = noteId;
  }, [noteId]);
  const loaded = view !== null && view.id === noteId;
  const savedText = loaded ? (view.noteText ?? '') : '';
  // What the note holds now (typing comes before the save): empty, it can't be left for a new one.
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => setTyped(null), [noteId, editorKey]);
  const text = typed ?? savedText;
  const title = permanent
    ? (quick?.name ?? '')
    : quick?.quick
      ? quick.quick.label === quick.name
        ? quick.name
        : ''
      : '';
  const [titled, setTitled] = useState('');
  useEffect(() => setTitled(''), [noteId]);
  const empty = text.trim() === '' && title === '' && titled === '';

  // D-115: one note however it starts (a title, then the first keystroke right after it, both
  // before it exists): the second waits for the first instead of making another.
  const making = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    if (noteId === '') making.current = null;
  }, [noteId]);
  const make = (): Promise<string | null> => {
    making.current ??= (async () => {
      const id = await window.flintMain.quickNote();
      if (id) {
        made.current.add(id);
        onMade(id);
      }
      return id;
    })();
    return making.current;
  };
  const saveTitle = async (name: string): Promise<void> => {
    setTitled(name);
    const id = noteId || (await make());
    if (!id) return;
    const outcome = await window.flintMain.listAction({ kind: 'rename', id, name });
    if (outcome && !outcome.ok) onToast(outcome.problem, false);
  };
  const more = useRef<HTMLButtonElement>(null);
  /** D-122: Open a note…: the picker under the ⋯ button; the note opens here. */
  const openNote = (): void => {
    const button = more.current;
    if (!button) return;
    const today = new Date().toDateString();
    const sorted = [...notes]
      .filter((note) => note.id !== noteId)
      .sort((a, b) => (b.made ?? 0) - (a.made ?? 0));
    openNotePicker(
      { anchor: button.getBoundingClientRect(), returnFocus: null, trigger: button },
      sorted.map((note) => {
        const made = new Date(note.made ?? 0);
        const when =
          note.made === undefined
            ? null
            : made.toDateString() === today
              ? made.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
              : made.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        return {
          id: note.id,
          label: note.quick?.label ?? note.name,
          hint: note.quick ? 'Quick note' : when,
        };
      }),
      onSwitch,
    );
  };
  const menu = (at: { x: number; y: number }): void => {
    const others = quickNotes.filter((list) => list.id !== noteId);
    const entries: MenuEntry[] = [
      ...others.map((list): MenuEntry => ({
        label: list.quick?.label ?? list.name,
        action: () => onSwitch(list.id),
      })),
      ...(others.length > 0 ? (['divider'] as const) : []),
      // D-122: any note, quick or not, newest first.
      { label: 'Open a note…', disabled: notes.length === 0, action: openNote },
      // D-110: not while this one is empty (it would only be removed).
      { label: 'New quick note', disabled: empty, action: () => onSwitch('') },
      { label: 'Keep as a note', disabled: !noteId || kept || permanent, action: onKeep },
      {
        label: 'Open in Flint',
        disabled: !noteId,
        action: () => noteId && window.flintMini.open({ listId: noteId }),
      },
    ];
    openMenu(entries, at);
  };
  const ready = noteId === '' || made.current.has(noteId) || loaded;
  return (
    <div className="mini-note">
      <div className="mini-note-head">
        <QuickTitle
          key={noteId || 'new'}
          at={quick?.quick?.at ?? quick?.made ?? Date.now()}
          kind={permanent ? 'Note' : 'Quick note'}
          title={title}
          onTitle={(name) => void saveTitle(name)}
        />
        <button
          ref={more}
          type="button"
          className="tool"
          aria-label="Quick notes"
          title="Quick notes"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            menu({ x: box.right - 4, y: box.bottom + 4 });
          }}
        >
          <span className="mini-more" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
      </div>
      {kept && <p className="mini-kept">Kept in Lists</p>}
      {ready && (
        <NoteEditor
          key={editorKey}
          id={noteId}
          text={savedText}
          readOnly={false}
          mono={null}
          window="mini"
          className="note-editor mini-editor"
          onId={(id) => {
            made.current.add(id);
            onMade(id);
          }}
          onImage={() => undefined}
          onText={setTyped}
          create={make}
        />
      )}
    </div>
  );
}
