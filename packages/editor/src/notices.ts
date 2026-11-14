/**
 * The editor's messages for the app's toast (NOTE-10, D-144), as window events the app listens to:
 * the desktop's toast shows them; the phone's undo bar will (D-165 Q5).
 */

/** A short message (a refused program, a failed copy) for the window's toast. */
export function announce(text: string): void {
  window.dispatchEvent(new CustomEvent<string>('flint:notice', { detail: text }));
}

/** An editor's change with its own Undo (a table's row deleted, NOTE-10): the window's toast. */
export interface UndoNotice {
  readonly text: string;
  readonly undo: () => void;
  /** Set by the window that shows it: takes this toast away, if it is still the one shown. */
  hide?: () => void;
}

/**
 * Shows the Undo toast; returns the way to take it away from the editor (D-144, Proposed: the
 * note edited again, so its Undo could only take back something else). Never another toast.
 */
export function announceUndo(text: string, undo: () => void): () => void {
  const notice: UndoNotice = { text, undo };
  window.dispatchEvent(new CustomEvent<UndoNotice>('flint:notice-undo', { detail: notice }));
  return () => notice.hide?.();
}

/**
 * D-144: an editor's question for the window's toast ("This deletes content in 2 cells", Delete /
 * Cancel). `confirm` and `cancel` run at most once between them; the window shows it with
 * `cancel` as the toast's end, so its time running out or another toast counts as Cancel.
 */
export interface ConfirmNotice {
  readonly text: string;
  readonly label: string;
  readonly confirm: () => void;
  readonly cancel: () => void;
  /** Set by the window that shows it: takes the toast away (Esc in the editor). */
  hide?: () => void;
}

/** How long a question stays up, longer than a notice: it waits for an answer (D-144). */
export const CONFIRM_MS = 8000;

/**
 * Asks in the window's toast; returns the way to cancel from the editor (Esc), which also takes
 * the toast away. With no window to show it (none listening), it is cancelled at once.
 */
export function announceConfirm(
  text: string,
  label: string,
  answer: { readonly confirm: () => void; readonly cancel: () => void },
): () => void {
  let settled = false;
  const once = (run: () => void) => (): void => {
    if (settled) return;
    settled = true;
    run();
  };
  const notice: ConfirmNotice = {
    text,
    label,
    confirm: once(answer.confirm),
    cancel: once(answer.cancel),
  };
  window.dispatchEvent(new CustomEvent<ConfirmNotice>('flint:notice-confirm', { detail: notice }));
  if (!notice.hide) notice.cancel();
  return () => {
    if (settled) return;
    notice.cancel();
    notice.hide?.();
  };
}
