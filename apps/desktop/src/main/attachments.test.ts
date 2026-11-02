import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachFile,
  COPY_LIMIT_BYTES,
  copyIntoFlint,
  fileKind,
  linkedPath,
  openRule,
} from './attachments.js';

let root: string;
let folder: string;
const now = new Date(2026, 10, 2, 15, 30, 0);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'flint-attach-'));
  folder = join(root, 'Flint');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('attachments: copied, or linked when large (MEDIA-01, MEDIA-03, D-84)', () => {
  it('knows media, documents and what never opens', () => {
    expect(fileKind('C:/a/clip.MOV')).toBe('video');
    expect(fileKind('shot.png')).toBe('image');
    expect(fileKind('spec.docx')).toBe('document');
    expect(fileKind('setup.exe')).toBe('blocked');
    expect(fileKind('run.ps1')).toBe('blocked');
    expect(fileKind('notes.zip')).toBe('other');
    expect(openRule('clip.mp4')).toBe('open');
    expect(openRule('archive.zip')).toBe('ask');
    expect(openRule('install.msi')).toBe('never');
  });

  it('copies a small file into attachments/', async () => {
    const source = join(root, 'shot.png');
    await writeFile(source, Buffer.alloc(100));
    const outcome = await attachFile(source, folder, now);
    expect(outcome).toMatchObject({ ok: true, linked: false, kind: 'image', name: 'shot.png' });
    expect(outcome.ok && outcome.link).toMatch(/^attachments\/2026-11-02-153000-\w{4}\.png$/);
    expect(await readdir(join(folder, 'attachments'))).toHaveLength(1);
  });

  it('links a large file where it is, and copies it in on request', async () => {
    const source = join(root, 'demo clip.mp4');
    await writeFile(source, Buffer.alloc(COPY_LIMIT_BYTES + 1));
    const outcome = await attachFile(source, folder, now);
    expect(outcome).toMatchObject({ ok: true, linked: true, kind: 'video' });
    const link = outcome.ok ? outcome.link : '';
    expect(link).toBe(pathToFileURL(source).href);
    expect(linkedPath(link, folder)).toBe(source);
    const copied = await copyIntoFlint(link, folder, now);
    expect(copied).toMatchObject({ ok: true, linked: false });
    expect(copied.ok && copied.link).toMatch(/^attachments\/.*\.mp4$/);
  });

  it('refuses programs, and says when the original is gone', async () => {
    const exe = join(root, 'tool.exe');
    await writeFile(exe, 'MZ');
    expect(await attachFile(exe, folder, now)).toEqual({
      ok: false,
      problem: 'Flint never attaches programs or scripts.',
    });
    expect(await copyIntoFlint(pathToFileURL(join(root, 'gone.mp4')).href, folder, now)).toEqual({
      ok: false,
      problem: 'The original file is no longer there.',
    });
  });

  it('resolves links only inside the Flint folder or to a file URL', () => {
    expect(linkedPath('attachments/a%20b.png', folder)).toBe(
      join(folder, 'attachments', 'a b.png'),
    );
    expect(linkedPath('../secret.png', folder)).toBeNull();
    expect(linkedPath('https://x.y/a.png', folder)).toBeNull();
  });
});
