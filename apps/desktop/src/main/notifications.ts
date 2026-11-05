import { Notification } from 'electron';
import {
  missedSummaryXml,
  reminderToastXml,
  type ReminderToast,
  type ToastOptions,
} from './toast.js';

/** Keeps shown toasts referenced: a garbage-collected Notification can lose its events. */
const shown = new Set<Notification>();

/**
 * D-109: each reminder's toast by its task, kept until the reminder is acted on, so acting in mini
 * mode can take the toast back (`close()` also removes it from Action Center on Windows). Kept past
 * its `close` event: by then it may sit in Action Center.
 */
const reminderToasts = new Map<string, Notification>();

function show(toastXml: string, what: string, log: (message: string) => void): Notification {
  const notification = new Notification({ toastXml });
  shown.add(notification);
  notification.on('show', () => log(`toast shown for ${what}`));
  notification.on('close', () => shown.delete(notification));
  notification.on('failed', (_event, error) => {
    log(`toast failed for ${what}: ${error}`);
    shown.delete(notification);
  });
  notification.show();
  return notification;
}

/** Shows an actionable reminder toast (REM-05); its buttons launch the build's scheme (toast.ts). */
export function showReminderToast(
  toast: ReminderToast,
  options: ToastOptions,
  log: (message: string) => void = () => {},
): void {
  reminderToasts.get(toast.id)?.close();
  reminderToasts.set(toast.id, show(reminderToastXml(toast, options), `task ${toast.id}`, log));
}

/** D-109: a reminder acted on elsewhere (mini mode): its toast goes, from Action Center too. */
export function closeReminderToast(id: string): boolean {
  const toast = reminderToasts.get(id);
  reminderToasts.delete(id);
  toast?.close();
  return toast !== undefined;
}

/** "N reminders you missed" (REM-07 basic, D-64). */
export function showMissedSummary(
  summary: { readonly count: number; readonly titles: readonly string[] },
  options: ToastOptions,
  log: (message: string) => void = () => {},
): void {
  show(missedSummaryXml(summary, options), `${summary.count} missed reminders`, log);
}
