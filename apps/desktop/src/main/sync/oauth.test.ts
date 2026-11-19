import { get } from 'node:http';
import { describe, expect, it } from 'vitest';
import { signIn, type Fetch } from './oauth.js';

const CLIENT = { id: 'client', secret: 'the-secret' };

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
      CLIENT,
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
    expect(body?.get('client_secret')).toBe('the-secret');
  });

  it('refuses an answer with the wrong state, and a declined consent', async () => {
    const { fetch, bodies } = tokenEndpoint();
    const wrong = signIn(
      CLIENT,
      (authUrl) => {
        const redirect = new URL(authUrl).searchParams.get('redirect_uri') ?? '';
        void browserReturns(`${redirect}?code=the-code&state=forged`);
      },
      fetch,
    );
    await expect(wrong.result).rejects.toThrow('Sign-in failed');
    const declined = signIn(
      CLIENT,
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

  it("says Google's reason when the exchange is refused", async () => {
    const refused: Fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'invalid_request',
            error_description: 'client_secret is missing.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const pending = signIn(
      CLIENT,
      (authUrl) => {
        const params = new URL(authUrl).searchParams;
        void browserReturns(
          `${params.get('redirect_uri') ?? ''}?code=c&state=${params.get('state') ?? ''}`,
        );
      },
      refused,
    );
    await expect(pending.result).rejects.toThrow('invalid_request: client_secret is missing.');
  });

  it("SPACE-06 (R-S2): opens Google's picker for the given files and returns the picked ones", async () => {
    const { fetch } = tokenEndpoint();
    const space = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const files = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa543210';
    const pending = signIn(
      CLIENT,
      (authUrl) => {
        const params = new URL(authUrl).searchParams;
        expect(params.get('trigger_onepick')).toBe('true');
        expect(params.get('allow_multiple')).toBe('true');
        expect(params.get('file_ids')).toBe(`${space},${files}`);
        // Joining is per account: Google asks which one even when the browser has several.
        expect(params.get('prompt')).toBe('select_account consent');
        expect(params.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
        // Google appends the picked files; anything that isn't a Drive ID is dropped.
        void browserReturns(
          `${params.get('redirect_uri') ?? ''}?picked_file_ids=${space},${files},..%2Fbad&code=c&state=${params.get('state') ?? ''}`,
        );
      },
      fetch,
      { fileIds: [space, files], allowMultiple: true, chooseAccount: true },
    );
    expect((await pending.result).picked).toEqual([space, files]);
  });

  it('a plain sign-in carries no picker parameters and no picked files', async () => {
    const { fetch } = tokenEndpoint();
    const pending = signIn(
      CLIENT,
      (authUrl) => {
        const params = new URL(authUrl).searchParams;
        expect(params.has('trigger_onepick')).toBe(false);
        expect(params.has('file_ids')).toBe(false);
        void browserReturns(
          `${params.get('redirect_uri') ?? ''}?picked_file_ids=1AbCdEfGhIjKlMnOp&code=c&state=${params.get('state') ?? ''}`,
        );
      },
      fetch,
    );
    expect((await pending.result).picked).toBeUndefined();
  });

  it('can be cancelled while waiting for the browser', async () => {
    const { fetch } = tokenEndpoint();
    const pending = signIn(CLIENT, () => undefined, fetch);
    pending.cancel();
    await expect(pending.result).rejects.toThrow('Sign-in cancelled');
  });
});
