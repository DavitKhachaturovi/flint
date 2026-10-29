import { Notification } from 'electron';
import type { ToastKind } from '../shared/ipc.js';

/**
 * Actionable reminder toasts (REM-05, R-3). Buttons use protocol activation (`flint://…`, docs/05 §5):
 * Windows starts `Flint.exe flint://reminder/done?id=…`, and the single-instance lock routes it to the
 * running app. That works while the toast is on screen, from Action Center, and when Flint isn't
 * running, which Electron's in-process action events don't cover.
 */

export const PROTOCOL = 'flint';

export type ReminderAction = 'done' | 'snooze' | 'open';

export interface ReminderActivation {
  readonly action: ReminderAction;
  readonly id: string;
}

export interface ReminderToast {
  readonly id: string;
  readonly title: string;
  /** Shown above the title, e.g. "Reminder · 15:00". */
  readonly label: string;
  /**
   * `reminder` stays on screen until dismissed; `urgent` is Windows' "important notification",
   * which the user can let through Do Not Disturb (REM-06, to be verified on the author machines).
   */
  readonly kind: ToastKind;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function actionUrl(action: ReminderAction, id: string): string {
  return escapeXml(`${PROTOCOL}://reminder/${action}?id=${encodeURIComponent(id)}`);
}

export function reminderToastXml(toast: ReminderToast): string {
  const scenario = toast.kind === 'default' ? '' : ` scenario="${toast.kind}"`;
  return [
    `<toast launch="${actionUrl('open', toast.id)}" activationType="protocol"${scenario}>`,
    '<visual><binding template="ToastGeneric">',
    `<text>${escapeXml(toast.label)}</text>`,
    `<text>${escapeXml(toast.title)}</text>`,
    '</binding></visual>',
    '<actions>',
    `<action content="Done" arguments="${actionUrl('done', toast.id)}" activationType="protocol"/>`,
    `<action content="Snooze 10m" arguments="${actionUrl('snooze', toast.id)}" activationType="protocol"/>`,
    `<action content="Open" arguments="${actionUrl('open', toast.id)}" activationType="protocol"/>`,
    '</actions>',
    '</toast>',
  ].join('');
}

/** Parses `flint://reminder/<action>?id=<id>` from a command line or protocol launch. */
export function parseActivation(argument: string): ReminderActivation | null {
  if (!argument.startsWith(`${PROTOCOL}://`)) return null;
  try {
    const url = new URL(argument);
    const action = url.pathname.replace(/^\/+/, '');
    const id = url.searchParams.get('id');
    if (url.hostname !== 'reminder' || !id) return null;
    if (action !== 'done' && action !== 'snooze' && action !== 'open') return null;
    return { action, id };
  } catch {
    return null;
  }
}

export function findActivation(argv: readonly string[]): ReminderActivation | null {
  for (const argument of argv) {
    const activation = parseActivation(argument);
    if (activation) return activation;
  }
  return null;
}

/** Keeps shown toasts referenced: a garbage-collected Notification can lose its events. */
const shown = new Set<Notification>();

export function showReminderToast(toast: ReminderToast): void {
  const notification = new Notification({ toastXml: reminderToastXml(toast) });
  shown.add(notification);
  notification.on('close', () => shown.delete(notification));
  notification.on('failed', () => shown.delete(notification));
  notification.show();
}
