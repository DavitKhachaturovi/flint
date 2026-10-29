import type { ToastKind } from '../shared/ipc.js';

/**
 * Reminder toast XML and its activation URLs (REM-05, R-3). Buttons use protocol activation
 * (`flint://…`, docs/05 §5): Windows starts `Flint.exe flint://reminder/done?id=…`, and the
 * single-instance lock routes it to the running app. That works while the toast is on screen, from
 * Action Center, and when Flint isn't running, which Electron's in-process action events don't cover.
 * The scheme is per build (D-33): `flint` installed, `flint-dev` in development.
 */

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
   * `reminder` stays on screen until acted on and shows during Do Not Disturb with Windows' default
   * priority settings (REM-06); `urgent` is Windows' "important notification".
   */
  readonly kind: ToastKind;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** REM-10: what a toast says instead of the task when "Hide task text in notifications" is on. */
export const PRIVATE_TOAST_TEXT = 'Flint reminder';

export interface ToastOptions {
  /** The build's scheme for the buttons (D-33). */
  readonly protocol: string;
  /** REM-10: show only "Flint reminder", never the task or its time (screen sharing). */
  readonly hideText: boolean;
}

export function reminderToastXml(
  toast: ReminderToast,
  { protocol, hideText }: ToastOptions,
): string {
  const actionUrl = (action: ReminderAction): string =>
    escapeXml(`${protocol}://reminder/${action}?id=${encodeURIComponent(toast.id)}`);
  const scenario = toast.kind === 'default' ? '' : ` scenario="${toast.kind}"`;
  return [
    `<toast launch="${actionUrl('open')}" activationType="protocol"${scenario}>`,
    '<visual><binding template="ToastGeneric">',
    ...(hideText
      ? [`<text>${PRIVATE_TOAST_TEXT}</text>`]
      : [`<text>${escapeXml(toast.label)}</text>`, `<text>${escapeXml(toast.title)}</text>`]),
    '</binding></visual>',
    '<actions>',
    `<action content="Done" arguments="${actionUrl('done')}" activationType="protocol"/>`,
    `<action content="Snooze 10m" arguments="${actionUrl('snooze')}" activationType="protocol"/>`,
    `<action content="Open" arguments="${actionUrl('open')}" activationType="protocol"/>`,
    '</actions>',
    '</toast>',
  ].join('');
}

/** Parses `<protocol>://reminder/<action>?id=<id>` from a command line or protocol launch. */
export function parseActivation(argument: string, protocol: string): ReminderActivation | null {
  if (!argument.startsWith(`${protocol}://`)) return null;
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

export function findActivation(
  argv: readonly string[],
  protocol: string,
): ReminderActivation | null {
  for (const argument of argv) {
    const activation = parseActivation(argument, protocol);
    if (activation) return activation;
  }
  return null;
}
