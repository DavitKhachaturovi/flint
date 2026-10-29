import { Notification } from 'electron';
import { reminderToastXml, type ReminderToast, type ToastOptions } from './toast.js';

/** Keeps shown toasts referenced: a garbage-collected Notification can lose its events. */
const shown = new Set<Notification>();

/** Shows an actionable reminder toast (REM-05); its buttons launch the build's scheme (toast.ts). */
export function showReminderToast(
  toast: ReminderToast,
  options: ToastOptions,
  log: (message: string) => void = () => {},
): void {
  const notification = new Notification({ toastXml: reminderToastXml(toast, options) });
  shown.add(notification);
  notification.on('show', () => log(`toast shown for task ${toast.id}`));
  notification.on('close', () => shown.delete(notification));
  notification.on('failed', (_event, error) => {
    log(`toast failed for task ${toast.id}: ${error}`);
    shown.delete(notification);
  });
  notification.show();
}
