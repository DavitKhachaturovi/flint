/**
 * APP-06, D-136: what the updater is doing, as the main window shows it (Settings → About, the
 * palette, the "Update ready" toast). Pure, so the wording is tested without Electron.
 */

/** Where the updater stands. `off`: a development, test or benchmark build, which never updates. */
export type UpdatePhase = 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

export interface UpdateView {
  readonly phase: UpdatePhase;
  /** When the last check finished (ms), or null before the first. */
  readonly checkedAt: number | null;
  /** The version being downloaded or ready to install. */
  readonly version: string | null;
  /** Download progress, 0 to 100, while downloading. */
  readonly percent: number | null;
  /** Why the last check failed (`offline` or a short reason), in `error`. */
  readonly error: 'offline' | 'failed' | null;
  /** The "Update ready" toast was shown or dismissed this session (it isn't shown again). */
  readonly toastSeen: boolean;
}

export const UPDATE_VIEW_OFF: UpdateView = {
  phase: 'off',
  checkedAt: null,
  version: null,
  percent: null,
  error: null,
  toastSeen: false,
};

/** 14:02 today, otherwise 3 Nov 14:02. */
function when(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

/** The status line under the version in Settings → About (Q2 of M9). */
export function updateStatus(view: UpdateView, now: number): string {
  switch (view.phase) {
    case 'off':
      return 'Updates are off in this build (development and test builds never update).';
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return `Downloading ${view.version ?? 'the update'} · ${Math.round(view.percent ?? 0)}%`;
    case 'ready':
      return `${view.version ?? 'An update'} is ready · it installs when you restart Flint.`;
    case 'error':
      return view.error === 'offline'
        ? 'Couldn’t check for updates (offline).'
        : 'Couldn’t check for updates.';
    case 'idle':
      return view.checkedAt === null
        ? 'Not checked yet.'
        : `Up to date · checked ${when(view.checkedAt, now)}`;
  }
}

/** Whether an error message means there was no connection (the status says "offline"). */
export function isOfflineError(message: string): boolean {
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_PROXY/i.test(
    message,
  );
}
