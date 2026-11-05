import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteEditorState } from '../../shared/ipc.js';

/**
 * MINI-01, NOTE-08, D-109: one window edits a note at a time. The window where Davit types owns
 * it; the other shows the note updating live, read-only, with a quiet "Editing in mini mode" (or
 * "Editing in the main window"). Clicking into the other window's note moves the editing here:
 * the owner saves first and hands over, then this window may type. Used by both windows' note
 * editors (the main window's notes and mini mode's Note tab).
 */

export type EditorWindow = 'main' | 'mini';

/** The main process's word, to every editor of this window (one listener each, for the page). */
const editorListeners = new Set<(state: NoteEditorState) => void>();
const liveListeners = new Set<(noteId: string, text: string) => void>();
const releaseListeners = new Set<(noteId: string) => void>();
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.flintMain.onNoteEditor((state) => {
    for (const listener of editorListeners) listener(state);
  });
  window.flintMain.onLiveNote((noteId, text) => {
    for (const listener of liveListeners) listener(noteId, text);
  });
  window.flintMain.onReleaseNote((noteId) => {
    for (const listener of releaseListeners) listener(noteId);
  });
}

const LIVE_EVERY_MS = 100;

export interface NoteEditing {
  /** Another window edits it: the line to show (the editor is locked meanwhile); else null. */
  readonly elsewhere: string | null;
  /**
   * The other window's text as it typed (null until it has), also the text it handed over: the
   * editor keeps it until a newer read arrives.
   */
  readonly liveText: string | null;
  /** The editor took the focus: the editing moves here (once the owner has saved). */
  readonly claim: () => void;
  /** Typed here: passed on to the other window, a moment later. */
  readonly typed: (text: string) => void;
}

/**
 * `save` saves what this window has (if anything) and gives back its text; it runs when the other
 * window takes the note over.
 */
export function useNoteEditing(
  noteId: string | null,
  me: EditorWindow,
  save: () => Promise<string>,
): NoteEditing {
  const [editor, setEditor] = useState<EditorWindow | null>(null);
  const [liveText, setLiveText] = useState<string | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const pendingLive = useRef<{ timer: number; text: string } | null>(null);

  useEffect(() => {
    if (!noteId) return;
    listen();
    let current = true;
    setEditor(null);
    setLiveText(null);
    void window.flintMain.noteEditorOf(noteId).then((who) => {
      if (current) setEditor(who);
    });
    const onEditor = (state: NoteEditorState): void => {
      if (state.noteId === noteId) setEditor(state.editor);
    };
    const onLive = (id: string, text: string): void => {
      if (id === noteId) setLiveText(text);
    };
    const onRelease = (id: string): void => {
      if (id !== noteId) return;
      void saveRef.current().then((text) => window.flintMain.releasedNote(id, text));
    };
    editorListeners.add(onEditor);
    liveListeners.add(onLive);
    releaseListeners.add(onRelease);
    return () => {
      current = false;
      editorListeners.delete(onEditor);
      liveListeners.delete(onLive);
      releaseListeners.delete(onRelease);
      const waiting = pendingLive.current;
      pendingLive.current = null;
      if (waiting) {
        window.clearTimeout(waiting.timer);
        window.flintMain.liveNote(noteId, waiting.text);
      }
      window.flintMain.leaveNote(noteId);
    };
  }, [noteId]);

  const claim = useCallback((): void => {
    if (!noteId || editor === me) return;
    void window.flintMain.claimNote(noteId);
  }, [noteId, editor, me]);

  const typed = useCallback(
    (text: string): void => {
      if (!noteId) return;
      const waiting = pendingLive.current;
      if (waiting) {
        waiting.text = text;
        return;
      }
      pendingLive.current = {
        text,
        timer: window.setTimeout(() => {
          const latest = pendingLive.current;
          pendingLive.current = null;
          if (latest) window.flintMain.liveNote(noteId, latest.text);
        }, LIVE_EVERY_MS),
      };
    },
    [noteId],
  );

  const elsewhere =
    editor !== null && editor !== me
      ? editor === 'mini'
        ? 'Editing in mini mode'
        : 'Editing in the main window'
      : null;
  return { elsewhere, liveText, claim, typed };
}
