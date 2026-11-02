import { copyFile, mkdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Files added to notes and task bodies (MEDIA-01, MEDIA-02, MEDIA-03, D-84): pictures, videos and
 * documents dragged or pasted in. Up to 25 MB a file is copied into the Flint folder's
 * `attachments/`; above that it is linked where it is (a `file:///` link), so the Flint folder,
 * snapshots, exports and sync stay small. Programs and scripts are never attached or opened.
 */

/** MEDIA-03, D-84: larger files are linked, not copied. */
export const COPY_LIMIT_BYTES = 25 * 1024 * 1024;

export type FileKind = 'image' | 'video' | 'document' | 'blocked' | 'other';

const KINDS: Readonly<Record<string, FileKind>> = {
  ...Object.fromEntries(
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].map((ext) => [ext, 'image']),
  ),
  ...Object.fromEntries(['.mp4', '.m4v', '.webm', '.mov'].map((ext) => [ext, 'video'])),
  ...Object.fromEntries(
    [
      '.pdf',
      '.txt',
      '.md',
      '.csv',
      '.json',
      '.log',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.odt',
      '.ods',
      '.odp',
      '.rtf',
      '.vsdx',
    ].map((ext) => [ext, 'document']),
  ),
  // Never attached or launched (D-84): programs, scripts, shortcuts and their relatives.
  ...Object.fromEntries(
    [
      '.exe',
      '.bat',
      '.cmd',
      '.com',
      '.ps1',
      '.psm1',
      '.psd1',
      '.msi',
      '.msp',
      '.scr',
      '.vbs',
      '.vbe',
      '.js',
      '.jse',
      '.wsf',
      '.wsh',
      '.lnk',
      '.url',
      '.reg',
      '.hta',
      '.cpl',
      '.msc',
      '.jar',
      '.pif',
      '.application',
      '.appref-ms',
      '.scf',
      '.inf',
      '.sys',
      '.dll',
      '.sh',
      '.py',
    ].map((ext) => [ext, 'blocked']),
  ),
};

export function fileKind(path: string): FileKind {
  return KINDS[extname(path).toLowerCase()] ?? 'other';
}

/** The file a link points to: `attachments/…` in the Flint folder, or a `file:///` link's path. */
export function linkedPath(link: string, folder: string): string | null {
  if (/^file:\/\//i.test(link)) {
    try {
      const path = fileURLToPath(link);
      return isAbsolute(path) ? path : null;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || isAbsolute(link) || link.split(/[\\/]/).includes('..'))
    return null;
  try {
    return join(folder, decodeURIComponent(link));
  } catch {
    return null;
  }
}

export interface Attached {
  readonly ok: true;
  /** The markdown link target: `attachments/…` or `file:///…`. */
  readonly link: string;
  readonly linked: boolean;
  readonly kind: FileKind;
  /** The file's name, for the link's text or alt. */
  readonly name: string;
  readonly bytes: number;
}

export type AttachOutcome = Attached | { readonly ok: false; readonly problem: string };

const stamp = (now: Date): string => {
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
};

/** A name in `attachments/` that doesn't clash: the time, a short random part, the extension. */
function attachmentName(source: string, now: Date): string {
  const random = Math.random().toString(36).slice(2, 6);
  return `${stamp(now)}-${random}${extname(source).toLowerCase()}`;
}

async function copyIn(source: string, folder: string, now: Date): Promise<string> {
  await mkdir(join(folder, 'attachments'), { recursive: true });
  const name = attachmentName(source, now);
  await copyFile(source, join(folder, 'attachments', name));
  return `attachments/${name}`;
}

/** A dragged or pasted file: copied into attachments/, or linked when it's large (D-84). */
export async function attachFile(
  source: string,
  folder: string,
  now: Date,
): Promise<AttachOutcome> {
  const kind = fileKind(source);
  if (kind === 'blocked')
    return { ok: false, problem: 'Flint never attaches programs or scripts.' };
  let bytes: number;
  try {
    const info = await stat(source);
    if (!info.isFile()) return { ok: false, problem: 'Only files can be attached.' };
    bytes = info.size;
  } catch {
    return { ok: false, problem: 'The file could not be read.' };
  }
  const name = basename(source);
  if (bytes > COPY_LIMIT_BYTES)
    return { ok: true, link: pathToFileURL(source).href, linked: true, kind, name, bytes };
  return { ok: true, link: await copyIn(source, folder, now), linked: false, kind, name, bytes };
}

/** MEDIA-03, D-84: Copy into Flint: a linked file copied into attachments/; its new link. */
export async function copyIntoFlint(
  link: string,
  folder: string,
  now: Date,
): Promise<AttachOutcome> {
  const source = /^file:\/\//i.test(link) ? linkedPath(link, folder) : null;
  if (!source) return { ok: false, problem: 'Only a linked file can be copied in.' };
  const kind = fileKind(source);
  if (kind === 'blocked')
    return { ok: false, problem: 'Flint never attaches programs or scripts.' };
  try {
    const info = await stat(source);
    return {
      ok: true,
      link: await copyIn(source, folder, now),
      linked: false,
      kind,
      name: basename(source),
      bytes: info.size,
    };
  } catch {
    return { ok: false, problem: 'The original file is no longer there.' };
  }
}

/**
 * What opening an attachment in its default app may do (D-84): media and documents open; programs
 * and scripts never; anything else only after asking.
 */
export function openRule(path: string): 'open' | 'ask' | 'never' {
  const kind = fileKind(path);
  if (kind === 'blocked') return 'never';
  return kind === 'other' ? 'ask' : 'open';
}
