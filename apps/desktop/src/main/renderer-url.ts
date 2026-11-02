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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

export function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * D-81: the main window is served from its own host, `app://main/…`, because Chromium shares a
 * page's zoom with every window of the same origin: zooming the main window (UI-12) must not zoom
 * the capture popup. Same files, same scheme.
 */
export const MAIN_WINDOW_HOST = 'main';
const RENDERER_HOSTS = ['flint', MAIN_WINDOW_HOST] as const;

export function rendererPageUrl(
  page: string,
  host: (typeof RENDERER_HOSTS)[number] = 'flint',
): string {
  return `${APP_SCHEME}://${host}/${page}/index.html`;
}

/**
 * The file an `app://flint/…` (or `app://main/…`) request maps to, or null when it is anything else
 * or leaves `root`.
 */
export function resolveRendererFile(url: string, root: string): string | null {
  for (const host of RENDERER_HOSTS) {
    const file = resolveIn(url, host, root);
    if (file) return file;
  }
  return null;
}

/** Images task bodies may show (TASK-05, MEDIA-01). SVG stays out: an image, but also a document. */
const MEDIA_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/**
 * The image an `app://media/…` request maps to (task bodies, D-49): a file inside the Flint folder
 * `root` with an image type, or null for anything else.
 */
export function resolveMediaFile(url: string, root: string): string | null {
  const file = resolveIn(url, 'media', root);
  return file && MEDIA_TYPES.has(extname(file).toLowerCase()) ? file : null;
}

function resolveIn(url: string, host: string, root: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Node reports no origin for schemes it doesn't know, so compare the parts.
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== host) return null;
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
