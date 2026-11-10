import { get } from 'node:http';
import { describe, expect, it } from 'vitest';
import { signIn, type Fetch } from './oauth.js';

/**
 * SYNC-01, D-161: the sign-in's round trip through the loopback listener, as the browser makes it
 * after Google's consent. (Found on Davit's first real sign-in: the listener read its own port after
 * closing and crashed main.)
 */

/** What the browser does after consent: a GET to the redirect address, with the code and state. */
function browserReturns(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString()));
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function tokenEndpoint(): { fetch: Fetch; bodies: URLSearchParams[] } {
  const bodies: URLSearchParams[] = [];
  const fetch: Fetch = (_url, init) => {
    bodies.push(new URLSearchParams(typeof init?.body === 'string' ? init.body : ''));
    return Promise.resolve(
      new Response(
        JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  };
  return { fetch, bodies };
}

describe('signIn (SYNC-01)', () => {
  it('takes the code from the redirect, exchanges it with the verifier, and the page says done', async () => {
    const { fetch, bodies } = tokenEndpoint();
    let page: Promise<string> = Promise.resolve('');
    const pending = signIn(
      'client',
      (authUrl) => {
        const params = new URL(authUrl).searchParams;
        expect(params.get('code_challenge_method')).toBe('S256');
        expect(params.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
        const redirect = params.get('redirect_uri') ?? '';
        expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
        page = browserReturns(`${redirect}?code=the-code&state=${params.get('state') ?? ''}`);
      },
      fetch,
    );
    const tokens = await pending.result;
    expect(tokens.refreshToken).toBe('refresh');
    expect(await page).toContain('You can close this tab and return to Flint.');
    const [body] = bodies;
    expect(body?.get('code')).toBe('the-code');
    expect(body?.get('grant_type')).toBe('authorization_code');
    expect(body?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(body?.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(body?.has('client_secret')).toBe(false);
  });

  it('refuses an answer with the wrong state, and a declined consent', async () => {
    const { fetch, bodies } = tokenEndpoint();
    const wrong = signIn(
      'client',
      (authUrl) => {
        const redirect = new URL(authUrl).searchParams.get('redirect_uri') ?? '';
        void browserReturns(`${redirect}?code=the-code&state=forged`);
      },
      fetch,
    );
    await expect(wrong.result).rejects.toThrow('Sign-in failed');
    const declined = signIn(
      'client',
      (authUrl) => {
        const params = new URL(authUrl).searchParams;
        void browserReturns(
          `${params.get('redirect_uri') ?? ''}?error=access_denied&state=${params.get('state') ?? ''}`,
        );
      },
      fetch,
    );
    await expect(declined.result).rejects.toThrow('Google Drive access was declined');
    expect(bodies).toEqual([]);
  });

  it('can be cancelled while waiting for the browser', async () => {
    const { fetch } = tokenEndpoint();
    const pending = signIn('client', () => undefined, fetch);
    pending.cancel();
    await expect(pending.result).rejects.toThrow('Sign-in cancelled');
  });
});
