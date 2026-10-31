import { Notification } from 'electron';
import {
  missedSummaryXml,
  reminderToastXml,
  type ReminderToast,
  type ToastOptions,
} from './toast.js';

/** Keeps shown toasts referenced: a garbage-collected Notification can lose its events. */
const shown = new Set<Notification>();

function show(toastXml: string, what: string, log: (message: string) => void): void {
  const notification = new Notification({ toastXml });
  shown.add(notification);
  notification.on('show', () => log(`toast shown for ${what}`));
  notification.on('close', () => shown.delete(notification));
  notification.on('failed', (_event, error) => {
    log(`toast failed for ${what}: ${error}`);
    shown.delete(notification);
  });
  notification.show();
}

/** Shows an actionable reminder toast (REM-05); its buttons launch the build's scheme (toast.ts). */
export function showReminderToast(
  toast: ReminderToast,
  options: ToastOptions,
  log: (message: string) => void = () => {},
): void {
  show(reminderToastXml(toast, options), `task ${toast.id}`, log);
}

/** "N reminders you missed" (REM-07 basic, D-64). */
export function showMissedSummary(
  summary: { readonly count: number; readonly titles: readonly string[] },
  options: ToastOptions,
  log: (message: string) => void = () => {},
): void {
  show(missedSummaryXml(summary, options), `${summary.count} missed reminders`, log);
}
