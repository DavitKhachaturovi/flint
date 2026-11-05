/**
 * MINI-01, NOTE-08, D-109: one window edits a note at a time. The window where Davit types owns the
 * note; the other shows it updating live, read-only ("Editing in mini mode"). Clicking into the
 * other window's note moves the editing there: the owner saves first, hands over its text, and only
 * then may the other window type, so two windows' unsaved edits can never overwrite each other.
 */

export type EditorWindow = 'main' | 'mini';

export interface NoteEditorEvents {
  /** Ask `to` to save `noteId` and hand it over (it answers with `released`). */
  readonly release: (to: EditorWindow, noteId: string) => void;
  /** The owner's text, for the window that only shows it. */
  readonly live: (to: EditorWindow, noteId: string, text: string) => void;
  /** Who edits `noteId` now, to both windows. */
  readonly editor: (noteId: string, editor: EditorWindow | null) => void;
}

const other = (window: EditorWindow): EditorWindow => (window === 'main' ? 'mini' : 'main');

/** How long a hand-over waits for the owner's save (a window that doesn't answer is passed by). */
export const RELEASE_TIMEOUT_MS = 1500;

export class NoteEditors {
  private readonly owners = new Map<string, EditorWindow>();
  private readonly waiting = new Map<string, (text: string | null) => void>();

  private readonly events: NoteEditorEvents;
  private readonly timeout: number;

  constructor(events: NoteEditorEvents, timeout = RELEASE_TIMEOUT_MS) {
    this.events = events;
    this.timeout = timeout;
  }

  owner(noteId: string): EditorWindow | null {
    return this.owners.get(noteId) ?? null;
  }

  /** `by` wants to type in the note: once this resolves it may. */
  async claim(noteId: string, by: EditorWindow): Promise<boolean> {
    const owner = this.owners.get(noteId);
    if (owner === by) return true;
    if (owner) {
      const text = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), this.timeout);
        this.waiting.set(noteId, (handed) => {
          clearTimeout(timer);
          resolve(handed);
        });
        this.events.release(owner, noteId);
      });
      this.waiting.delete(noteId);
      // The text the owner saved, before the new owner's first key.
      if (text !== null) this.events.live(by, noteId, text);
    }
    this.owners.set(noteId, by);
    this.events.editor(noteId, by);
    return true;
  }

  /** The owner saved and lets go (its answer to `release`). */
  released(noteId: string, from: EditorWindow, text: string): void {
    if (this.owners.get(noteId) === from) this.owners.delete(noteId);
    this.waiting.get(noteId)?.(text);
  }

  /** The owner typed: the other window shows it. */
  live(noteId: string, from: EditorWindow, text: string): void {
    if (this.owners.get(noteId) === from) this.events.live(other(from), noteId, text);
  }

  /** `from` no longer shows the note (another list, mini hidden, the note gone). */
  leave(noteId: string, from: EditorWindow): void {
    if (this.owners.get(noteId) !== from) return;
    this.owners.delete(noteId);
    this.events.editor(noteId, null);
  }

  /** A window went away (hidden, reloaded): it edits nothing. */
  leaveAll(from: EditorWindow): void {
    for (const [noteId, owner] of [...this.owners]) if (owner === from) this.leave(noteId, from);
  }
}
