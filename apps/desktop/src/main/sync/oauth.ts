/**
 * Signing in to Google for Drive sync (SYNC-01, D-161, docs/05 §5): OAuth 2.0 for desktop apps,
 * the authorization in the default browser, PKCE (S256), a `state` check, and the redirect to a
 * loopback listener on 127.0.0.1 that exists only while a sign-in is under way (two minutes at most).
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AUTH_URL, DRIVE_SCOPE, REVOKE_URL, TOKEN_URL } from './google.js';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The Desktop app client: its ID, and its secret (required by Google's token endpoint). */
export interface Client {
  readonly id: string;
  readonly secret: string;
}

export interface Tokens {
  readonly refreshToken: string;
  readonly accessToken: string;
  /** When the access token stops working (ms). */
  readonly expires: number;
  /**
   * The files picked in Google's picker (SPACE-06, R-S2): `drive.file` can open a file shared with
   * this account only after it is picked. Present only when the sign-in opened the picker.
   */
  readonly picked?: readonly string[];
}

/**
 * Google's picker inside the sign-in (SPACE-06, D-189 Q6, docs/05 §5): the authorization URL with
 * `trigger_onepick`, shown in the default browser like any sign-in, answering with
 * `picked_file_ids` beside the code. Only the `drive.file` scope is allowed with it (Flint's one).
 */
export interface PickOptions {
  /** Show only these files (the space's two, from its join link). */
  readonly fileIds?: readonly string[];
  /** Show only files of these types (Find it in Google Drive: Flint's space files). */
  readonly mimeTypes?: readonly string[];
  /** Several files in one Select (both of a space's files, D-190 Q8). */
  readonly allowMultiple?: boolean;
  /**
   * Ask which Google account first (`prompt=select_account consent`): a browser signed in to several
   * accounts would otherwise pick one by itself, and joining is per account (SPACE-06).
   */
  readonly chooseAccount?: boolean;
}

/** Drive's file IDs: what `picked_file_ids` may hold (anything else is dropped). */
const PICKED_ID = /^[A-Za-z0-9_-]{10,200}$/;

/** How long a sign-in waits for the browser before giving up. */
export const SIGN_IN_TIMEOUT_MS = 2 * 60 * 1000;

const base64url = (bytes: Buffer): string =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const DONE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Flint</title>
<style>body{background:#0D0E10;color:#E8E9EB;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head><body><p>You can close this tab and return to Flint.</p></body></html>`;

const FAILED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Flint</title>
<style>body{background:#0D0E10;color:#E8E9EB;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head><body><p>Google Drive wasn't connected. You can close this tab and try again in Flint.</p></body></html>`;

export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}

/** One sign-in under way: `result` settles with the tokens, or rejects (cancelled, refused, timed out). */
export interface SignIn {
  readonly result: Promise<Tokens>;
  cancel(): void;
}

/**
 * Opens Google's sign-in in the browser (`open`) and waits for its answer on a loopback listener.
 * `fetch` is sync's own session (the network guard lets it reach Google's token host). With `pick`,
 * the sign-in shows Google's picker and the tokens carry the picked files.
 */
export function signIn(
  client: Client,
  open: (url: string) => void,
  fetch: Fetch,
  pick?: PickOptions,
): SignIn {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(24));
  let server: Server | null = null;
  let timer: NodeJS.Timeout | undefined;
  let cancel: () => void = () => undefined;
  /** The redirect address, known once the listener has its port (it is needed after it closes). */
  let redirect = '';
  let answered = false;

  /** No more connections; the ones open finish (the page just sent reaches the browser). */
  const close = (): void => {
    clearTimeout(timer);
    const closing = server;
    server = null;
    closing?.close();
    setTimeout(() => closing?.closeAllConnections(), 2000).unref();
  };

  const result = new Promise<Tokens>((resolve, reject) => {
    cancel = () => {
      close();
      reject(new SignInCancelled());
    };
    const listener = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      // Only the one answer counts (a browser may ask again, or for its icon).
      if (url.pathname !== '/' || answered) {
        response.writeHead(404).end();
        return;
      }
      answered = true;
      const code = url.searchParams.get('code');
      const returned = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const ok = code !== null && returned === state && error === null;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(ok ? DONE_PAGE : FAILED_PAGE);
      close();
      if (!ok) {
        reject(
          new Error(
            error === 'access_denied' ? 'Google Drive access was declined' : 'Sign-in failed',
          ),
        );
        return;
      }
      const picked = pick
        ? (url.searchParams.get('picked_file_ids') ?? '')
            .split(',')
            .filter((id) => PICKED_ID.test(id))
        : undefined;
      exchange(client, code, verifier, redirect, fetch).then(
        (tokens) => resolve(picked ? { ...tokens, picked } : tokens),
        reject,
      );
    });
    server = listener;
    listener.on('error', (error) => {
      close();
      reject(error);
    });
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address() as AddressInfo;
      redirect = `http://127.0.0.1:${port}/`;
      const params = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        // A refresh token every time (a second connection would otherwise get none). The picker
        // requires it too.
        prompt: 'consent',
      });
      if (pick) {
        params.set('trigger_onepick', 'true');
        if (pick.chooseAccount) params.set('prompt', 'select_account consent');
        if (pick.allowMultiple) params.set('allow_multiple', 'true');
        if (pick.fileIds?.length) params.set('file_ids', pick.fileIds.join(','));
        if (pick.mimeTypes?.length) params.set('mimetypes', pick.mimeTypes.join(','));
      }
      open(`${AUTH_URL}?${params.toString()}`);
    });
    timer = setTimeout(() => {
      close();
      reject(new Error('Sign-in timed out'));
    }, SIGN_IN_TIMEOUT_MS);
  });
  return { result, cancel: () => cancel() };
}

async function exchange(
  client: Client,
  code: string,
  verifier: string,
  redirect: string,
  fetch: Fetch,
): Promise<Tokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.id,
      ...(client.secret ? { client_secret: client.secret } : {}),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirect,
    }).toString(),
  });
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(
      [body.error, body.error_description].filter(Boolean).join(': ') ||
        `Sign-in failed (${response.status})`,
    );
  }
  return {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expires: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

export class AuthExpired extends Error {
  constructor() {
    super('Sign in again');
    this.name = 'AuthExpired';
  }
}

/** A new access token from the refresh token; `AuthExpired` when Google refuses it (revoked). */
export async function refresh(client: Client, refreshToken: string, fetch: Fetch): Promise<Tokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.id,
      ...(client.secret ? { client_secret: client.secret } : {}),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (response.status === 400 || response.status === 401) throw new AuthExpired();
  if (!response.ok || !body.access_token)
    throw new Error(body.error ?? `Token refresh failed (${response.status})`);
  return {
    refreshToken,
    accessToken: body.access_token,
    expires: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/** Disconnect: Google forgets Flint's access (best effort; offline, it stays until revoked there). */
export async function revoke(token: string, fetch: Fetch): Promise<void> {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}
