import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contentType,
  rendererPageUrl,
  resolveMediaFile,
  resolveRendererFile,
} from './renderer-url.js';

const root = join('C:', 'Program Files', 'flint', 'renderer');

describe('app://flint renderer files (D-34)', () => {
  it('maps pages and assets into the renderer folder', () => {
    expect(rendererPageUrl('capture-popup')).toBe('app://flint/capture-popup/index.html');
    expect(resolveRendererFile(rendererPageUrl('capture-popup'), root)).toBe(
      join(root, 'capture-popup', 'index.html'),
    );
    expect(resolveRendererFile('app://flint/assets/popup-1.js?v=2#x', root)).toBe(
      join(root, 'assets', 'popup-1.js'),
    );
    expect(resolveRendererFile('app://flint/fonts/Geist%20Mono.woff2', root)).toBe(
      join(root, 'fonts', 'Geist Mono.woff2'),
    );
  });

  it('gives module scripts a JavaScript content type', () => {
    expect(contentType(join(root, 'assets', 'popup-1.JS'))).toBe('text/javascript; charset=utf-8');
    expect(contentType(join(root, 'fonts', 'Geist.woff2'))).toBe('font/woff2');
    expect(contentType(join(root, 'notes.unknown'))).toBe('application/octet-stream');
  });

  it('serves nothing outside the renderer folder', () => {
    // The URL parser resolves dot segments itself; escapes hidden in percent-encoding must not work.
    for (const url of [
      'app://flint/../main/index.js',
      'app://flint/%2e%2e/main/index.js',
      'app://flint/assets/..%2f..%2fmain%2findex.js',
      'app://flint/assets/..%5c..%5cmain%5cindex.js',
      'app://flint/C:%5cWindows%5cwin.ini',
      'app://flint/%5c%5cserver%5cshare%5cx.js',
    ]) {
      const file = resolveRendererFile(url, root);
      expect(file === null || file.startsWith(root + sep), `${url} -> ${String(file)}`).toBe(true);
    }
    for (const url of [
      'app://flint/',
      'app://flint',
      'app://other/capture-popup/index.html',
      'file:///C:/Windows/win.ini',
      'https://flint/capture-popup/index.html',
      'app://flint/%E0%A4%A',
      'not a url',
    ]) {
      expect(resolveRendererFile(url, root), url).toBeNull();
    }
  });
});

describe('app://media images from the Flint folder (TASK-05, D-49)', () => {
  const flint = join('C:', 'Users', 'alex', 'Flint');

  it('serves images inside the Flint folder', () => {
    expect(resolveMediaFile('app://media/attachments/shot%201.png', flint)).toBe(
      join(flint, 'attachments', 'shot 1.png'),
    );
    expect(contentType(join(flint, 'attachments', 'a.JPG'))).toBe('image/jpeg');
  });

  it('serves nothing else: other types, other hosts, or outside the folder', () => {
    for (const url of [
      'app://media/Inbox.md',
      'app://media/attachments/x.svg',
      'app://media/%2e%2e/secret.png',
      'app://media/attachments/..%2f..%2f..%2fx.png',
      'app://media/attachments/..%5c..%5cx.png',
      'app://media/C:%5cWindows%5cx.png',
      'app://flint/attachments/shot.png',
    ]) {
      const file = resolveMediaFile(url, flint);
      expect(
        file === null || (file.startsWith(flint + sep) && file.endsWith('.png')),
        `${url} -> ${String(file)}`,
      ).toBe(true);
      expect(file === null || !file.includes('..'), url).toBe(true);
    }
    expect(resolveMediaFile('app://media/Inbox.md', flint)).toBeNull();
    expect(resolveMediaFile('app://flint/attachments/shot.png', flint)).toBeNull();
  });
});
