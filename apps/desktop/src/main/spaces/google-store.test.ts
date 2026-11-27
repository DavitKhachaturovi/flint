/* eslint-disable @typescript-eslint/require-await -- a scripted Drive answers at once. */
import { SpaceStoreError, writeSafely, type Merge3 } from '@flint/core/spaces';
import { describe, expect, it } from 'vitest';
import { GoogleDrive } from '../sync/google-drive.js';
import { googleSpaceStore } from './google-store.js';

/**
 * SPACE-02 (D-190 Q9): Google Drive as a space store, against a scripted Drive (no network): the
 * calls it makes, the write checked before writing, the revisions read for the write-gap repair,
 * and Drive's errors as the store's.
 */
interface Call {
  readonly method: string;
  readonly url: string;
}

/** A tiny Drive: one file, its revisions, its permissions; another write can land in the gap. */
function scriptedDrive() {
  const calls: Call[] = [];
  const revisions: { id: string; content: Uint8Array; time: string }[] = [
    { id: 'r1', content: new TextEncoder().encode('start'), time: '2026-03-10T09:00:00.000Z' },
  ];
  const permissions = [
    { id: 'p0', emailAddress: 'alex@example.com', displayName: 'Alex', role: 'owner' },
    { id: 'p1', emailAddress: 'sam@example.com', displayName: 'Sam', role: 'writer' },
  ];
  let gap: (() => void) | null = null;
  let counter = 1;
  const head = () => revisions.at(-1) ?? { id: '', content: new Uint8Array(), time: '' };
  const file = () => ({
    id: 'f1',
    name: 'Home.flintspace',
    headRevisionId: head().id,
    size: String(head().content.length),
    modifiedTime: head().time,
  });
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const push = (content: Uint8Array): void => {
    counter++;
    revisions.push({ id: `r${counter}`, content, time: `2026-03-10T09:0${counter}:00.000Z` });
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (url.includes('/files/missing')) return json({ error: { code: 404 } }, 404);
    if (url.includes('/upload/drive/v3/files/f1') && method === 'PATCH') {
      gap?.();
      gap = null;
      // The multipart body's last part is the content.
      const body = Buffer.from(init?.body as Uint8Array).toString('latin1');
      const content = body.split('\r\n\r\n').at(-1)?.split('\r\n--')[0] ?? '';
      push(new TextEncoder().encode(content));
      return json(file());
    }
    if (url.includes('/files/f1/revisions/') && url.includes('alt=media')) {
      const id = decodeURIComponent(url.split('/revisions/')[1]?.split('?')[0] ?? '');
      const found = revisions.find((revision) => revision.id === id);
      return found ? new Response(Buffer.from(found.content)) : json({}, 404);
    }
    if (url.includes('/files/f1/revisions'))
      return json({ revisions: revisions.map((r) => ({ id: r.id, modifiedTime: r.time })) });
    if (url.includes('/files/f1/permissions/p1') && method === 'DELETE') {
      permissions.splice(1, 1);
      return new Response(null, { status: 204 });
    }
    if (url.includes('/files/f1/permissions')) return json({ permissions });
    if (url.includes('/files/f1?alt=media')) return new Response(Buffer.from(head().content));
    if (url.includes('/files/f1')) return json(file());
    return json({ error: 'unexpected' }, 400);
  };
  return {
    calls,
    revisions,
    permissions,
    fetch,
    slip: (content: string) => {
      gap = () => push(new TextEncoder().encode(content));
    },
    head,
  };
}

const lines = (bytes: Uint8Array | null): Set<string> =>
  new Set(
    new TextDecoder()
      .decode(bytes ?? new Uint8Array())
      .split('\n')
      .filter((line) => line !== ''),
  );
const merge: Merge3 = (base, mine, theirs) => {
  const was = lines(base);
  const out = new Set<string>();
  for (const line of lines(mine)) if (lines(theirs).has(line) || !was.has(line)) out.add(line);
  for (const line of lines(theirs)) if (!was.has(line)) out.add(line);
  return new TextEncoder().encode([...out].sort().join('\n'));
};

function storeOn(drive: ReturnType<typeof scriptedDrive>) {
  return googleSpaceStore({
    drive: new GoogleDrive({ fetch: drive.fetch, token: () => Promise.resolve('token') }),
    folderName: 'Flint spaces (test)',
    device: 'ALEX-PC',
  });
}

describe('Google Drive as a space store (D-190)', () => {
  it('reads with the revision, writes after checking it, and says changed when it moved', async () => {
    const drive = scriptedDrive();
    const store = storeOn(drive);
    const read = await store.read('f1');
    expect(read.ref.revision).toBe('r1');
    expect(new TextDecoder().decode(read.content)).toBe('start');
    const written = await store.write('f1', new TextEncoder().encode('next'), 'r1');
    expect(written.revision).toBe('r2');
    await expect(store.write('f1', new TextEncoder().encode('late'), 'r1')).rejects.toEqual(
      new SpaceStoreError('changed', 'expected r1, Drive has r2'),
    );
  });

  it('with writeSafely: Sam’s write in Drive’s gap is found in the revisions and merged back', async () => {
    const drive = scriptedDrive();
    const store = storeOn(drive);
    drive.slip('start\nsam');
    const done = await writeSafely(
      store,
      'f1',
      new TextEncoder().encode('start'),
      new TextEncoder().encode('start\nalex'),
      merge,
    );
    expect(lines(done.content)).toEqual(new Set(['start', 'alex', 'sam']));
    expect(lines(drive.head().content)).toEqual(new Set(['start', 'alex', 'sam']));
    expect(drive.calls.some((call) => call.url.includes('/revisions/r2?alt=media'))).toBe(true);
  });

  it('members and Remove from space: the owner stays, a writer’s access goes', async () => {
    const drive = scriptedDrive();
    const store = storeOn(drive);
    expect(await store.members('f1')).toEqual([
      { name: 'Alex', address: 'alex@example.com', owner: true },
      { name: 'Sam', address: 'sam@example.com', owner: false },
    ]);
    await store.unshare(['f1'], 'SAM@example.com');
    expect(drive.permissions.map((permission) => permission.emailAddress)).toEqual([
      'alex@example.com',
    ]);
    expect(
      drive.calls.some((call) => call.method === 'DELETE' && call.url.includes('/permissions/p1')),
    ).toBe(true);
  });

  it('a file that is gone (not picked, deleted) is `gone`', async () => {
    const store = storeOn(scriptedDrive());
    await expect(store.info('missing')).rejects.toMatchObject({ problem: 'gone' });
  });
});
