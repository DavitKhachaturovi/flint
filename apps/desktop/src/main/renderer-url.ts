import { extname, isAbsolute, join, relative } from 'node:path';

/**
 * The renderers are served from an in-app scheme, `app://flint/…` (D-34), not `file://`: the packaged
 * Electron has the `grantFileProtocolExtraPrivileges` fuse off, so `file://` pages get no more than a
 * browser would, and module scripts need a real origin. The scheme exists only inside Flint; it is not
 * registered with Windows. It serves the built renderer folder and nothing else.
 */

export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://flint`;

/** Module scripts only run with a JavaScript content type, so every served file gets one. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

export function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function rendererPageUrl(page: string): string {
  return `${APP_ORIGIN}/${page}/index.html`;
}

/** The file an `app://flint/…` request maps to, or null when it is anything else or leaves `root`. */
export function resolveRendererFile(url: string, root: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Node reports no origin for schemes it doesn't know, so compare the parts.
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== 'flint') return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const file = join(root, path);
  const inside = relative(root, file);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
  return file;
}
