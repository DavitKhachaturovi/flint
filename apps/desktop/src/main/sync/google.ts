/**
 * Google Drive sync's Google side (SYNC-01, D-161, docs/05 §5, docs/06 §6). The OAuth client is a
 * "Desktop app" client in Davit's Google Cloud project: its ID is public by design (desktop clients
 * are public clients, D-161 Q7), and with PKCE Google no longer needs the client secret, so none
 * ships. Users only sign in.
 */

/**
 * The client ID of the Cloud project's Desktop app client (docs/06 §6, step 7; set 10 Nov 2026).
 * Empty, Settings → Sync would say "Not set up in this build".
 */
export const GOOGLE_CLIENT_ID: string =
  '432838445401-sco8s20ttj1080svf3ta4v2daomu547k.apps.googleusercontent.com';

/**
 * The Desktop client's secret, injected at build time (never in the repository): Google's token
 * endpoint refuses a desktop client's exchange without it, PKCE or not (found 10 Nov 2026, D-161).
 * It can't be kept secret in a desktop app and doesn't need to be: it opens nothing on its own.
 */
export const GOOGLE_CLIENT_SECRET: string =
  typeof __FLINT_GOOGLE_CLIENT_SECRET__ === 'string' ? __FLINT_GOOGLE_CLIENT_SECRET__ : '';

/** The one scope: only files Flint created (non-sensitive, D-161). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/**
 * The hosts sync's own session may reach (docs/05 §5), HTTPS only, and only while Drive is
 * connected or a sign-in is under way. The sign-in page itself opens in the default browser, never
 * in Flint, so `accounts.google.com` is not among them.
 */
export const SYNC_HOSTS: readonly string[] = ['oauth2.googleapis.com', 'www.googleapis.com'];

/** sync's own session (`session.fromPartition`): the only one that may reach SYNC_HOSTS. */
export const SYNC_SESSION = 'sync';

export function isSyncRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.port === '' &&
      parsed.username === '' &&
      SYNC_HOSTS.includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** Where a Drive folder opens in the browser (Open in Drive). */
export function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
}

/** Drive's trash in the browser (Restore it in Drive, D-161 Q8). */
export const DRIVE_TRASH_URL = 'https://drive.google.com/drive/trash';
