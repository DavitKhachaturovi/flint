/**
 * How sync reaches Google (SYNC-01, D-161 Q7, docs/05 §5): the installed and development builds
 * sign in with Google and talk to the Drive API through sync's own session; test runs get an
 * in-process fake Drive and sign-in instead, so the network test still allows no endpoint at all.
 */
import { FakeDrive } from '@flint/core/sync';
import {
  DRIVE_TRASH_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  fileUrl,
  folderUrl,
} from './google.js';
import { GoogleDrive } from './google-drive.js';
import {
  AuthExpired,
  refresh,
  revoke,
  signIn,
  type Client,
  type Fetch,
  type Tokens,
} from './oauth.js';

const CLIENT: Client = { id: GOOGLE_CLIENT_ID, secret: GOOGLE_CLIENT_SECRET };
import type { SyncConnection } from './service.js';

/** The real one: Google's sign-in in the browser, the Drive API over `fetch` (sync's session). */
export function googleConnection(fetch: Fetch, open: (url: string) => void): SyncConnection {
  return {
    // Both halves, or the build says "Not set up in this build".
    available: CLIENT.id !== '' && CLIENT.secret !== '',
    signIn() {
      const pending = signIn(CLIENT, open, fetch);
      const result = pending.result.then(async (tokens) => {
        const drive = new GoogleDrive({ fetch, token: () => Promise.resolve(tokens.accessToken) });
        return { email: await drive.email(), refreshToken: tokens.refreshToken };
      });
      return { result, cancel: () => pending.cancel() };
    },
    drive(refreshToken) {
      let tokens: Tokens | null = null;
      return new GoogleDrive({
        fetch,
        token: async (fresh) => {
          if (!tokens || fresh || tokens.expires - Date.now() < 60_000) {
            try {
              tokens = await refresh(CLIENT, refreshToken, fetch);
            } catch (error) {
              if (error instanceof AuthExpired) {
                const { DriveError } = await import('@flint/core/sync');
                throw new DriveError('auth');
              }
              throw error;
            }
          }
          return tokens.accessToken;
        },
      });
    },
    revoke: (refreshToken) => revoke(refreshToken, fetch),
    open,
    folderUrl,
    fileUrl,
    trashUrl: DRIVE_TRASH_URL,
  };
}

/** Test runs: one fake Drive in this process, a sign-in that answers at once (FLINT_E2E). */
export function testConnection(fake: FakeDrive, open: (url: string) => void): SyncConnection {
  return {
    available: true,
    signIn() {
      return {
        result: Promise.resolve({ email: 'you@gmail.com', refreshToken: 'test-token' }),
        cancel: () => undefined,
      };
    },
    drive: () => fake.as(),
    revoke: () => Promise.resolve(),
    open,
    folderUrl,
    fileUrl,
    trashUrl: DRIVE_TRASH_URL,
  };
}
