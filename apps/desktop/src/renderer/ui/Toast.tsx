/** Toast with Undo (03 §4, D-77), shared by the main window and mini mode (D-110). */
import { useCallback, useRef, useState, type ReactElement } from 'react';
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
}

/** A toast shown for `ms`, then playing its way out (D-77). */
export function useToast(ms: number): {
  readonly toast: Toast | null;
  readonly showToast: (
    text: string,
    undo: boolean,
    action?: Toast['action'],
    options?: { readonly dismiss?: Toast['dismiss']; readonly ms?: number },
  ) => void;
  readonly hideToast: () => void;
} {
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  /** D-77: the toast plays its way out, then goes. */
  const hideToast = useCallback((): void => {
    setToast((current) => current && { ...current, leaving: true });
    window.setTimeout(
      () => setToast((current) => (current?.leaving ? null : current)),
      durationMs('--fl-dur-base', 200),
    );
  }, []);
  const showToast = useCallback(
    (
      text: string,
      undo: boolean,
      action?: Toast['action'],
      options?: { readonly dismiss?: Toast['dismiss']; readonly ms?: number },
    ): void => {
      window.clearTimeout(toastTimer.current);
      setToast({
        text,
        undo,
        id: Date.now(),
        ...(action && { action }),
        ...(options?.dismiss && { dismiss: options.dismiss }),
      });
      toastTimer.current = window.setTimeout(hideToast, options?.ms ?? ms);
    },
    [hideToast, ms],
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
  return (
    <div
      className={['toast', className, toast.leaving ? 'leaving' : ''].filter(Boolean).join(' ')}
      role="status"
      key={toast.id}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
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
