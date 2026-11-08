/** Toast with Undo (03 §4, D-77), shared by the main window and mini mode (D-110). */
import { useCallback, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { CONFIRM_MS, type ConfirmNotice, type UndoNotice } from '../media/media.js';
import { durationMs } from './motion.js';

export interface Toast {
  readonly text: string;
  readonly undo: boolean;
  readonly id: number;
  /** TASK-09, D-88: another way out ("Keep as one"), next to Undo. */
  readonly action?: { readonly label: string; readonly run: () => void };
  /** APP-06, D-136: a button that only closes it ("Later"), after the action. */
  readonly dismiss?: { readonly label: string; readonly run?: () => void };
  /** D-77: playing its way out. */
  readonly leaving?: boolean;
  /** D-144: a toast that asks (Delete / Cancel): announced as an alert, not a status. */
  readonly asks?: boolean;
}

/** How a toast is shown, besides its text and buttons. */
export interface ToastOptions {
  readonly dismiss?: Toast['dismiss'];
  readonly ms?: number;
  readonly asks?: boolean;
  /**
   * D-144: runs once when this toast goes for any reason: a button, its time running out, another
   * toast taking its place, or hideToast (a toast that asks counts all but its action as Cancel).
   */
  readonly onEnd?: () => void;
}

/** A toast shown for `ms`, then playing its way out (D-77). */
export function useToast(ms: number): {
  readonly toast: Toast | null;
  readonly showToast: (
    text: string,
    undo: boolean,
    action?: Toast['action'],
    options?: ToastOptions,
  ) => void;
  readonly hideToast: () => void;
} {
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const toastEnd = useRef<(() => void) | undefined>(undefined);
  /** D-144: the shown toast's onEnd, once. */
  const ended = useCallback((): void => {
    const run = toastEnd.current;
    toastEnd.current = undefined;
    run?.();
  }, []);
  /** D-77: the toast plays its way out, then goes. */
  const hideToast = useCallback((): void => {
    ended();
    setToast((current) => current && { ...current, leaving: true });
    window.setTimeout(
      () => setToast((current) => (current?.leaving ? null : current)),
      durationMs('--fl-dur-base', 200),
    );
  }, [ended]);
  const showToast = useCallback(
    (text: string, undo: boolean, action?: Toast['action'], options?: ToastOptions): void => {
      window.clearTimeout(toastTimer.current);
      ended();
      toastEnd.current = options?.onEnd;
      setToast({
        text,
        undo,
        id: Date.now(),
        ...(action && { action }),
        ...(options?.dismiss && { dismiss: options.dismiss }),
        ...(options?.asks && { asks: true }),
      });
      toastTimer.current = window.setTimeout(hideToast, options?.ms ?? ms);
    },
    [ended, hideToast, ms],
  );
  return { toast, showToast, hideToast };
}

export function ToastView(props: {
  readonly toast: Toast;
  /** `above-bar`: above the multi-select action bar (TASK-07). */
  readonly className?: string;
  readonly onHide: () => void;
  readonly onUndo: () => void;
}): ReactElement {
  const { toast, className = '', onHide, onUndo } = props;
  // D-144: a toast that asks leaves the focus where it was (the note's editor, a table's cell).
  const keepFocus = toast.asks ? (event: MouseEvent): void => event.preventDefault() : undefined;
  return (
    <div
      className={['toast', className, toast.leaving ? 'leaving' : ''].filter(Boolean).join(' ')}
      role={toast.asks ? 'alert' : 'status'}
      key={toast.id}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => {
            toast.action?.run();
            onHide();
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.dismiss && (
        <button
          type="button"
          className="toast-dismiss"
          onMouseDown={keepFocus}
          onClick={() => {
            toast.dismiss?.run?.();
            onHide();
          }}
        >
          {toast.dismiss.label}
        </button>
      )}
      {toast.undo && (
        <button type="button" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}

/**
 * NOTE-10: an editor's change with its own Undo (announceUndo) as the window's toast; its `hide`
 * takes away only this toast, never one shown after it (D-144).
 */
export function showUndoNotice(
  showToast: ReturnType<typeof useToast>['showToast'],
  hideToast: () => void,
  notice: UndoNotice,
): void {
  let up = true;
  showToast(notice.text, false, { label: 'Undo', run: notice.undo }, { onEnd: () => (up = false) });
  notice.hide = () => {
    if (up) hideToast();
  };
}

/**
 * D-144: an editor's question (announceConfirm) as the window's toast: its action, then Cancel;
 * the toast's time running out or another toast taking its place counts as Cancel.
 */
export function showQuestion(
  showToast: ReturnType<typeof useToast>['showToast'],
  hideToast: () => void,
  question: ConfirmNotice,
): void {
  showToast(
    question.text,
    false,
    { label: question.label, run: question.confirm },
    {
      dismiss: { label: 'Cancel', run: question.cancel },
      ms: CONFIRM_MS,
      asks: true,
      onEnd: question.cancel,
    },
  );
  question.hide = hideToast;
}
